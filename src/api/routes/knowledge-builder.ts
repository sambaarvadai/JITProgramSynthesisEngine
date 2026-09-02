// Knowledge builder trigger — plain sequential service, not a DAG.
// POST /api/datasources/:id/build-knowledge

import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import type { BootstrappedServices } from '../../bootstrap.js';
import { NodeRegistry } from '../../core/registry/node-registry.js';
import { createExecutionContext } from '../../core/context/execution-context.js';
import { void_ } from '../../core/types/data-value.js';
import { registerAllNodes } from '../../nodes/index.js';

export interface KnowledgeBuilderRouteDeps {
  nodeRegistry?: NodeRegistry;
  anthropicApiKey?: string;
}

let services: BootstrappedServices | null = null;

export function setKnowledgeBuilderServices(s: BootstrappedServices | null): void {
  services = s;
}

function createDefaultNodeRegistry(apiKey?: string): NodeRegistry {
  const registry = new NodeRegistry();
  registerAllNodes(registry, { anthropicApiKey: apiKey });
  return registry;
}

export function knowledgeBuilderRoutes(deps?: KnowledgeBuilderRouteDeps): Router {
  const router = Router();
  const nodeRegistry = deps?.nodeRegistry ?? createDefaultNodeRegistry(process.env.ANTHROPIC_API_KEY);
  const anthropicApiKey = deps?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;

  router.post('/:id/build-knowledge', async (req: Request, res: Response) => {
    console.log('[API] POST /api/datasources/:id/build-knowledge called', req.params.id);

    if (!services) {
      res.status(500).json({
        error: { code: 'SERVICES_NOT_INITIALIZED', message: 'Services not initialized' },
      });
      return;
    }

    if (!anthropicApiKey) {
      res.status(503).json({
        error: {
          code: 'LLM_UNAVAILABLE',
          message: 'Ontology builder requires ANTHROPIC_API_KEY to be configured',
        },
      });
      return;
    }

    const datasourceId = req.params.id;
    const userId = (req as any).userId ?? '1';

    try {
      const ctx = createExecutionContext({
        pipelineId: 'knowledge-builder',
        sessionId: crypto.randomUUID(),
        userId,
      });

      const schemaNode = nodeRegistry.get('schema-builder');
      const schemaPayload = { datasourceId, refreshMode: 'full' as const };
      const schemaResult = await schemaNode.execute(schemaPayload, void_, ctx);

      const ontologyNode = nodeRegistry.get('ontology-builder');
      const ontologyPayload = { datasourceIds: [datasourceId] };
      const ontologyResult = await ontologyNode.execute(ontologyPayload, schemaResult, ctx);

      res.json({ mappings: ontologyResult.data.rows });
    } catch (error) {
      console.error('[API] Knowledge builder error:', error);
      res.status(500).json({
        error: {
          code: 'KNOWLEDGE_BUILDER_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  });

  return router;
}
