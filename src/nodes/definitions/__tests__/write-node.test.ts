// WriteNode tests

import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { createWriteNodeDefinition } from '../write-node.js';
import { MockStorageBackend } from '../../../executors/operators/__tests__/mock-storage-backend.js';
import type { WritePayload } from '../../payloads.js';
import type { SchemaConfig } from '../../../compiler/schema/schema-config.js';

function createMockSchema(): SchemaConfig {
  return {
    tables: new Map(),
    foreignKeys: [],
    version: '1'
  };
}

describe('WriteNode', () => {
  test('Validation - missing table', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    const result = writeNodeDef.validate({ mode: 'insert', columns: ['name'] } as WritePayload);
    
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'MISSING_TABLE'));
  });

  test('Validation - missing mode', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    const result = writeNodeDef.validate({ table: 'users', columns: ['name'] } as WritePayload);
    
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'MISSING_MODE'));
  });

  test('Validation - missing columns for insert', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    const result = writeNodeDef.validate({ table: 'users', mode: 'insert' } as WritePayload);
    
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'MISSING_COLUMNS'));
  });

  test('Validation - valid insert payload', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    const result = writeNodeDef.validate({ 
      table: 'users', 
      mode: 'insert', 
      columns: ['name', 'email'] 
    } as WritePayload);
    
    assert.strictEqual(result.ok, true);
  });

  test('Validation - update requires whereColumns', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    const result = writeNodeDef.validate({ 
      table: 'users', 
      mode: 'update', 
      columns: ['name'] 
    } as WritePayload);
    
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'MISSING_WHERE_COLUMNS'));
  });

  test('Validation - upsert requires conflictColumns', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    const result = writeNodeDef.validate({ 
      table: 'users', 
      mode: 'upsert', 
      columns: ['name'] 
    } as WritePayload);
    
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'MISSING_CONFLICT_COLUMNS'));
  });

  test('Validation - delete does not require columns', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    const result = writeNodeDef.validate({ 
      table: 'users', 
      mode: 'delete',
      whereColumns: ['id']
    } as WritePayload);
    
    assert.strictEqual(result.ok, true);
  });

  test('Validation - all modes supported', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    const modes = ['insert', 'insert_ignore', 'update', 'upsert', 'delete'];
    
    for (const mode of modes) {
      const payload: any = { 
        table: 'users', 
        mode: mode,
        columns: ['name'],
        datasource: 'default'
      };
      
      if (mode === 'update' || mode === 'delete') {
        payload.whereColumns = ['id'];
      }
      if (mode === 'upsert') {
        payload.conflictColumns = ['id'];
      }
      
      const result = writeNodeDef.validate(payload);
      assert.strictEqual(result.ok, true, `Mode ${mode} should be valid`);
    }
  });

  test('Validation - invalid mode is accepted (validation only checks required fields)', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    // The validation doesn't validate mode values, only checks presence
    const result = writeNodeDef.validate({ 
      table: 'users', 
      mode: 'invalid_mode' as any,
      columns: ['name'],
      datasource: 'default'
    } as WritePayload);
    
    // Validation passes because required fields are present
    assert.strictEqual(result.ok, true);
  });

  test('Validation - empty columns array is invalid for non-delete modes', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    const result = writeNodeDef.validate({ 
      table: 'users', 
      mode: 'insert',
      columns: [],
      datasource: 'default'
    } as WritePayload);
    
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'MISSING_COLUMNS'));
  });

  test('Validation - missing table is caught', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    const result = writeNodeDef.validate({ 
      mode: 'insert',
      columns: ['name']
    } as WritePayload);
    
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.code === 'MISSING_TABLE'));
  });

  test('Validation - insert_ignore mode is valid', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    const result = writeNodeDef.validate({ 
      table: 'users', 
      mode: 'insert_ignore',
      columns: ['name'],
      datasource: 'default'
    } as WritePayload);
    
    assert.strictEqual(result.ok, true);
  });

  test('Validation - returning clause is optional', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    const result = writeNodeDef.validate({ 
      table: 'users', 
      mode: 'insert',
      columns: ['name'],
      datasource: 'default',
      returning: ['id']
    } as WritePayload);
    
    assert.strictEqual(result.ok, true);
  });

  test('Validation - batchSize is optional', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    const result = writeNodeDef.validate({ 
      table: 'users', 
      mode: 'insert',
      columns: ['name'],
      datasource: 'default',
      batchSize: 500
    } as WritePayload);
    
    assert.strictEqual(result.ok, true);
  });

  test('Validation - staticValues can be provided', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    const result = writeNodeDef.validate({ 
      table: 'users', 
      mode: 'insert',
      columns: ['name'],
      staticValues: { status: 'active' },
      datasource: 'default'
    } as WritePayload);
    
    assert.strictEqual(result.ok, true);
  });

  test('Validation - columnAliases can be provided', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    const result = writeNodeDef.validate({ 
      table: 'users', 
      mode: 'insert',
      columns: ['name'],
      columnAliases: { name: 'user_name' },
      datasource: 'default'
    } as WritePayload);
    
    assert.strictEqual(result.ok, true);
  });

  test('Infer output type - returns tabular', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    const outputType = writeNodeDef.inferOutputType({ table: 'users', datasource: 'default' } as WritePayload, { kind: 'tabular' });
    
    assert.strictEqual(outputType.kind, 'tabular');
  });

  test('Infer output type - preserves input type', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    const inputType = { kind: 'tabular' as const };
    const outputType = writeNodeDef.inferOutputType({ table: 'users', datasource: 'default' } as WritePayload, inputType);
    
    assert.strictEqual(outputType.kind, inputType.kind);
  });

  test('Node definition properties', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    assert.strictEqual(writeNodeDef.kind, 'write');
    assert.strictEqual(writeNodeDef.displayName, 'Write to Database');
    assert.strictEqual(writeNodeDef.inputPorts.length, 1);
    assert.strictEqual(writeNodeDef.inputPorts[0].key, 'input');
    assert.strictEqual(writeNodeDef.outputPorts.length, 1);
    assert.strictEqual(writeNodeDef.outputPorts[0].key, 'output');
    assert.strictEqual(writeNodeDef.inputPorts[0].required, true);
    assert.strictEqual(writeNodeDef.outputPorts[0].required, true);
    if (writeNodeDef.inputPorts[0].dataType !== 'infer') {
      assert.strictEqual(writeNodeDef.inputPorts[0].dataType.kind, 'tabular');
    }
    if (writeNodeDef.outputPorts[0].dataType !== 'infer') {
      assert.strictEqual(writeNodeDef.outputPorts[0].dataType.kind, 'tabular');
    }
  });

  test('Node definition - has icon and color', () => {
    const mockBackend = new MockStorageBackend({});
    const schema = createMockSchema();
    
    const writeNodeDef = createWriteNodeDefinition(mockBackend, schema);
    
    assert.strictEqual(writeNodeDef.icon, '💾');
    assert.strictEqual(writeNodeDef.color, '#F59E0B');
  });
});

console.log('WriteNode tests completed!');
