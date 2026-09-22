/**
 * FE helpers for the path-keyed Config panel + Guided Setup.
 * Prefers live `getConfigSchema`; falls back to a tiny local mirror of the
 * same v1 const schema when the serverFn is unavailable.
 * agents.defaults.memory is runtime SoT via resolveMemoryLimits / memoryStatus.
 * skills nested keys remain form-only (not yet runtime SoT).
 *
 * Guided Setup section ids/paths lock to Backend `paddy configure`
 * CONFIGURE_SECTIONS (PR #6) — do not invent a second schema.
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

export type ConfigPanelSection = "gateway" | "brain" | "memory" | "skills" | "other";

/** Locked contract with Backend configure-wizard CONFIGURE_SECTIONS. */
export type SetupSectionId =
  | "workspace"
  | "model"
  | "gateway"
  | "channels"
  | "memory"
  | "skills"
  | "health"
  | "done";

export type ConfigFieldDef = {
  path: string;
  label: string;
  kind: ConfigFieldKind;
  description?: string;
  defaultValue?: unknown;
  writeOnly?: boolean;
  /** Form-only until a later runtime PR. */
  notRuntimeSot?: boolean;
  section: ConfigPanelSection;
};

export type SetupSectionDef = {
  id: SetupSectionId;
  label: string;
  hint: string;
  paths: readonly string[];
};

/**
 * Same order/ids/paths as Backend `CONFIGURE_SECTIONS` in configure-wizard.mjs.
 * Plugins / Daemon intentionally omitted (no persist surface yet).
 */
export const SETUP_SECTIONS: readonly SetupSectionDef[] = Object.freeze([
  {
    id: "workspace",
    label: "Workspace",
    hint: "agents.defaults.workspace path",
    paths: ["agents.defaults.workspace"],
  },
  {
    id: "model",
    label: "Model / Brain",
    hint: "searchable provider → model → brain.preferred / brain.model",
    paths: ["brain.preferred", "brain.model"],
  },
  {
    id: "gateway",
    label: "Gateway",
    hint: "host, port, auth token → cli.token / .env",
    paths: ["gateway.host", "gateway.port", "gateway.auth.token"],
  },
  {
    id: "channels",
    label: "Channels",
    hint: "list / add / edit channel accounts",
    paths: ["channels"],
  },
  {
    id: "memory",
    label: "Memory",
    hint: "agents.defaults.memory caps",
    paths: [
      "agents.defaults.memory.enabled",
      "agents.defaults.memory.memoryCharLimit",
      "agents.defaults.memory.userCharLimit",
      "agents.defaults.memory.recallLimit",
      "agents.defaults.memory.fts",
    ],
  },
  {
    id: "skills",
    label: "Skills",
    hint: "skills.load.extraDirs / skills.allow",
    paths: ["skills.load.extraDirs", "skills.allow"],
  },
  {
    id: "health",
    label: "Health",
    hint: "validate + doctor-lite snapshot",
    paths: [],
  },
  {
    id: "done",
    label: "Skip / Done",
    hint: "Leave the wizard",
    paths: [],
  },
]);

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
    channels: {
      type: "object",
      additionalProperties: { type: "object" },
      description: "Channel accounts keyed by id (telegram, discord, …)",
    },
    agents: {
      type: "object",
      properties: {
        defaults: {
          type: "object",
          properties: {
            workspace: {
              type: "string",
              description: "Default agent workspace directory",
            },
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
      properties: {
        load: {
          type: "object",
          properties: {
            extraDirs: { type: "array", items: { type: "string" } },
          },
        },
        allow: { type: "array", items: { type: "string" } },
      },
    },
    // Locked with Backend Phase B: openclaw.runtime|url|token|model
    openclaw: {
      type: "object",
      description:
        "Opt-in OpenClaw gateway (runtime openclaw|paddy, url, writeOnly token → ${OPENCLAW_GATEWAY_TOKEN}, model)",
      properties: {
        runtime: {
          type: "string",
          description: '"openclaw" | "paddy" — hosted demo forces paddy',
          default: "paddy",
        },
        url: { type: "string", description: "OpenClaw gateway base URL" },
        token: {
          type: "string",
          writeOnly: true,
          description: "Gateway bearer (${OPENCLAW_GATEWAY_TOKEN}); never returned in plaintext",
        },
        model: { type: "string", description: "OpenClaw agent target id", default: "openclaw" },
      },
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
  // Setup paths that may precede schema merge (e.g. workspace before PR #6 lands)
  if (path === "channels" || path === "skills.load.extraDirs" || path === "skills.allow") {
    return "json";
  }
  return "string";
}

function sectionFor(path: string): ConfigPanelSection {
  if (path.startsWith("gateway.")) return "gateway";
  if (path.startsWith("brain.")) return "brain";
  if (path.startsWith("agents.defaults.memory")) return "memory";
  if (path.startsWith("skills")) return "skills";
  if (path.startsWith("openclaw")) return "gateway";
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

/** writeOnly secrets — never echo, never localStorage. Matches Backend isWriteOnlySecretPath. */
export function isWriteOnlySecretPath(path: string): boolean {
  const n = String(path || "")
    .trim()
    .toLowerCase();
  return (
    n === "gateway.auth.token" ||
    n === "gateway.auth" ||
    n === "cli.token" ||
    n === "openclaw.token" ||
    n === "openclaw"
  );
}

export function fieldDefFromPath(
  schema: SchemaNode | null | undefined,
  path: string,
): ConfigFieldDef {
  const root = schema?.properties ? schema : fallbackConfigSchema();
  const node = schemaAt(root, path);
  const leaf = path.split(".").pop() || path;
  const notRuntimeSot = path.startsWith("skills");
  return {
    path,
    label: leaf,
    kind: kindFromSchema(node, path),
    description: node?.description,
    defaultValue: node?.default ?? (node?.const !== undefined ? node.const : undefined),
    writeOnly: Boolean(node?.writeOnly) || isWriteOnlySecretPath(path),
    notRuntimeSot,
    section: sectionFor(path),
  };
}

export function buildConfigFields(schema: SchemaNode | null | undefined): ConfigFieldDef[] {
  return CONFIG_PANEL_PATHS.map((path) => fieldDefFromPath(schema, path));
}

export function setupSectionById(id: SetupSectionId): SetupSectionDef | undefined {
  return SETUP_SECTIONS.find((s) => s.id === id);
}

/** Schema-backed fields for one Guided Setup section (empty for health/done). */
export function buildSetupFields(
  schema: SchemaNode | null | undefined,
  sectionId: SetupSectionId,
): ConfigFieldDef[] {
  const section = setupSectionById(sectionId);
  if (!section?.paths.length) return [];
  return section.paths.map((path) => fieldDefFromPath(schema, path));
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
  if (isWriteOnlySecretPath(field.path) && field.path !== "gateway.auth") return "";
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

/** Non-secret local flag for first-run banner (never stores tokens). */
export const SETUP_DISMISSED_KEY = "paddy.guidedSetup.dismissed";

export function isSetupDismissed(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(SETUP_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSetupDismissed(dismissed: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (dismissed) localStorage.setItem(SETUP_DISMISSED_KEY, "1");
    else localStorage.removeItem(SETUP_DISMISSED_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}
