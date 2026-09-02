// Schema builder node — thin wrapper around the existing init-time schema build logic.
// Builds/returns a BuiltSchema for a single datasource without duplicating introspection.

import { readFileSync } from 'fs';
import type { NodeDefinition } from '../core/registry/node-registry.js';
import type { DataType, DataValue } from '../core/types/data-value.js';
import { schema as makeSchemaDataValue } from '../core/types/data-value.js';
import type { ExecutionContext } from '../core/context/execution-context.js';
import { validationOk, validationFail } from '../core/types/validation.js';
import type { SchemaBuilderPayload } from './payloads.js';
import { buildSchemaFromSQL, type BuiltSchema } from '../schema/SchemaBuilder.js';
import { stripCreateTypes } from '../schema/MultiSourceSchemaBuilder.js';
import { dataSourceRegistry } from '../storage/DataSourceRegistry.js';

export interface SchemaArtifactData {
  datasourceId: string;
  schema: BuiltSchema;
}

export const schemaBuilderNodeDefinition: NodeDefinition<SchemaBuilderPayload, DataValue, DataValue> = {
  kind: 'schema-builder',
  displayName: 'Schema Builder',
  icon: '🗂️',
  color: '#0EA5E9',
  inputPorts: [],
  outputPorts: [{ key: 'output', label: 'Schema', dataType: { kind: 'schema' }, required: true }],

  validate(payload: unknown) {
    const p = payload as SchemaBuilderPayload;
    const errors: Array<{ code: string; message: string }> = [];

    if (!p?.datasourceId || typeof p.datasourceId !== 'string' || p.datasourceId.trim().length === 0) {
      errors.push({ code: 'MISSING_DATASOURCE', message: 'schema-builder requires a datasourceId' });
    }

    if (p?.refreshMode !== 'full' && p?.refreshMode !== 'incremental') {
      errors.push({
        code: 'INVALID_REFRESH_MODE',
        message: 'refreshMode must be "full" or "incremental"',
      });
    }

    return errors.length > 0 ? validationFail(errors) : validationOk();
  },

  inferOutputType(_payload: SchemaBuilderPayload, _inputType: DataType): DataType {
    return { kind: 'schema' };
  },

  async execute(payload: SchemaBuilderPayload, _input: DataValue, _ctx: ExecutionContext): Promise<DataValue> {
    const ds = dataSourceRegistry.get(payload.datasourceId);
    if (!ds) {
      throw new Error(`[SchemaBuilderNode] Unknown datasource: ${payload.datasourceId}`);
    }

    let built: BuiltSchema;

    if (payload.refreshMode === 'incremental') {
      if (!ds.schema) {
        throw new Error(
          `[SchemaBuilderNode] No cached schema for datasource '${payload.datasourceId}'; run refreshMode: 'full' first`
        );
      }
      built = ds.schema;
    } else {
      if (!ds.ddlPath) {
        throw new Error(
          `[SchemaBuilderNode] Datasource '${payload.datasourceId}' has no ddlPath; full refresh is not supported`
        );
      }

      const ddlRaw = readFileSync(ds.ddlPath, 'utf-8');
      const ddl = stripCreateTypes(ddlRaw);
      built = buildSchemaFromSQL(ddl, { sessionAnchorTables: ['workspaces'] });

      // Refresh the registry entry so downstream callers see the new schema immediately.
      (ds as any).schema = built;
    }

    const artifact: SchemaArtifactData = { datasourceId: payload.datasourceId, schema: built };
    return makeSchemaDataValue(artifact);
  },
};
