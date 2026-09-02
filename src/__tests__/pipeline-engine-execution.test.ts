// PipelineEngine execution tests

import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { PipelineEngine } from '../pipeline-engine.js';
import type { PipelineIntent } from '../compiler/pipeline/index.js';

describe('PipelineEngine Execution', () => {
  test('Compile and run simple linear pipeline', async () => {
    const engine = new PipelineEngine({
      anthropicApiKey: 'test-key',
    });

    const intent: PipelineIntent = {
      description: 'Simple fetch and transform',
      steps: [
        { id: 'fetch', kind: 'query', description: 'Fetch data' },
        {
          id: 'transform',
          kind: 'transform',
          description: 'Add field',
          dependsOn: ['fetch'],
        },
      ],
    };

    const plan = await engine.compiler.compile(intent);

    assert.strictEqual(plan.errors.length, 0);
    assert.ok(plan.graph.nodes.has('fetch'));
    assert.ok(plan.graph.nodes.has('transform'));
  });

  test('Compile pipeline with conditional', async () => {
    const engine = new PipelineEngine({
      anthropicApiKey: 'test-key',
    });

    const intent: PipelineIntent = {
      description: 'Conditional workflow',
      steps: [
        { id: 'fetch', kind: 'query', description: 'Fetch data' },
        {
          id: 'check',
          kind: 'conditional',
          description: 'Check condition',
          dependsOn: ['fetch'],
          trueBranch: 'transform_a',
          falseBranch: 'transform_b',
          mergeStep: 'merge',
        },
        {
          id: 'transform_a',
          kind: 'transform',
          description: 'Transform A',
        },
        {
          id: 'transform_b',
          kind: 'transform',
          description: 'Transform B',
        },
        {
          id: 'merge',
          kind: 'merge',
          description: 'Merge',
          mergeFrom: ['transform_a', 'transform_b'],
        },
      ],
    };

    const plan = await engine.compiler.compile(intent);

    assert.strictEqual(plan.errors.length, 0);
    assert.ok(plan.graph.nodes.has('check'));
    assert.ok(plan.graph.nodes.has('transform_a'));
    assert.ok(plan.graph.nodes.has('transform_b'));
    assert.ok(plan.graph.nodes.has('merge'));
  });

  test('Compile pipeline with loop', async () => {
    const engine = new PipelineEngine({
      anthropicApiKey: 'test-key',
    });

    const intent: PipelineIntent = {
      description: 'Loop workflow',
      steps: [
        { id: 'fetch', kind: 'query', description: 'Fetch data' },
        {
          id: 'loop',
          kind: 'loop',
          description: 'Loop over data',
          dependsOn: ['fetch'],
          loopMode: 'forEach',
          loopBody: ['transform'],
        },
        {
          id: 'transform',
          kind: 'transform',
          description: 'Transform each item',
        },
      ],
    };

    const plan = await engine.compiler.compile(intent);

    assert.strictEqual(plan.errors.length, 0);
    assert.ok(plan.graph.nodes.has('loop'));
    assert.ok(plan.graph.nodes.has('transform'));
  });

  test('Compile pipeline with write node', async () => {
    const engine = new PipelineEngine({
      anthropicApiKey: 'test-key',
    });

    const intent: PipelineIntent = {
      description: 'Write workflow',
      steps: [
        { id: 'fetch', kind: 'query', description: 'Fetch data' },
        {
          id: 'write',
          kind: 'write',
          description: 'Write to table',
          dependsOn: ['fetch'],
        },
      ],
    };

    const plan = await engine.compiler.compile(intent);

    assert.strictEqual(plan.errors.length, 0);
    assert.ok(plan.graph.nodes.has('fetch'));
    assert.ok(plan.graph.nodes.has('write'));
  });

  test('Format plan output', () => {
    const engine = new PipelineEngine({
      anthropicApiKey: 'test-key',
    });

    const plan = {
      intent: {
        description: 'Test pipeline',
        steps: [
          { id: 'step1', kind: 'query' as const, description: 'Fetch data' },
          {
            id: 'step2',
            kind: 'transform' as const,
            description: 'Transform data',
            dependsOn: ['step1'],
          },
        ],
      },
      graph: {
        id: 'test-graph',
        version: 1,
        nodes: new Map(),
        edges: new Map(),
        entryNode: '_input',
        exitNodes: ['_output'],
        metadata: {
          description: 'Test pipeline',
          createdAt: Date.now(),
          tags: [],
          budget: {},
        },
      },
      compilationErrors: [],
      intentRaw: '{"description":"Test pipeline"}',
    };

    const formatted = engine.formatPlan(plan);

    assert.ok(formatted.includes('Test pipeline'));
    assert.ok(formatted.includes('Fetch data'));
    assert.ok(formatted.includes('Transform data'));
  });

  test('Handle empty steps', async () => {
    const engine = new PipelineEngine({
      anthropicApiKey: 'test-key',
    });

    const intent: PipelineIntent = {
      description: 'Empty pipeline',
      steps: [],
    };

    const plan = await engine.compiler.compile(intent);

    // Should handle gracefully
    assert.ok(plan);
  });

  test('Handle missing dependencies', async () => {
    const engine = new PipelineEngine({
      anthropicApiKey: 'test-key',
    });

    const intent: PipelineIntent = {
      description: 'Pipeline with missing dependency',
      steps: [
        {
          id: 'transform',
          kind: 'transform',
          description: 'Transform',
          dependsOn: ['nonexistent'],
        },
      ],
    };

    const plan = await engine.compiler.compile(intent);

    // Should have compilation errors
    assert.ok(plan.errors.length > 0);
  });
});

console.log('PipelineEngine execution tests completed!');
