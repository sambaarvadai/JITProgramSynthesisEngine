// Nodes module exports

import type { NodeRegistry } from '../core/registry/node-registry.js';
import Anthropic from '@anthropic-ai/sdk';

export * from './payloads.js';

export { inputNodeDefinition } from './definitions/input-node.js';
export { outputNodeDefinition } from './definitions/output-node.js';
export { transformNodeDefinition } from './definitions/transform-node.js';
export { queryNodeDefinition } from './definitions/query-node.js';
export { createLLMNodeDefinition } from './definitions/llm-node.js';
export { createHttpNodeDefinition } from './definitions/http-node.js';
export { createWriteNodeDefinition } from './definitions/write-node.js';
export { schemaBuilderNodeDefinition } from './schema-builder-node.js';
export { createOntologyBuilderNodeDefinition } from './ontology-builder-node.js';
export { conditionalNodeDefinition } from './definitions/conditional-node.js';
export { mergeNodeDefinition } from './definitions/merge-node.js';
export { parallelNodeDefinition } from './definitions/parallel-node.js';
export { loopNodeDefinition } from './definitions/loop-node.js';

import { inputNodeDefinition } from './definitions/input-node.js';
import { outputNodeDefinition } from './definitions/output-node.js';
import { transformNodeDefinition } from './definitions/transform-node.js';
import { queryNodeDefinition } from './definitions/query-node.js';
import { createLLMNodeDefinition } from './definitions/llm-node.js';
import { createHttpNodeDefinition } from './definitions/http-node.js';
import { createWriteNodeDefinition } from './definitions/write-node.js';
import { schemaBuilderNodeDefinition } from './schema-builder-node.js';
import { createOntologyBuilderNodeDefinition } from './ontology-builder-node.js';
import { conditionalNodeDefinition } from './definitions/conditional-node.js';
import { mergeNodeDefinition } from './definitions/merge-node.js';
import { parallelNodeDefinition } from './definitions/parallel-node.js';
import { loopNodeDefinition } from './definitions/loop-node.js';
import { validationFail } from '../core/types/validation.js';

export function registerAllNodes(
  registry: NodeRegistry,
  deps?: { anthropicApiKey?: string; evaluator?: any; storageBackend?: any; schema?: any; calciteClient?: any; sessionCursorStore?: any },
): void {
  registry.register(inputNodeDefinition);
  registry.register(outputNodeDefinition);
  registry.register(transformNodeDefinition);
  registry.register(queryNodeDefinition);
  registry.register(createHttpNodeDefinition(deps?.evaluator));
  registry.register(createWriteNodeDefinition(deps?.storageBackend, deps?.schema, deps?.calciteClient, deps?.sessionCursorStore));
  registry.register(conditionalNodeDefinition);
  registry.register(mergeNodeDefinition);
  registry.register(parallelNodeDefinition);
  registry.register(loopNodeDefinition);

  // Schema builder is stateless and uses the existing DDL-parsing logic
  registry.register(schemaBuilderNodeDefinition);

  // LLM node requires Anthropic client
  if (deps?.anthropicApiKey) {
    const client = new Anthropic({ apiKey: deps.anthropicApiKey });
    registry.register(createLLMNodeDefinition(client));
    registry.register(createOntologyBuilderNodeDefinition(client));
  } else {
    // Register a stub LLM node that throws an error
    registry.register({
      kind: 'llm',
      displayName: 'LLM',
      icon: '🤖',
      color: '#7C3AED',
      inputPorts: [{ key: 'input', label: 'Input', dataType: { kind: 'any' }, required: true }],
      outputPorts: [{ key: 'output', label: 'Output', dataType: { kind: 'any' }, required: true }],
      validate: () => validationFail([{ code: 'MISSING_API_KEY', message: 'LLMNode requires anthropicApiKey' }]),
      inferOutputType: () => ({ kind: 'any' }),
      execute: async () => {
        throw new Error('LLMNode requires anthropicApiKey to be provided');
      },
    });

    // Ontology builder also needs an LLM, so register a stub
    registry.register({
      kind: 'ontology-builder',
      displayName: 'Ontology Builder',
      icon: '🕸️',
      color: '#10B981',
      inputPorts: [{ key: 'input', label: 'Schema', dataType: { kind: 'schema' }, required: true }],
      outputPorts: [{ key: 'output', label: 'Candidate Mappings', dataType: { kind: 'tabular' }, required: true }],
      validate: () => validationFail([{ code: 'MISSING_API_KEY', message: 'OntologyBuilder requires anthropicApiKey' }]),
      inferOutputType: () => ({ kind: 'tabular' }),
      execute: async () => {
        throw new Error('OntologyBuilder requires anthropicApiKey to be provided');
      },
    });
  }
}
