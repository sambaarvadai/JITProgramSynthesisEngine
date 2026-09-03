// Semantic-layer-builder node tests

import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import Anthropic from '@anthropic-ai/sdk';
import { createSemanticLayerBuilderNodeDefinition } from '@/nodes/semantic-layer-builder-node.js';
import { dataSourceRegistry } from '@/storage/DataSourceRegistry.js';
import { buildSchemaFromSQL } from '@/schema/SchemaBuilder.js';
import { createExecutionContext } from '@/core/context/execution-context.js';
import { schema, collection, void_ } from '@/core/types/data-value.js';

const ctx = createExecutionContext({ pipelineId: 'test', sessionId: 'test', userId: '1' });

function uniqueName(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeAnthropicClient(mappings: any[]): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ mappings }) }],
      }),
    },
  } as unknown as Anthropic;
}

function buildSchemaArtifact(datasourceId: string, ddl: string) {
  return schema({
    datasourceId,
    schema: buildSchemaFromSQL(ddl, { sessionAnchorTables: [] }),
  });
}

describe('SemanticLayerBuilderNode', () => {
  test('node definition shape', () => {
    const node = createSemanticLayerBuilderNodeDefinition(makeAnthropicClient([]));

    assert.strictEqual(node.kind, 'semantic-layer-builder');
    assert.strictEqual(node.displayName, 'Semantic Layer Builder');
    assert.strictEqual(node.inputPorts.length, 1);
    assert.strictEqual(node.inputPorts[0].key, 'input');
    assert.deepStrictEqual(node.inputPorts[0].dataType, { kind: 'schema' });
    assert.strictEqual(node.outputPorts.length, 1);
    assert.deepStrictEqual(node.outputPorts[0].dataType, { kind: 'tabular' });
  });

  test('validation catches missing datasourceIds', () => {
    const node = createSemanticLayerBuilderNodeDefinition(makeAnthropicClient([]));
    const result = node.validate({} as any);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === 'MISSING_DATASOURCE_IDS'));
  });

  test('validation catches empty datasourceIds', () => {
    const node = createSemanticLayerBuilderNodeDefinition(makeAnthropicClient([]));
    const result = node.validate({ datasourceIds: [] });
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === 'MISSING_DATASOURCE_IDS'));
  });

  test('validation passes for valid payload', () => {
    const node = createSemanticLayerBuilderNodeDefinition(makeAnthropicClient([]));
    const result = node.validate({ datasourceIds: ['a'] });
    assert.strictEqual(result.ok, true);
  });

  test('produces fk_registry mapping from explicit cross-datasource FK', async () => {
    const sourceDs = uniqueName('fk_source');
    const targetDs = uniqueName('fk_target');

    const sourceSchema = buildSchemaArtifact(
      sourceDs,
      `CREATE TABLE fk_orders_${sourceDs} (id SERIAL PRIMARY KEY, account_id INTEGER);`,
    );
    const targetSchema = buildSchemaArtifact(
      targetDs,
      `CREATE TABLE fk_accounts_${targetDs} (id SERIAL PRIMARY KEY, name VARCHAR(255));`,
    );

    dataSourceRegistry.declareCrossDatasourceFKs([
      {
        fromDatasource: sourceDs,
        fromTable: `fk_orders_${sourceDs}`,
        fromColumn: 'account_id',
        toDatasource: targetDs,
        toTable: `fk_accounts_${targetDs}`,
        toColumn: 'id',
      },
    ]);

    const node = createSemanticLayerBuilderNodeDefinition(makeAnthropicClient([]));
    const result = await node.execute(
      { datasourceIds: [sourceDs, targetDs] },
      collection([sourceSchema, targetSchema], 'schema'),
      ctx,
    );

    assert.strictEqual(result.kind, 'tabular');
    const rows = result.data.rows;
    assert.ok(rows.length >= 1);
    const fkRow = rows.find(
      (r) => r.sourceColumn === `fk_orders_${sourceDs}.account_id` && r.targetColumn === `fk_accounts_${targetDs}.id`,
    );
    assert.ok(fkRow, 'expected explicit FK mapping');
    assert.strictEqual(fkRow!.basis, 'fk_registry');
    assert.strictEqual(fkRow!.confidence, 1.0);
    assert.strictEqual(fkRow!.status, 'candidate');
  });

  test('produces name_heuristic mapping above the 0.6 threshold', async () => {
    const ds = uniqueName('heuristic');

    const input = buildSchemaArtifact(
      ds,
      `CREATE TABLE orders (id SERIAL PRIMARY KEY, customer_id INTEGER);
       CREATE TABLE customers (id SERIAL PRIMARY KEY, email VARCHAR(255));`,
    );

    const node = createSemanticLayerBuilderNodeDefinition(makeAnthropicClient([]));
    const result = await node.execute({ datasourceIds: [ds] }, input, ctx);

    assert.strictEqual(result.kind, 'tabular');
    const rows = result.data.rows;
    const heuristicRow = rows.find(
      (r) => r.sourceColumn === 'orders.customer_id' && r.targetColumn === 'customers.id',
    );
    assert.ok(heuristicRow, 'expected heuristic mapping');
    assert.strictEqual(heuristicRow!.basis, 'name_heuristic');
    assert.ok(Number(heuristicRow!.confidence) >= 0.6, `confidence should exceed 0.6, got ${heuristicRow!.confidence}`);
  });

  test('falls back to llm_inferred for weak heuristics', async () => {
    const sourceDs = uniqueName('llm_src');
    const targetDs = uniqueName('llm_tgt');

    const sourceSchema = buildSchemaArtifact(
      sourceDs,
      `CREATE TABLE orders (id SERIAL PRIMARY KEY, owner_user_id INTEGER);`,
    );
    const targetSchema = buildSchemaArtifact(
      targetDs,
      `CREATE TABLE accounts (id SERIAL PRIMARY KEY, name VARCHAR(255));`,
    );

    const client = makeAnthropicClient([
      {
        sourceColumn: 'orders.owner_user_id',
        targetColumn: 'accounts.id',
        confidence: 0.92,
        reasoning: 'owner_user_id references the accounts primary key',
      },
    ]);

    const node = createSemanticLayerBuilderNodeDefinition(client);
    const result = await node.execute(
      { datasourceIds: [sourceDs, targetDs] },
      collection([sourceSchema, targetSchema], 'schema'),
      ctx,
    );

    assert.strictEqual(result.kind, 'tabular');
    const rows = result.data.rows;
    const llmRow = rows.find(
      (r) => r.sourceColumn === 'orders.owner_user_id' && r.targetColumn === 'accounts.id',
    );
    assert.ok(llmRow, 'expected LLM-inferred mapping');
    assert.strictEqual(llmRow!.basis, 'llm_inferred');
    assert.ok(Number(llmRow!.confidence) > 0.8);
    assert.strictEqual(llmRow!.reasoning, 'owner_user_id references the accounts primary key');
  });

  test('returns tabular output with correct schema', async () => {
    const ds = uniqueName('schema');
    const input = buildSchemaArtifact(
      ds,
      `CREATE TABLE orders (id SERIAL PRIMARY KEY, customer_id INTEGER);
       CREATE TABLE customers (id SERIAL PRIMARY KEY, email VARCHAR(255));`,
    );

    const node = createSemanticLayerBuilderNodeDefinition(makeAnthropicClient([]));
    const result = await node.execute({ datasourceIds: [ds] }, input, ctx);

    assert.strictEqual(result.kind, 'tabular');
    const columnNames = result.data.schema.columns.map((c) => c.name);
    assert.deepStrictEqual(columnNames, [
      'id', 'sourceColumn', 'targetColumn', 'status', 'confidence', 'basis', 'reasoning',
    ]);
  });

  test('throws when no schemas match the requested datasourceIds', async () => {
    const ds = uniqueName('missing');
    const input = buildSchemaArtifact(ds, `CREATE TABLE orders (id SERIAL PRIMARY KEY);`);

    const node = createSemanticLayerBuilderNodeDefinition(makeAnthropicClient([]));
    await assert.rejects(
      () => node.execute({ datasourceIds: ['non-existent'] }, input, ctx),
      /No schemas found/,
    );
  });
});
