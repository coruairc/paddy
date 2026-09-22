/**
 * FE helpers for the path-keyed Config panel.
 * Prefers live `getConfigSchema` (Backend PR1); falls back to a tiny local
 * mirror of the same v1 const schema when the serverFn is unavailable.
 * Memory/skills fields are form-only until PR3 (not runtime SoT).
 */

export const CONFIG_SCHEMA_VERSION = 1 as const;

/** Schema defaults for agents.defaults.memory (from live Backend schema). */
export const MEMORY_SCHEMA_DEFAULTS = {
  enabled: true,
  memoryCharLimit: 2200,
  userCharLimit: 1375,
  recallLimit: 12,
  fts: true,
} as const;

export type SchemaNode = {
  type?: string | string[];
  const?: unknown;
  default?: unknown;
  writeOnly?: boolean;
  description?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  properties?: Record<string, SchemaNode>;
  additionalProperties?: boolean | SchemaNode;
  items?: SchemaNode;
};

export type ConfigFieldKind = "string" | "number" | "boolean" | "password" | "json";

export type ConfigFieldDef = {
  path: string;
  label: string;
  kind: ConfigFieldKind;
  description?: string;
  defaultValue?: unknown;
  writeOnly?: boolean;
  /** Form-only until a later runtime PR. */
  notRuntimeSot?: boolean;
  section: "gateway" | "brain" | "memory" | "skills" | "other";
};

const FALLBACK_SCHEMA: SchemaNode = {
  type: "object",
  properties: {
    version: { type: "integer", const: CONFIG_SCHEMA_VERSION },
    gateway: {
      type: "object",
      properties: {
        host: { type: "string", minLength: 1, default: "127.0.0.1" },
        port: { type: "integer", minimum: 1, maximum: 65535, default: 8080 },
        auth: {
          type: "object",
          properties: {
            mode: { type: "string", const: "token", default: "token" },
            token: {
              type: "string",
              writeOnly: true,
              description: "Maps to cli.token / ${PADDY_CLI_TOKEN}; never returned in plaintext",
            },
          },
        },
      },
    },
    brain: {
      type: "object",
      properties: {
        preferred: { type: "string", minLength: 1, default: "supergrok" },
        model: { type: "string" },
      },
    },
    agents: {
      type: "object",
      properties: {
        defaults: {
          type: "object",
          properties: {
            memory: {
              type: "object",
              properties: {
                enabled: { type: "boolean", default: MEMORY_SCHEMA_DEFAULTS.enabled },
                memoryCharLimit: {
                  type: "integer",
                  minimum: 0,
                  default: MEMORY_SCHEMA_DEFAULTS.memoryCharLimit,
                },
                userCharLimit: {
                  type: "integer",
                  minimum: 0,
                  default: MEMORY_SCHEMA_DEFAULTS.userCharLimit,
                },
                recallLimit: {
                  type: "integer",
                  minimum: 0,
                  default: MEMORY_SCHEMA_DEFAULTS.recallLimit,
                },
                fts: { type: "boolean", default: MEMORY_SCHEMA_DEFAULTS.fts },
              },
            },
          },
        },
      },
    },
    skills: {
      type: "object",
      description: "Skills load / allowlist (schema stub; not yet runtime SoT)",
    },
  },
};

export function fallbackConfigSchema(): SchemaNode {
  return structuredClone(FALLBACK_SCHEMA);
}

function schemaAt(root: SchemaNode, path: string): SchemaNode | undefined {
  const parts = path.split(".").filter(Boolean);
  let cur: SchemaNode | undefined = root;
  for (const part of parts) {
    if (!cur?.properties?.[part]) return undefined;
    cur = cur.properties[part];
  }
  return cur;
}

function kindFromSchema(node: SchemaNode | undefined, path: string): ConfigFieldKind {
  if (node?.writeOnly || /\.(token|secret|password|pass)$/i.test(path)) return "password";
  const t = Array.isArray(node?.type) ? node?.type[0] : node?.type;
  if (t === "boolean") return "boolean";
  if (t === "integer" || t === "number") return "number";
  if (t === "object" || t === "array") return "json";
  return "string";
}

function sectionFor(path: string): ConfigFieldDef["section"] {
  if (path.startsWith("gateway.")) return "gateway";
  if (path.startsWith("brain.")) return "brain";
  if (path.startsWith("agents.defaults.memory")) return "memory";
  if (path.startsWith("skills")) return "skills";
  return "other";
}

/** Curated Control UI paths — mirrors Backend mapping docs. */
export const CONFIG_PANEL_PATHS = [
  "gateway.host",
  "gateway.port",
  "gateway.auth.mode",
  "gateway.auth.token",
  "brain.preferred",
  "brain.model",
  "agents.defaults.memory.enabled",
  "agents.defaults.memory.memoryCharLimit",
  "agents.defaults.memory.userCharLimit",
  "agents.defaults.memory.recallLimit",
  "agents.defaults.memory.fts",
] as const;

export function buildConfigFields(schema: SchemaNode | null | undefined): ConfigFieldDef[] {
  const root = schema?.properties ? schema : fallbackConfigSchema();
  return CONFIG_PANEL_PATHS.map((path) => {
    const node = schemaAt(root, path);
    const leaf = path.split(".").pop() || path;
    const notRuntimeSot =
      path.startsWith("agents.defaults.memory") || path.startsWith("skills");
    return {
      path,
      label: leaf,
      kind: kindFromSchema(node, path),
      description: node?.description,
      defaultValue: node?.default ?? (node?.const !== undefined ? node.const : undefined),
      writeOnly: Boolean(node?.writeOnly) || path === "gateway.auth.token",
      notRuntimeSot,
      section: sectionFor(path),
    };
  });
}

export function getByDottedPath(root: unknown, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let cur: unknown = root;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function valueForField(
  config: Record<string, unknown> | null | undefined,
  field: ConfigFieldDef,
): unknown {
  if (!config) return field.defaultValue;
  // gateway.auth is a synthetic alias — token writeOnly never comes back in plaintext
  if (field.path === "gateway.auth.token") return "";
  if (field.path === "gateway.auth.mode") {
    const mode = getByDottedPath(config, "gateway.auth.mode");
    if (mode != null) return mode;
    // Alias: if cli.token exists, mode is token
    return "token";
  }
  const hit = getByDottedPath(config, field.path);
  if (hit !== undefined) return hit;
  // memory defaults from schema when unset on disk
  if (field.path.startsWith("agents.defaults.memory.") && field.defaultValue !== undefined) {
    return field.defaultValue;
  }
  return field.defaultValue;
}

export function parseFieldInput(kind: ConfigFieldKind, raw: string): unknown {
  const t = raw.trim();
  if (kind === "boolean") return t === "true" || t === "1" || t.toLowerCase() === "yes";
  if (kind === "number") {
    const n = Number(t);
    if (!Number.isFinite(n)) throw new Error("expected a number");
    return n;
  }
  if (kind === "json") {
    if (!t) return {};
    return JSON.parse(t) as unknown;
  }
  return raw;
}

export function formatFieldDisplay(value: unknown, kind: ConfigFieldKind): string {
  if (value == null) return "";
  if (kind === "password") return "";
  if (kind === "json") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return String(value);
}
