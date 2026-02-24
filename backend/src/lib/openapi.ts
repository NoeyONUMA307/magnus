import yaml from "js-yaml";

export interface OpenApiEndpoint {
  path: string;
  method: string;
  description: string | null;
  parameters: string[];
}

const HTTP_METHODS = new Set([
  "get", "post", "put", "patch", "delete", "head", "options",
]);

/**
 * Resolve a JSON pointer $ref within the same document.
 * Handles "#/components/schemas/Foo" style references.
 */
function resolveRef(root: Record<string, unknown>, ref: unknown): Record<string, unknown> | null {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
  const parts = ref.slice(2).split("/");
  let current: unknown = root;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "object" && current !== null
    ? current as Record<string, unknown>
    : null;
}

/**
 * If the object has a $ref, resolve it. Otherwise return the object as-is.
 */
function deref(root: Record<string, unknown>, obj: unknown): Record<string, unknown> | null {
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.$ref === "string") {
    return resolveRef(root, o.$ref);
  }
  return o;
}

/**
 * Extract parameter names from a parameters array, resolving $ref entries.
 */
function extractParams(root: Record<string, unknown>, params: unknown): string[] {
  if (!Array.isArray(params)) return [];
  const names: string[] = [];
  for (const raw of params) {
    const p = deref(root, raw);
    if (p && typeof p.name === "string") {
      names.push(p.name);
    }
  }
  return names;
}

export function extractEndpoints(
  spec: Record<string, unknown>
): OpenApiEndpoint[] {
  const endpoints: OpenApiEndpoint[] = [];
  const paths = spec.paths;
  if (typeof paths !== "object" || paths === null) return endpoints;

  for (const [path, rawMethods] of Object.entries(
    paths as Record<string, unknown>
  )) {
    // Resolve path-level $ref (e.g. "$ref": "#/components/pathItems/...")
    const methods = deref(spec, rawMethods);
    if (!methods) continue;

    // Collect path-level parameters (shared across all methods)
    const pathParams = extractParams(spec, methods.parameters);

    for (const [method, rawOperation] of Object.entries(methods)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;

      const op = deref(spec, rawOperation);
      if (!op) continue;

      const description =
        typeof op.summary === "string"
          ? op.summary
          : typeof op.description === "string"
            ? op.description
            : null;

      // Merge path-level + operation-level parameters
      const opParams = extractParams(spec, op.parameters);
      const allParams = [...new Set([...pathParams, ...opParams])];

      endpoints.push({
        path,
        method: method.toUpperCase(),
        description,
        parameters: allParams,
      });
    }
  }

  return endpoints;
}

/**
 * Parse a raw string as JSON or YAML, returning the spec object.
 * Throws on parse failure or if the result has no `paths` key.
 */
export function parseSpec(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  let parsed: unknown;

  // Try JSON first (faster, unambiguous)
  if (trimmed.startsWith("{")) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("Spec looks like JSON but is not valid JSON");
    }
  } else {
    // Try YAML
    try {
      parsed = yaml.load(trimmed);
    } catch {
      throw new Error("Spec is not valid JSON or YAML");
    }
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Spec must be a JSON or YAML object");
  }

  const spec = parsed as Record<string, unknown>;
  if (!spec.paths) {
    throw new Error("Spec must have a 'paths' key — paste a full OpenAPI 3.x or Swagger 2.x document");
  }

  return spec;
}
