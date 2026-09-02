// SemanticCache tests

import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { SemanticCache } from '@/cache/SemanticCache.js';
import type { Pool } from 'pg';
import type { CacheConfig } from '@/cache/SemanticCache.js';

// Mock VoyageClient
class MockVoyageClient {
  async embed(text: string): Promise<number[]> {
    // Return a simple mock embedding based on text length
    const embedding = new Array(1536).fill(0);
    for (let i = 0; i < text.length && i < embedding.length; i++) {
      embedding[i] = text.charCodeAt(i) / 255;
    }
    return embedding;
  }
}

// Mock Pool
class MockPool {
  private data: any[] = [];
  
  async query(sql: string, params?: any[]): Promise<{ rows: any[]; rowCount: number }> {
    // Return mock data for getStats query
    if (sql.includes('COUNT(*)')) {
      return { 
        rows: [{ total: '0', valid: '0', total_hits: '0' }], 
        rowCount: 1 
      };
    }
    if (sql.includes('ORDER BY hit_count')) {
      return { 
        rows: [], 
        rowCount: 0 
      };
    }
    // Default empty result
    return { rows: [], rowCount: 0 };
  }
}

describe('SemanticCache', () => {
  test('Create cache with config', () => {
    const voyageClient = new MockVoyageClient() as any;
    const pool = new MockPool() as unknown as Pool;
    const config: CacheConfig = {
      enabled: true,
      workspaceId: 1,
      sourceType: 'default',
      threshold: 0.85
    };

    const cache = new SemanticCache(voyageClient, pool, config);

    assert.ok(cache);
  });

  test('Lookup with disabled cache returns null', async () => {
    const voyageClient = new MockVoyageClient() as any;
    const pool = new MockPool() as unknown as Pool;
    const config: CacheConfig = {
      enabled: false,
      workspaceId: 1,
      sourceType: 'default',
      threshold: 0.85
    };

    const cache = new SemanticCache(voyageClient, pool, config);

    const result = await cache.lookup('test query');

    assert.strictEqual(result, null);
  });

  test('Store with disabled cache does nothing', async () => {
    const voyageClient = new MockVoyageClient() as any;
    const pool = new MockPool() as unknown as Pool;
    const config: CacheConfig = {
      enabled: false,
      workspaceId: 1,
      sourceType: 'default',
      threshold: 0.85
    };

    const cache = new SemanticCache(voyageClient, pool, config);

    // Should not throw
    await cache.store('test query', {} as any, {} as any, []);
  });

  test('InvalidateBySources with disabled cache returns 0', async () => {
    const voyageClient = new MockVoyageClient() as any;
    const pool = new MockPool() as unknown as Pool;
    const config: CacheConfig = {
      enabled: false,
      workspaceId: 1,
      sourceType: 'default',
      threshold: 0.85
    };

    const cache = new SemanticCache(voyageClient, pool, config);

    const count = await cache.invalidateBySources(['users'], 'test');

    assert.strictEqual(count, 0);
  });

  test('InvalidateAll with disabled cache returns 0', async () => {
    const voyageClient = new MockVoyageClient() as any;
    const pool = new MockPool() as unknown as Pool;
    const config: CacheConfig = {
      enabled: false,
      workspaceId: 1,
      sourceType: 'default',
      threshold: 0.85
    };

    const cache = new SemanticCache(voyageClient, pool, config);

    const count = await cache.invalidateAll('test');

    assert.strictEqual(count, 0);
  });

  test('GetStats with disabled cache returns zeros', async () => {
    const voyageClient = new MockVoyageClient() as any;
    const pool = new MockPool() as unknown as Pool;
    const config: CacheConfig = {
      enabled: false,
      workspaceId: 1,
      sourceType: 'default',
      threshold: 0.85
    };

    const cache = new SemanticCache(voyageClient, pool, config);

    const stats = await cache.getStats();

    assert.strictEqual(stats.total, 0);
    assert.strictEqual(stats.valid, 0);
    assert.strictEqual(stats.totalHits, 0);
    assert.strictEqual(stats.topEntries.length, 0);
  });

  test('Config threshold validation', () => {
    const voyageClient = new MockVoyageClient() as any;
    const pool = new MockPool() as unknown as Pool;
    
    const config: CacheConfig = {
      enabled: true,
      workspaceId: 1,
      sourceType: 'default',
      threshold: 0.85
    };

    const cache = new SemanticCache(voyageClient, pool, config);

    assert.ok(cache);
  });

  test('Config with different workspaceId', () => {
    const voyageClient = new MockVoyageClient() as any;
    const pool = new MockPool() as unknown as Pool;
    
    const config: CacheConfig = {
      enabled: true,
      workspaceId: 42,
      sourceType: 'default',
      threshold: 0.85
    };

    const cache = new SemanticCache(voyageClient, pool, config);

    assert.ok(cache);
  });

  test('Config with different sourceType', () => {
    const voyageClient = new MockVoyageClient() as any;
    const pool = new MockPool() as unknown as Pool;
    
    const config: CacheConfig = {
      enabled: true,
      workspaceId: 1,
      sourceType: 'custom',
      threshold: 0.85
    };

    const cache = new SemanticCache(voyageClient, pool, config);

    assert.ok(cache);
  });
});

console.log('SemanticCache tests completed!');
