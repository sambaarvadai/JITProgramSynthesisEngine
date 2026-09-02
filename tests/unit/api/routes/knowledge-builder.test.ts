// Knowledge-builder route tests

import { test, describe, before, after } from 'node:test';
import * as assert from 'node:assert';
import express from 'express';
import request from 'supertest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { NodeRegistry } from '@/core/registry/node-registry.js';
import { schemaBuilderNodeDefinition } from '@/nodes/schema-builder-node.js';
import { createOntologyBuilderNodeDefinition } from '@/nodes/ontology-builder-node.js';
import { dataSourceRegistry } from '@/storage/DataSourceRegistry.js';
import { buildSchemaFromSQL } from '@/schema/SchemaBuilder.js';
import Anthropic from '@anthropic-ai/sdk';
import { knowledgeBuilderRoutes, setKnowledgeBuilderServices } from '@/api/routes/knowledge-builder.js';

function uniqueName(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

let tempDir: string;

function writeTempDDL(name: string, ddl: string): string {
  if (!tempDir) tempDir = mkdtempSync(join(tmpdir(), 'kb-route-'));
  const p = join(tempDir, `${name}.sql`);
  writeFileSync(p, ddl);
  return p;
}

function buildApp(nodeRegistry: NodeRegistry, anthropicApiKey = 'fake') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userId = '1';
    next();
  });
  app.use('/api/datasources', knowledgeBuilderRoutes({ nodeRegistry, anthropicApiKey }));
  return app;
}

function makeMockAnthropic(mappings: any[]): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ mappings }) }],
      }),
    },
  } as unknown as Anthropic;
}

function registerDatasource(name: string) {
  const ddl = `
    CREATE TABLE orders (id SERIAL PRIMARY KEY, customer_id INTEGER);
    CREATE TABLE customers (id SERIAL PRIMARY KEY, email VARCHAR(255));
  `;
  const ddlPath = writeTempDDL(name, ddl);
  dataSourceRegistry.register({
    name,
    displayName: name,
    kind: 'postgres',
    ddlPath,
    schema: buildSchemaFromSQL(ddl, { sessionAnchorTables: [] }),
    description: 'test',
  });
}

describe('KnowledgeBuilderRoute', () => {
  before(() => {
    setKnowledgeBuilderServices({} as any);
  });

  after(() => {
    setKnowledgeBuilderServices(null);
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  test('returns 503 when no Anthropic API key is configured', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/datasources', knowledgeBuilderRoutes());

    const res = await request(app).post('/api/datasources/default/build-knowledge');
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.error.code, 'LLM_UNAVAILABLE');
  });

  test('returns 500 when services are not initialized', async () => {
    setKnowledgeBuilderServices(null);

    const nodeRegistry = new NodeRegistry();
    const mockClient = makeMockAnthropic([]);
    nodeRegistry.register(schemaBuilderNodeDefinition);
    nodeRegistry.register(createOntologyBuilderNodeDefinition(mockClient));
    const app = buildApp(nodeRegistry);

    const ds = uniqueName('svc');
    registerDatasource(ds);

    const res = await request(app).post(`/api/datasources/${ds}/build-knowledge`);
    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error.code, 'SERVICES_NOT_INITIALIZED');

    setKnowledgeBuilderServices({} as any);
  });

  test('returns candidate mappings for a single datasource', async () => {
    const ds = uniqueName('route');
    registerDatasource(ds);

    const nodeRegistry = new NodeRegistry();
    const mockClient = makeMockAnthropic([]);
    nodeRegistry.register(schemaBuilderNodeDefinition);
    nodeRegistry.register(createOntologyBuilderNodeDefinition(mockClient));

    const app = buildApp(nodeRegistry);
    const res = await request(app).post(`/api/datasources/${ds}/build-knowledge`);

    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.mappings));
    const heuristic = res.body.mappings.find(
      (m: any) => m.sourceColumn === 'orders.customer_id' && m.targetColumn === 'customers.id',
    );
    assert.ok(heuristic, 'expected a heuristic mapping in response');
    assert.strictEqual(heuristic.basis, 'name_heuristic');
  });

  test('returns 500 when datasource does not exist', async () => {
    const nodeRegistry = new NodeRegistry();
    nodeRegistry.register(schemaBuilderNodeDefinition);
    nodeRegistry.register(createOntologyBuilderNodeDefinition(makeMockAnthropic([])));

    const app = buildApp(nodeRegistry);
    const res = await request(app).post('/api/datasources/does-not-exist/build-knowledge');

    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error.code, 'KNOWLEDGE_BUILDER_ERROR');
  });
});
