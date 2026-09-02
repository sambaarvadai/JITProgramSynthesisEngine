// Schema-builder node tests

import { test, describe, before, after } from 'node:test';
import * as assert from 'node:assert';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { schemaBuilderNodeDefinition } from '@/nodes/schema-builder-node.js';
import { dataSourceRegistry } from '@/storage/DataSourceRegistry.js';
import { void_ } from '@/core/types/data-value.js';
import { createExecutionContext } from '@/core/context/execution-context.js';
import { buildSchemaFromSQL } from '@/schema/SchemaBuilder.js';

const ctx = createExecutionContext({ pipelineId: 'test', sessionId: 'test', userId: '1' });

function uniqueName(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildTestDDL(tablePrefix: string): string {
  return `
    CREATE TABLE ${tablePrefix}_accounts (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      owner_user_id INTEGER
    );
    CREATE TABLE ${tablePrefix}_users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255)
    );
  `;
}

describe('SchemaBuilderNode', () => {
  let tempDir: string;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'schema-builder-'));
  });

  after(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('node definition shape', () => {
    assert.strictEqual(schemaBuilderNodeDefinition.kind, 'schema-builder');
    assert.strictEqual(schemaBuilderNodeDefinition.displayName, 'Schema Builder');
    assert.strictEqual(schemaBuilderNodeDefinition.inputPorts.length, 0);
    assert.strictEqual(schemaBuilderNodeDefinition.outputPorts.length, 1);
    assert.strictEqual(schemaBuilderNodeDefinition.outputPorts[0].key, 'output');
    assert.deepStrictEqual(schemaBuilderNodeDefinition.outputPorts[0].dataType, { kind: 'schema' });
  });

  test('validation catches missing datasourceId', () => {
    const result = schemaBuilderNodeDefinition.validate({ refreshMode: 'full' } as any);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === 'MISSING_DATASOURCE'));
  });

  test('validation catches invalid refreshMode', () => {
    const result = schemaBuilderNodeDefinition.validate({ datasourceId: 'x', refreshMode: 'delta' } as any);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === 'INVALID_REFRESH_MODE'));
  });

  test('validation passes for valid payload', () => {
    const result = schemaBuilderNodeDefinition.validate({ datasourceId: 'x', refreshMode: 'full' });
    assert.strictEqual(result.ok, true);
  });

  test('full refresh reads DDL and returns a schema DataValue', async () => {
    const name = uniqueName('full');
    const ddlPath = join(tempDir, `${name}.sql`);
    writeFileSync(ddlPath, buildTestDDL(name));

    dataSourceRegistry.register({
      name,
      displayName: 'Full Test',
      kind: 'postgres',
      ddlPath,
      description: 'test',
    });

    const result = await schemaBuilderNodeDefinition.execute(
      { datasourceId: name, refreshMode: 'full' },
      void_,
      ctx,
    );

    assert.strictEqual(result.kind, 'schema');
    const artifact = result.data as any;
    assert.strictEqual(artifact.datasourceId, name);
    assert.ok(artifact.schema.parsed.tables.has(`${name}_accounts`));
    assert.ok(artifact.schema.parsed.tables.has(`${name}_users`));

    // Full refresh should cache the schema back into the registry entry.
    const ds = dataSourceRegistry.get(name)!;
    assert.strictEqual((ds as any).schema, artifact.schema);
  });

  test('incremental refresh returns cached schema', async () => {
    const name = uniqueName('incremental');
    const schema = buildSchemaFromSQL(buildTestDDL(name), { sessionAnchorTables: [] });

    dataSourceRegistry.register({
      name,
      displayName: 'Incremental Test',
      kind: 'postgres',
      schema,
      description: 'test',
    });

    const result = await schemaBuilderNodeDefinition.execute(
      { datasourceId: name, refreshMode: 'incremental' },
      void_,
      ctx,
    );

    assert.strictEqual(result.kind, 'schema');
    const artifact = result.data as any;
    assert.strictEqual(artifact.schema, schema);
  });

  test('incremental refresh throws when no cached schema exists', async () => {
    const name = uniqueName('no-cache');
    dataSourceRegistry.register({
      name,
      displayName: 'No Cache Test',
      kind: 'postgres',
      description: 'test',
    });

    await assert.rejects(
      () => schemaBuilderNodeDefinition.execute({ datasourceId: name, refreshMode: 'incremental' }, void_, ctx),
      /No cached schema/,
    );
  });

  test('execute throws for unknown datasource', async () => {
    await assert.rejects(
      () => schemaBuilderNodeDefinition.execute({ datasourceId: 'does-not-exist', refreshMode: 'full' }, void_, ctx),
      /Unknown datasource/,
    );
  });
});
