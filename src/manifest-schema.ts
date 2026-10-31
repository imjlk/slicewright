import typia from 'typia';

import type { BuildManifest } from './build.js';

/** Where the published build manifest schema can be fetched by URL. */
export const buildManifestSchemaUrl = 'https://unpkg.com/slicewright/schema/build-manifest.schema.json';

/** A JSON Schema (draft 2020-12) node, as far as the manifest schema uses it. */
export interface JsonSchema {
  readonly [key: string]: unknown;
  readonly type?: string;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly items?: JsonSchema;
  readonly $ref?: string;
  readonly $defs?: Readonly<Record<string, JsonSchema>>;
}

/**
 * The build manifest's JSON Schema, generated from the `BuildManifest` type
 * that validates manifests, so editors can complete and check a manifest
 * that names it in `$schema`. Published as `schema/build-manifest.schema.json`.
 *
 * @evidence docs/spec.md#build-manifest Generates the published JSON Schema from the same type that validates manifests, refusing unknown keys and allowing $schema.
 * @evidenceReview docs/spec.md#build-manifest #fe9a80d Reread the section with the $schema key and published schema and checked this code against it line by line; ran buildsManifests and the manifest error tests green with pnpm test.
 */
export function buildManifestSchema(): JsonSchema {
  const unit = typia.json.schema<BuildManifest>();
  const defs = (unit.components.schemas ?? {}) as Record<string, unknown>;
  const { BuildManifest: root, ...rest } = defs;
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: buildManifestSchemaUrl,
    title: 'slicewright build manifest',
    ...(withDefs(root) as JsonSchema),
    $defs: Object.fromEntries(
      Object.entries(rest).map(([name, schema]) => [name, withDefs(schema)]),
    ) as Record<string, JsonSchema>,
  };
}

/** Moves OpenAPI component references to `$defs` and drops OpenAPI-only flags. */
function withDefs(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(withDefs);
  }
  if (node === null || typeof node !== 'object') {
    return node;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'readOnly') {
      continue;
    }
    out[key] =
      key === '$ref' && typeof value === 'string'
        ? value.replace('#/components/schemas/', '#/$defs/')
        : withDefs(value);
  }
  return out;
}

/**
 * The schema node at a manifest path such as `pieces[0].filter`, following
 * `$ref`s; undefined when the path leaves the schema.
 */
export function schemaAt(schema: JsonSchema, path: readonly (string | number)[]): JsonSchema | undefined {
  let node: JsonSchema | undefined = resolveRef(schema, schema);
  for (const step of path) {
    if (node === undefined) {
      return undefined;
    }
    node = resolveRef(schema, typeof step === 'number' ? node.items : node.properties?.[step]);
  }
  return node;
}

function resolveRef(root: JsonSchema, node: JsonSchema | undefined): JsonSchema | undefined {
  const name = node?.$ref?.replace('#/$defs/', '');
  return name === undefined ? node : root.$defs?.[name];
}
