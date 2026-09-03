// Semantic layer builder node — proposes column mappings across datasources/tables.
// This builds the technical/column-level semantic layer the pipeline reads at query time.
// It is not the future business-object / concept layer (Customer, Order, etc.), which is a
// distinct, not-yet-built layer that may reference these mappings later but is out of scope here.
// Produces candidates only; persisting confirmed mappings is out of scope.

import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { NodeDefinition } from '../core/registry/node-registry.js';
import type { DataType, DataValue } from '../core/types/data-value.js';
import { isSchema, isCollection, tabular } from '../core/types/data-value.js';
import type { RowSchema } from '../core/types/schema.js';
import type { ExecutionContext } from '../core/context/execution-context.js';
import { validationOk, validationFail } from '../core/types/validation.js';
import type { SemanticLayerBuilderPayload, SemanticMapping } from './payloads.js';
import { dataSourceRegistry } from '../storage/DataSourceRegistry.js';
import { MODELS } from '../config/models.js';
import type { BuiltSchema } from '../schema/SchemaBuilder.js';
import type { SchemaArtifactData } from './schema-builder-node.js';

const LLM_FALLBACK_THRESHOLD = 0.6;
const MAX_LLM_PAIRS = 100;

interface ColumnDescriptor {
  datasourceId: string;
  table: string;
  column: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  trait?: any;
}

interface CandidatePair {
  source: ColumnDescriptor;
  target: ColumnDescriptor;
  heuristicScore: number;
}

function isReferenceLike(name: string): boolean {
  const lower = name.toLowerCase();
  const referenceTokens = /\b(id|ref|code|key|num|fk|foreign|by|to|from|for|of|in)\b/;
  return referenceTokens.test(lower);
}

function toTypeCategory(type: string): string {
  const upper = type.toUpperCase();
  if (upper.startsWith('INT') || upper === 'SERIAL' || upper.startsWith('NUMERIC') || upper.startsWith('DECIMAL') || upper === 'REAL' || upper === 'DOUBLE') return 'number';
  if (upper === 'BOOLEAN' || upper === 'BOOL') return 'boolean';
  if (upper.startsWith('VARCHAR') || upper === 'TEXT' || upper === 'CHAR' || upper === 'INET') return 'string';
  if (upper === 'TIMESTAMPTZ' || upper === 'TIMESTAMP' || upper === 'DATE' || upper === 'TIME') return 'date';
  if (upper === 'JSONB' || upper === 'JSON') return 'json';
  return 'other';
}

function typeCompatibility(source: ColumnDescriptor, target: ColumnDescriptor): number {
  const s = toTypeCategory(source.type);
  const t = toTypeCategory(target.type);
  if (s === t) return 1.0;
  if (s === 'number' && t === 'number') return 1.0;
  if (s === 'string' && t === 'string') return 1.0;
  if ((s === 'number' && t === 'string') || (s === 'string' && t === 'number')) return 0.5;
  return 0;
}

function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 0 && !STOP_WORDS.has(t));
}

const STOP_WORDS = new Set([
  'id', 'ref', 'code', 'key', 'num', 'fk', 'foreign',
  'by', 'to', 'from', 'for', 'of', 'in', 'the', 'a', 'an',
  'is', 'are', 'was', 'were', 'be', 'been',
]);

function longestCommonSubstring(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let max = 0;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
        max = Math.max(max, dp[i][j]);
      }
    }
  }
  return max;
}

function tokenOverlap(aTokens: string[], bTokens: string[]): number {
  const setA = new Set(aTokens);
  if (setA.size === 0) return 0;
  let intersection = 0;
  for (const t of bTokens) {
    if (setA.has(t)) intersection++;
  }
  const union = new Set([...aTokens, ...bTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function stemPlural(word: string): string {
  if (word.endsWith('s') && word.length > 3) return word.slice(0, -1);
  return word;
}

function tableHintScore(sourceName: string, targetTable: string): number {
  const sTokens = tokenize(sourceName);
  const tTokens = tokenize(targetTable);
  if (sTokens.length === 0 || tTokens.length === 0) return 0;
  const sStems = new Set(sTokens.map(stemPlural));
  const tStems = new Set(tTokens.map(stemPlural));
  let matches = 0;
  for (const s of sStems) {
    if (tStems.has(s)) matches++;
  }
  return matches / Math.max(sStems.size, tStems.size);
}

function heuristicScore(source: ColumnDescriptor, target: ColumnDescriptor): number {
  const srcName = source.column;
  const tgtName = target.column;

  const srcTokens = tokenize(srcName);
  const tgtTokens = tokenize(tgtName);

  const tokenJaccard = tokenOverlap(srcTokens, tgtTokens);
  const lcs = Math.min(1, longestCommonSubstring(srcName.toLowerCase(), tgtName.toLowerCase()) / Math.max(srcName.length, tgtName.length));
  const tHint = tableHintScore(srcName, target.table);

  const nameScore = tokenJaccard * 0.4 + lcs * 0.2 + tHint * 0.4;
  const typeScore = typeCompatibility(source, target);

  return nameScore * 0.6 + typeScore * 0.4;
}

function extractSchemas(input: DataValue): Array<{ datasourceId: string; schema: BuiltSchema }> {
  const results: Array<{ datasourceId: string; schema: BuiltSchema }> = [];

  if (isSchema(input)) {
    const artifact = input.data as SchemaArtifactData;
    results.push({ datasourceId: artifact.datasourceId, schema: artifact.schema });
  } else if (isCollection(input)) {
    for (const item of input.data) {
      if (isSchema(item)) {
        const artifact = item.data as SchemaArtifactData;
        results.push({ datasourceId: artifact.datasourceId, schema: artifact.schema });
      }
    }
  }

  return results;
}

function buildColumnIndex(schemas: Array<{ datasourceId: string; schema: BuiltSchema }>): ColumnDescriptor[] {
  const columns: ColumnDescriptor[] = [];
  for (const { datasourceId, schema } of schemas) {
    const tables = schema.parsed.tables as any as Map<string, any>;
    const traits = schema.traits as Map<string, Map<string, any>>;
    for (const [tableName, tableDef] of tables.entries()) {
      const tableTraits = traits.get(tableName);
      for (const [columnName, colDef] of tableDef.columns.entries() as any) {
        columns.push({
          datasourceId,
          table: tableName,
          column: columnName,
          type: colDef.type as string,
          nullable: colDef.nullable as boolean,
          primaryKey: colDef.primaryKey as boolean,
          unique: colDef.unique as boolean,
          trait: tableTraits?.get(columnName),
        });
      }
    }
  }
  return columns;
}

function mappingKey(source: string, target: string): string {
  return `${source}->${target}`;
}

function buildLLMPrompt(pairs: CandidatePair[]): string {
  const entries = pairs.map(({ source, target, heuristicScore }) => ({
    source: {
      table: source.table,
      column: source.column,
      type: source.type,
      primaryKey: source.primaryKey,
      unique: source.unique,
      trait: source.trait?.trait ?? 'user_supplied',
    },
    target: {
      table: target.table,
      column: target.column,
      type: target.type,
      primaryKey: target.primaryKey,
      unique: target.unique,
      trait: target.trait?.trait ?? 'user_supplied',
    },
    nameTypeHeuristicScore: Number(heuristicScore.toFixed(3)),
  }));

  return `You are a semantic-layer-mapping assistant. You are given candidate column pairs (metadata only — no raw sample values).
Identify which pairs represent a foreign-key / reference relationship between the source column and the target column.

Return a single JSON array. Each object must have these exact fields:
- sourceColumn: string in "table.column" format
- targetColumn: string in "table.column" format
- confidence: number between 0 and 1
- reasoning: a one-sentence explanation of why the columns match

Omit pairs that are unrelated. Do not include any markdown, code fences, or commentary outside the JSON array.

Candidate pairs (column name, type, key/unique flags, inferred trait, heuristic score):
${JSON.stringify(entries, null, 2)}`;
}

function parseLLMResponse(raw: string): Array<{ sourceColumn: string; targetColumn: string; confidence: number; reasoning?: string }> {
  const cleaned = raw
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    console.warn('[SemanticLayerBuilder] LLM response did not contain a JSON array');
    return [];
  }

  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as any[];
  } catch (err) {
    console.warn('[SemanticLayerBuilder] Failed to parse LLM JSON:', err);
    return [];
  }
}

export function createSemanticLayerBuilderNodeDefinition(
  client: Anthropic,
): NodeDefinition<SemanticLayerBuilderPayload, DataValue, DataValue> {
  return {
    kind: 'semantic-layer-builder',
    displayName: 'Semantic Layer Builder',
    icon: '🕸️',
    color: '#10B981',
    inputPorts: [{ key: 'input', label: 'Schema', dataType: { kind: 'schema' }, required: true }],
    outputPorts: [{ key: 'output', label: 'Candidate Mappings', dataType: { kind: 'tabular' }, required: true }],

    validate(payload: unknown) {
      const p = payload as SemanticLayerBuilderPayload;
      const errors: Array<{ code: string; message: string }> = [];

      if (!p?.datasourceIds || !Array.isArray(p.datasourceIds) || p.datasourceIds.length === 0) {
        errors.push({ code: 'MISSING_DATASOURCE_IDS', message: 'semantic-layer-builder requires at least one datasourceId' });
      } else {
        for (const id of p.datasourceIds) {
          if (typeof id !== 'string' || id.trim().length === 0) {
            errors.push({ code: 'INVALID_DATASOURCE_ID', message: 'datasourceIds must be non-empty strings' });
            break;
          }
        }
      }

      return errors.length > 0 ? validationFail(errors) : validationOk();
    },

    inferOutputType(_payload: SemanticLayerBuilderPayload, _inputType: DataType): DataType {
      return { kind: 'tabular' };
    },

    async execute(payload: SemanticLayerBuilderPayload, input: DataValue, _ctx: ExecutionContext): Promise<DataValue> {
      const schemas = extractSchemas(input).filter(s =>
        payload.datasourceIds.includes(s.datasourceId)
      );

      if (schemas.length === 0) {
        throw new Error(
          `[SemanticLayerBuilder] No schemas found for datasourceIds: ${payload.datasourceIds.join(', ')}`
        );
      }

      const allColumns = buildColumnIndex(schemas);
      const mappings = new Map<string, SemanticMapping>();

      const llmCandidates: CandidatePair[] = [];

      for (const source of allColumns) {
        // 1. Cross-datasource FK registry
        const explicitFk = dataSourceRegistry.resolveCrossDatasourceFK(source.table, source.column);
        if (explicitFk) {
          const key = mappingKey(`${source.table}.${source.column}`, `${explicitFk.toTable}.${explicitFk.toColumn}`);
          if (!mappings.has(key)) {
            mappings.set(key, {
              id: crypto.randomUUID(),
              sourceColumn: `${source.table}.${source.column}`,
              targetColumn: `${explicitFk.toTable}.${explicitFk.toColumn}`,
              status: 'candidate',
              confidence: 1.0,
              basis: 'fk_registry',
            });
          }
          continue;
        }

        for (const target of allColumns) {
          if (source.table === target.table && source.column === target.column) continue;
          if (source.table === target.table) continue;

          const targetEligible =
            target.primaryKey || target.unique || isReferenceLike(target.column);
          if (!targetEligible) continue;

          const typeCompat = typeCompatibility(source, target);
          if (typeCompat === 0) continue;

          const score = heuristicScore(source, target);

          if (score >= LLM_FALLBACK_THRESHOLD) {
            const key = mappingKey(`${source.table}.${source.column}`, `${target.table}.${target.column}`);
            if (!mappings.has(key)) {
              mappings.set(key, {
                id: crypto.randomUUID(),
                sourceColumn: `${source.table}.${source.column}`,
                targetColumn: `${target.table}.${target.column}`,
                status: 'candidate',
                confidence: Number(score.toFixed(4)),
                basis: 'name_heuristic',
              });
            }
          } else {
            llmCandidates.push({ source, target, heuristicScore: score });
          }
        }
      }

      // 3. LLM tier for remaining unresolved pairs
      if (llmCandidates.length > 0) {
        llmCandidates.sort((a, b) => b.heuristicScore - a.heuristicScore);
        const batch = llmCandidates.slice(0, MAX_LLM_PAIRS);

        const prompt = buildLLMPrompt(batch);
        const response = await client.messages.create({
          model: MODELS.SEMANTIC_LAYER_BUILDER,
          max_tokens: 2048,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }],
        });

        const raw = response.content[0].type === 'text' ? response.content[0].text : '[]';
        const proposed = parseLLMResponse(raw);

        for (const p of proposed) {
          if (!p.sourceColumn || !p.targetColumn || typeof p.confidence !== 'number') continue;
          const key = mappingKey(p.sourceColumn, p.targetColumn);
          if (!mappings.has(key)) {
            mappings.set(key, {
              id: crypto.randomUUID(),
              sourceColumn: p.sourceColumn,
              targetColumn: p.targetColumn,
              status: 'candidate',
              confidence: Math.max(0, Math.min(1, p.confidence)),
              basis: 'llm_inferred',
              reasoning: p.reasoning,
            });
          }
        }
      }

      // TODO: persist confirmed mappings / confirm/reject hook goes here.
      // This is intentionally deferred; this node emits candidates only.

      const rows = Array.from(mappings.values()).map(m => ({
        id: m.id,
        sourceColumn: m.sourceColumn,
        targetColumn: m.targetColumn,
        status: m.status,
        confidence: m.confidence,
        basis: m.basis,
        reasoning: m.reasoning ?? null,
      }));

      const outputSchema: RowSchema = {
        columns: [
          { name: 'id', type: { kind: 'string' }, nullable: false },
          { name: 'sourceColumn', type: { kind: 'string' }, nullable: false },
          { name: 'targetColumn', type: { kind: 'string' }, nullable: false },
          { name: 'status', type: { kind: 'string' }, nullable: false },
          { name: 'confidence', type: { kind: 'number' }, nullable: false },
          { name: 'basis', type: { kind: 'string' }, nullable: false },
          { name: 'reasoning', type: { kind: 'string' }, nullable: true },
        ],
      };

      return tabular({ schema: outputSchema, rows }, outputSchema);
    },
  };
}
