/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Canonical Paddy configuration.
 *
 *   ~/.paddy/config.json   structure and behaviour (JSON, versioned)
 *   ~/.paddy/.env          secrets and environment-specific values
 *
 * OpenClaw (~/.openclaw/openclaw.json) and Hermes (~/.hermes/.env) are
 * import/export compatibility formats. They are not sources of truth.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  detectLineage,
  LINEAGE_CHANNELS,
  mergeHermesEnvText,
  mergeOpenClawText,
  parseDotEnv,
  parseHermesEnv,
  parseOpenClawChannels,
  readLineageAccounts,
} from "./lineage.mjs";

export const SCHEMA_VERSION = 1;
export const CHANNEL_IDS = [...LINEAGE_CHANNELS];
export const ACCESS_MODES = ["pairing", "allowlist", "open"];

/** Secret fields stored as ${ENV} refs in config.json. */
export const SECRET_ENV = {
  telegram: { token: "TELEGRAM_BOT_TOKEN" },
  discord: { token: "DISCORD_BOT_TOKEN" },
  slack: { token: "SLACK_BOT_TOKEN", appToken: "SLACK_APP_TOKEN" },
  whatsapp: { token: "WHATSAPP_TOKEN", verifyToken: "WHATSAPP_VERIFY_TOKEN" },
  signal: { host: "SIGNAL_HTTP_URL", number: "SIGNAL_ACCOUNT" },
  email: { pass: "IMAP_PASS" },
};

const CLI_TOKEN_ENV = "PADDY_CLI_TOKEN";

/**
 * @typedef {{
 *   token?: string,
 *   appToken?: string,
 *   phoneId?: string,
 *   verifyToken?: string,
 *   number?: string,
 *   host?: string,
 *   user?: string,
 *   pass?: string,
 *   from?: string,
 *   port?: number,
 *   dmPolicy?: string,
 *   allowFrom?: string[],
 *   requireMention?: boolean,
 *   enabled?: boolean,
 * }} ChannelAccount
 * @typedef {Record<string, ChannelAccount | undefined>} AccountMap
 */

export function paddyHome() {
  return process.env.PADDY_HOME?.trim() || join(homedir(), ".paddy");
}

export function configPath(home = paddyHome()) {
  return join(home, "config.json");
}

export function secretsPath(home = paddyHome()) {
  return join(home, ".env");
}

export function pairingPath(home = paddyHome()) {
  return join(home, "pairing.json");
}

export function legacyChannelsPath(home = paddyHome()) {
  return join(home, "channels.json");
}

export function defaultCanonical() {
  return {
    version: SCHEMA_VERSION,
    gateway: { host: "127.0.0.1", port: 8080 },
    cli: { token: `\${${CLI_TOKEN_ENV}}` },
    brain: { preferred: "supergrok" },
    kit: {},
    channels: {},
    mcp: { servers: {} },
  };
}

export function isEnvRef(value) {
  return typeof value === "string" && /^\$\{[A-Z][A-Z0-9_]*\}$/.test(value.trim());
}

export function envRefName(value) {
  const m = typeof value === "string" ? value.trim().match(/^\$\{([A-Z][A-Z0-9_]*)\}$/) : null;
  return m ? m[1] : "";
}

export function interpolate(value, env = {}) {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_, name) => {
    const v = env[name];
    return typeof v === "string" ? v : "";
  });
}

export function redactValue(value) {
  if (typeof value !== "string" || !value.trim()) return value;
  if (isEnvRef(value)) return value;
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 4)}…${value.slice(-3)}`;
}

function looksSecretKey(key) {
  return /token|secret|pass|password|key/i.test(String(key || ""));
}

export function redactConfig(config) {
  const walk = (node, key = "") => {
    if (Array.isArray(node)) return node.map((x) => walk(x, key));
    if (!node || typeof node !== "object") {
      if (typeof node === "string" && (looksSecretKey(key) || (!isEnvRef(node) && node.length > 12 && looksSecretKey(key)))) {
        return redactValue(node);
      }
      if (typeof node === "string" && looksSecretKey(key) && node && !isEnvRef(node)) return redactValue(node);
      return node;
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = walk(v, k);
    return out;
  };
  return walk(config);
}

/**
 * Path-addressed config (OpenClaw-style get/set/unset) over flat ~/.paddy/config.json.
 *
 * Mapping (v1 disk ↔ familiar OpenClaw-shaped paths):
 *   gateway.host | gateway.port     → config.gateway.*
 *   gateway.auth / gateway.auth.token → cli.token  (${PADDY_CLI_TOKEN}); never persist gateway.auth
 *   gateway.auth.mode (virtual)     → "token" (get synthesizes; set accepts only "token")
 *   brain.preferred | brain.model   → config.brain.*
 *   channels.<id>.*                 → config.channels.*
 *   agents.defaults.memory.*        → optional nested keys (schema/FE; not yet runtime SoT)
 *   skills.*                        → optional nested keys (schema/FE; not yet runtime SoT)
 *
 * Do not invent a full OpenClawConfig v2 document yet — paths address the v1 JSON file.
 */

const BLOCKED_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

/** @type {Record<string, string>} */
const PATH_ALIASES = {
  "gateway.auth.token": "cli.token",
};

export function parseConfigPath(path) {
  const raw = String(path ?? "").trim();
  if (!raw) {
    const err = new Error("config path is required");
    err.code = "ECONFIG_PATH";
    throw err;
  }
  const segments = raw.split(".").map((s) => s.trim()).filter(Boolean);
  if (!segments.length) {
    const err = new Error("config path is required");
    err.code = "ECONFIG_PATH";
    throw err;
  }
  for (const seg of segments) {
    if (BLOCKED_SEGMENTS.has(seg)) {
      const err = new Error(`Invalid path segment: ${seg}`);
      err.code = "ECONFIG_PATH";
      throw err;
    }
  }
  return segments;
}

export function normalizeConfigPath(path) {
  return parseConfigPath(path).join(".");
}

export function resolveConfigPathAlias(path) {
  const normalized = normalizeConfigPath(path);
  return PATH_ALIASES[normalized] || normalized;
}

export function getAtPath(root, path) {
  const segments = typeof path === "string" ? parseConfigPath(path) : path;
  let current = root;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return { found: false };
    }
    if (!Object.hasOwn(current, segment)) return { found: false };
    current = current[segment];
  }
  return { found: true, value: current };
}

export function setAtPath(root, path, value) {
  const segments = typeof path === "string" ? parseConfigPath(path) : path;
  if (!segments.length) {
    const err = new Error("config path is required");
    err.code = "ECONFIG_PATH";
    throw err;
  }
  const clone = root && typeof root === "object" && !Array.isArray(root) ? { ...root } : {};
  let cursor = clone;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const next = cursor[seg];
    const child =
      next && typeof next === "object" && !Array.isArray(next) ? { ...next } : {};
    cursor[seg] = child;
    cursor = child;
  }
  cursor[segments[segments.length - 1]] = value;
  return clone;
}

export function unsetAtPath(root, path) {
  const segments = typeof path === "string" ? parseConfigPath(path) : path;
  if (!segments.length) {
    const err = new Error("config path is required");
    err.code = "ECONFIG_PATH";
    throw err;
  }
  const hit = getAtPath(root, segments);
  if (!hit.found) return { found: false, config: root };
  const clone = root && typeof root === "object" && !Array.isArray(root) ? { ...root } : {};
  let cursor = clone;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const next = cursor[seg];
    const child =
      next && typeof next === "object" && !Array.isArray(next) ? { ...next } : {};
    cursor[seg] = child;
    cursor = child;
  }
  delete cursor[segments[segments.length - 1]];
  return { found: true, config: clone };
}

function redactPathValue(path, value) {
  const leaf = String(path).split(".").pop() || "";
  if (typeof value === "string" && looksSecretKey(leaf) && value && !isEnvRef(value)) {
    return redactValue(value);
  }
  if (value && typeof value === "object") return redactConfig(value);
  return value;
}

/** Drop gateway.auth from disk shape — v1 stores the bearer only as cli.token / .env. */
function stripGatewayAuth(config) {
  if (!config?.gateway || typeof config.gateway !== "object" || Array.isArray(config.gateway)) {
    return config;
  }
  if (!Object.hasOwn(config.gateway, "auth")) return config;
  const gateway = { ...config.gateway };
  delete gateway.auth;
  return { ...config, gateway };
}

function isGatewayAuthPath(path) {
  const normalized = normalizeConfigPath(path);
  return normalized === "gateway.auth" || normalized.startsWith("gateway.auth.");
}

/**
 * Move plaintext CLI bearer into ${PADDY_CLI_TOKEN}.
 * Also rescues gateway.auth.token if a caller wrote the parent object before stripping.
 */
function extractCliToken(config, envPatch = {}) {
  let next = { ...config, cli: { ...(config.cli || {}) } };
  const patch = { ...envPatch };
  const authTok = next.gateway?.auth?.token;
  if (
    typeof authTok === "string" &&
    authTok &&
    !isEnvRef(authTok) &&
    (typeof next.cli.token !== "string" || !next.cli.token || isEnvRef(next.cli.token))
  ) {
    next.cli.token = authTok;
  }
  if (typeof next.cli.token === "string" && next.cli.token && !isEnvRef(next.cli.token)) {
    patch[CLI_TOKEN_ENV] = next.cli.token;
    next.cli.token = `\${${CLI_TOKEN_ENV}}`;
  }
  next = stripGatewayAuth(next);
  return { config: next, envPatch: patch };
}

/**
 * JSON Schema subset for path-keyed Control UI / FE forms.
 * Stable stub — properties match FE contract; disk remains v1 flat config.json.
 */
export function canonicalConfigSchema() {
  return {
    $id: "https://paddy.local/schemas/config.v1.json",
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "PaddyConfig",
    description:
      "Path-keyed subset over ~/.paddy/config.json (v1). OpenClaw-shaped agents.defaults.memory / skills are accepted for FE forms; runtime still uses flat brain/channels/gateway until a later PR.",
    type: "object",
    additionalProperties: true,
    properties: {
      version: { type: "integer", const: SCHEMA_VERSION },
      gateway: {
        type: "object",
        additionalProperties: true,
        properties: {
          host: { type: "string", minLength: 1, description: "Bind / connect host" },
          port: { type: "integer", minimum: 1, maximum: 65535 },
          auth: {
            type: "object",
            additionalProperties: false,
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
        additionalProperties: true,
        properties: {
          preferred: { type: "string", minLength: 1, description: "Provider id (supergrok, chatgpt, …)" },
          model: { type: "string", description: "Optional model override" },
        },
      },
      channels: {
        type: "object",
        additionalProperties: { type: "object" },
        description: "Channel accounts keyed by id (telegram, discord, …)",
      },
      agents: {
        type: "object",
        additionalProperties: true,
        properties: {
          defaults: {
            type: "object",
            additionalProperties: true,
            properties: {
              workspace: {
                type: "string",
                description: "Default agent workspace directory",
              },
              memory: {
                type: "object",
                additionalProperties: false,
                properties: {
                  enabled: { type: "boolean", default: true },
                  memoryCharLimit: { type: "integer", minimum: 0, default: 2200 },
                  userCharLimit: { type: "integer", minimum: 0, default: 1375 },
                  recallLimit: { type: "integer", minimum: 0, default: 12 },
                  fts: { type: "boolean", default: true },
                },
              },
            },
          },
        },
      },
      skills: {
        type: "object",
        additionalProperties: true,
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
      cli: {
        type: "object",
        additionalProperties: true,
        properties: {
          token: {
            type: "string",
            writeOnly: true,
            description: "Bearer for CLI + non-loopback dashboard (${PADDY_CLI_TOKEN})",
          },
        },
      },
      kit: { type: "object", additionalProperties: true },
      mcp: {
        type: "object",
        properties: {
          servers: { type: "object", additionalProperties: true },
        },
      },
    },
  };
}

export function configGet(path, { home = paddyHome() } = {}) {
  const alias = resolveConfigPathAlias(path);
  const { config } = loadCanonical({ home, persist: true });
  if (normalizeConfigPath(path) === "gateway.auth") {
    const tokenHit = getAtPath(config, "cli.token");
    const value = {
      mode: "token",
      token: tokenHit.found ? redactPathValue("cli.token", tokenHit.value) : undefined,
    };
    return { ok: true, path: normalizeConfigPath(path), value, aliasedTo: "cli.token" };
  }
  const hit = getAtPath(config, alias);
  if (!hit.found) {
    const err = new Error(`Config path not found: ${normalizeConfigPath(path)}`);
    err.code = "ECONFIG_PATH";
    throw err;
  }
  return {
    ok: true,
    path: normalizeConfigPath(path),
    value: redactPathValue(alias, hit.value),
    ...(alias !== normalizeConfigPath(path) ? { aliasedTo: alias } : {}),
  };
}

export function configSet(path, value, { home = paddyHome(), merge = false } = {}) {
  const normalized = normalizeConfigPath(path);
  let alias = resolveConfigPathAlias(path);
  const { config } = loadCanonical({ home, persist: true });

  // Parent object gateway.auth → rewrite token onto cli.token; never persist gateway.auth.
  if (normalized === "gateway.auth") {
    let authValue = value;
    if (merge && authValue && typeof authValue === "object" && !Array.isArray(authValue)) {
      const tokenHit = getAtPath(config, "cli.token");
      const current = {
        mode: "token",
        ...(tokenHit.found && tokenHit.value != null ? { token: tokenHit.value } : {}),
      };
      authValue = { ...current, ...authValue };
    }
    if (!authValue || typeof authValue !== "object" || Array.isArray(authValue)) {
      const err = new Error("gateway.auth must be an object");
      err.code = "ECONFIG_VALUE";
      throw err;
    }
    if (authValue.mode != null && String(authValue.mode) !== "token") {
      const err = new Error('gateway.auth.mode must be "token"');
      err.code = "ECONFIG_VALUE";
      throw err;
    }
    let next = config;
    if (Object.hasOwn(authValue, "token")) {
      next = setAtPath(next, "cli.token", authValue.token);
    }
    next = stripGatewayAuth(next);
    const extracted = extractCliToken(next);
    next = extracted.config;
    const saved = saveCanonical(next, { home, envPatch: extracted.envPatch });
    return {
      ok: true,
      path: normalized,
      config: redactConfig(saved),
      aliasedTo: "cli.token",
    };
  }

  // Nested gateway.auth.mode is virtual — accept "token", do not write to disk.
  if (normalized === "gateway.auth.mode") {
    if (String(value) !== "token") {
      const err = new Error('gateway.auth.mode must be "token"');
      err.code = "ECONFIG_VALUE";
      throw err;
    }
    const saved = saveCanonical(stripGatewayAuth(config), { home });
    return {
      ok: true,
      path: normalized,
      config: redactConfig(saved),
      aliasedTo: "cli.token",
    };
  }

  let nextValue = value;
  if (merge && nextValue && typeof nextValue === "object" && !Array.isArray(nextValue)) {
    const hit = getAtPath(config, alias);
    if (hit.found && hit.value && typeof hit.value === "object" && !Array.isArray(hit.value)) {
      nextValue = { ...hit.value, ...nextValue };
    }
  }
  let next = setAtPath(config, alias, nextValue);
  // Nested token under gateway.auth is aliased to cli.token; still strip any residual auth blob.
  if (isGatewayAuthPath(path) || alias === "cli.token") {
    next = stripGatewayAuth(next);
  }
  const extracted = extractCliToken(next);
  next = extracted.config;
  const saved = saveCanonical(next, { home, envPatch: extracted.envPatch });
  return {
    ok: true,
    path: normalized,
    config: redactConfig(saved),
    ...(alias !== normalized || isGatewayAuthPath(path) ? { aliasedTo: alias === normalized ? "cli.token" : alias } : {}),
  };
}

/**
 * Atomically write brain.preferred + brain.model in one configSet (merge on `brain`).
 * Prefer this over two path writes so a failed model set cannot leave preferred alone.
 * @param {{ preferred: string, model?: string | null }} selection
 * @param {{ home?: string }} [opts]
 */
export function applyBrainModelSelection(selection, { home = paddyHome() } = {}) {
  const preferred = String(selection?.preferred ?? "").trim();
  if (!preferred) {
    const err = new Error("brain.preferred must be a non-empty string");
    err.code = "ECONFIG_VALUE";
    throw err;
  }
  const model = selection?.model == null ? "" : String(selection.model);
  return configSet(
    "brain",
    { preferred, model },
    { home, merge: true },
  );
}

/**
 * Runtime brain selection from canonical config (what `paddy configure` writes).
 * PADDY_MODEL is a last-resort env override, not a second source of truth.
 * @param {{ home?: string }} [opts]
 * @returns {{ preferred: string, model: string | undefined }}
 */
export function canonicalBrainPreference({ home } = {}) {
  const envOverride =
    typeof process !== "undefined" && process.env?.PADDY_MODEL
      ? String(process.env.PADDY_MODEL).trim()
      : "";
  try {
    const { config } = loadCanonical({ home, persist: false });
    const preferredRaw = config?.brain?.preferred;
    const modelRaw = config?.brain?.model;
    const preferred =
      typeof preferredRaw === "string" && preferredRaw.trim()
        ? preferredRaw.trim()
        : envOverride || "supergrok";
    const model =
      typeof modelRaw === "string" && modelRaw.trim() ? modelRaw.trim() : undefined;
    return { preferred, model };
  } catch {
    return { preferred: envOverride || "supergrok", model: undefined };
  }
}

export function configUnset(path, { home = paddyHome() } = {}) {
  const normalized = normalizeConfigPath(path);
  let alias = resolveConfigPathAlias(path);
  // gateway.auth (parent) clears the real bearer at cli.token
  if (normalized === "gateway.auth") {
    alias = "cli.token";
  } else if (normalized === "gateway.auth.mode") {
    const err = new Error(`Config path not found: ${normalized}. Nothing was changed.`);
    err.code = "ECONFIG_PATH";
    throw err;
  }
  const { config } = loadCanonical({ home, persist: true });
  const result = unsetAtPath(config, alias);
  if (!result.found) {
    const err = new Error(`Config path not found: ${normalized}. Nothing was changed.`);
    err.code = "ECONFIG_PATH";
    throw err;
  }
  const cleaned = stripGatewayAuth(result.config);
  const saved = saveCanonical(cleaned, { home });
  return {
    ok: true,
    path: normalized,
    config: redactConfig(saved),
    ...(alias !== normalized || isGatewayAuthPath(path) ? { aliasedTo: alias } : {}),
  };
}


export function atomicWrite(path, text, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    chmodSync(dirname(path), 0o700);
  } catch {
    /* already owned */
  }
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, text, { mode });
  try {
    chmodSync(tmp, mode);
  } catch {
    /* ignore */
  }
  try {
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
  try {
    chmodSync(path, mode);
  } catch {
    /* ignore */
  }
}

export function readJsonFile(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    const wrapped = new Error(
      `Malformed JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
    wrapped.code = "ECONFIG";
    throw wrapped;
  }
}

export function loadDotEnvFile(path) {
  if (!path || !existsSync(path)) return {};
  try {
    return parseDotEnv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

export function mergeDotEnvText(existing, patch) {
  const keys = { ...(patch || {}) };
  const lines = String(existing ?? "").split(/\r?\n/);
  const seen = new Set();
  const next = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) {
      next.push(line);
      continue;
    }
    const i = t.indexOf("=");
    if (i < 0) {
      next.push(line);
      continue;
    }
    const k = t.slice(0, i).trim();
    if (k in keys) {
      next.push(`${k}=${keys[k] ?? ""}`);
      seen.add(k);
    } else {
      next.push(line);
    }
  }
  const missing = Object.entries(keys).filter(([k, v]) => v && !seen.has(k));
  if (missing.length) {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push("# paddy secrets — do not commit");
    for (const [k, v] of missing) next.push(`${k}=${v}`);
  }
  return next.join("\n").replace(/\n*$/, "\n");
}

export function upsertSecrets(patch, home = paddyHome()) {
  const path = secretsPath(home);
  const prev = existsSync(path) ? readFileSync(path, "utf8") : "";
  atomicWrite(path, mergeDotEnvText(prev, patch), 0o600);
  return path;
}

export function loadSecretEnv(home = paddyHome()) {
  return {
    ...loadDotEnvFile(join(home, "selfhost.env")),
    ...loadDotEnvFile(secretsPath(home)),
    ...Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => typeof v === "string" && v.trim()),
    ),
  };
}

function asMode(value, fallback = "pairing") {
  const v = String(value ?? "").toLowerCase();
  return ACCESS_MODES.includes(v) ? v : fallback;
}

function asUsers(value) {
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function accountToChannel(id, acc) {
  const row = acc && typeof acc === "object" ? acc : {};
  const ch = {
    enabled: row.enabled !== false,
    access: {
      mode: asMode(row.access?.mode || row.dmPolicy, "pairing"),
      users: asUsers(row.access?.users || row.allowFrom),
    },
    requireMention: row.requireMention !== false,
  };
  for (const key of ["token", "appToken", "phoneId", "verifyToken", "number", "host", "user", "pass", "from"]) {
    if (typeof row[key] === "string" && row[key].trim()) ch[key] = row[key].trim();
  }
  if (typeof row.port === "number" && Number.isFinite(row.port)) ch.port = row.port;
  return ch;
}

/** @returns {ChannelAccount} */
export function channelToAccount(id, ch, env = {}) {
  const row = ch && typeof ch === "object" ? ch : {};
  const acc = {
    dmPolicy: asMode(row.access?.mode || row.dmPolicy, "pairing"),
    allowFrom: asUsers(row.access?.users || row.allowFrom),
    requireMention: row.requireMention !== false,
  };
  for (const key of ["token", "appToken", "phoneId", "verifyToken", "number", "host", "user", "pass", "from"]) {
    const raw = row[key];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const resolved = interpolate(raw, env).trim();
    if (resolved) acc[key] = resolved;
  }
  if (typeof row.port === "number") acc.port = row.port;
  return acc;
}

export function extractChannelSecrets(id, ch) {
  const envPatch = {};
  const next = { ...ch };
  const map = SECRET_ENV[id] || {};
  for (const [field, envName] of Object.entries(map)) {
    const v = next[field];
    if (typeof v !== "string" || !v.trim()) continue;
    if (isEnvRef(v)) continue;
    envPatch[envName] = v.trim();
    next[field] = `\${${envName}}`;
  }
  return { channel: next, envPatch };
}

export function extractAllSecrets(channels) {
  const envPatch = {};
  const next = {};
  for (const [id, ch] of Object.entries(channels || {})) {
    const extracted = extractChannelSecrets(id, ch);
    next[id] = extracted.channel;
    Object.assign(envPatch, extracted.envPatch);
  }
  return { channels: next, envPatch };
}

export function validateCanonical(config) {
  /** @type {{ path: string, message: string }[]} */
  const issues = [];
  const push = (path, message) => {
    issues.push({ path, message });
  };
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    push("", "config must be a JSON object");
    return { ok: false, errors: issues.map((i) => i.message), issues };
  }
  const version = config.version;
  if (version != null && version !== SCHEMA_VERSION) {
    push("version", `unsupported config version ${version} (expected ${SCHEMA_VERSION})`);
  }
  const gw = config.gateway;
  if (gw != null) {
    if (typeof gw !== "object" || Array.isArray(gw)) {
      push("gateway", "gateway must be an object");
    } else {
      if (gw.host != null && (typeof gw.host !== "string" || !gw.host.trim())) {
        push("gateway.host", "gateway.host must be a non-empty string");
      }
      if (gw.port != null) {
        const n = Number(gw.port);
        if (!Number.isInteger(n) || n < 1 || n > 65535) {
          push("gateway.port", "gateway.port must be an integer from 1 to 65535");
        }
      }
      if (gw.auth != null) {
        if (typeof gw.auth !== "object" || Array.isArray(gw.auth)) {
          push("gateway.auth", "gateway.auth must be an object");
        } else if (gw.auth.mode != null && String(gw.auth.mode) !== "token") {
          push("gateway.auth.mode", 'gateway.auth.mode must be "token"');
        }
      }
    }
  }
  const brain = config.brain;
  if (brain != null) {
    if (typeof brain !== "object" || Array.isArray(brain)) {
      push("brain", "brain must be an object");
    } else {
      if (brain.preferred != null && (typeof brain.preferred !== "string" || !brain.preferred.trim())) {
        push("brain.preferred", "brain.preferred must be a non-empty string");
      }
      if (brain.model != null && typeof brain.model !== "string") {
        push("brain.model", "brain.model must be a string");
      }
    }
  }
  const channels = config.channels;
  if (channels != null) {
    if (typeof channels !== "object" || Array.isArray(channels)) {
      push("channels", "channels must be an object");
    } else {
      for (const [id, ch] of Object.entries(channels)) {
        const base = `channels.${id}`;
        if (!ch || typeof ch !== "object" || Array.isArray(ch)) {
          push(base, `${base} must be an object`);
          continue;
        }
        if (ch.enabled != null && typeof ch.enabled !== "boolean") {
          push(`${base}.enabled`, `${base}.enabled must be a boolean`);
        }
        const mode = ch.access?.mode ?? ch.dmPolicy;
        if (mode != null && !ACCESS_MODES.includes(String(mode))) {
          push(
            `${base}.access.mode`,
            `${base}.access.mode must be one of: pairing, allowlist, open (got ${JSON.stringify(mode)})`,
          );
        }
      }
    }
  }
  const agents = config.agents;
  if (agents != null) {
    if (typeof agents !== "object" || Array.isArray(agents)) {
      push("agents", "agents must be an object");
    } else if (agents.defaults != null) {
      if (typeof agents.defaults !== "object" || Array.isArray(agents.defaults)) {
        push("agents.defaults", "agents.defaults must be an object");
      } else if (agents.defaults.memory != null) {
        const mem = agents.defaults.memory;
        const mp = "agents.defaults.memory";
        if (typeof mem !== "object" || Array.isArray(mem)) {
          push(mp, `${mp} must be an object`);
        } else {
          if (mem.enabled != null && typeof mem.enabled !== "boolean") {
            push(`${mp}.enabled`, `${mp}.enabled must be a boolean`);
          }
          for (const key of ["memoryCharLimit", "userCharLimit", "recallLimit"]) {
            if (mem[key] != null) {
              const n = Number(mem[key]);
              if (!Number.isInteger(n) || n < 0) {
                push(`${mp}.${key}`, `${mp}.${key} must be a non-negative integer`);
              }
            }
          }
          if (mem.fts != null && typeof mem.fts !== "boolean") {
            push(`${mp}.fts`, `${mp}.fts must be a boolean`);
          }
        }
      }
    }
  }
  const errors = issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message));
  return { ok: issues.length === 0, errors, issues };
}

function missingEnvRefs(config, env) {
  const missing = [];
  const scan = (value, path) => {
    if (typeof value === "string" && isEnvRef(value)) {
      const name = envRefName(value);
      if (!String(env[name] || "").trim()) missing.push({ path, name });
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) scan(v, path ? `${path}.${k}` : k);
    }
  };
  scan(config.cli, "cli");
  scan(config.channels, "channels");
  return missing;
}

export function normalizeCanonical(raw) {
  const base = defaultCanonical();
  const src = raw && typeof raw === "object" ? raw : {};
  const next = {
    ...src,
    version: SCHEMA_VERSION,
    gateway: {
      host: typeof src.gateway?.host === "string" && src.gateway.host.trim()
        ? src.gateway.host.trim()
        : typeof src.host === "string" && src.host.trim()
          ? src.host.trim()
          : base.gateway.host,
      port: Number.isInteger(Number(src.gateway?.port))
        ? Number(src.gateway.port)
        : Number.isInteger(Number(src.port))
          ? Number(src.port)
          : base.gateway.port,
    },
    cli: {
      ...(typeof src.cli === "object" && src.cli ? src.cli : {}),
      token:
        src.cli?.token ||
        (typeof src.token === "string" && src.token && !["supergrok"].includes(src.token)
          ? src.token
          : base.cli.token),
    },
    brain: {
      ...(typeof src.brain === "object" && src.brain ? src.brain : {}),
      preferred: src.brain?.preferred || src.preferredProvider || base.brain.preferred,
      ...(src.brain?.model || src.preferredModel
        ? { model: src.brain?.model || src.preferredModel }
        : {}),
    },
    kit: {
      ...(typeof src.kit === "object" && src.kit ? src.kit : {}),
      ...(src.root ? { root: src.root } : {}),
    },
    mcp: {
      servers:
        src.mcp?.servers && typeof src.mcp.servers === "object" && !Array.isArray(src.mcp.servers)
          ? src.mcp.servers
          : {},
    },
    channels: {},
  };
  const incoming = src.channels && typeof src.channels === "object" ? src.channels : {};
  for (const [id, ch] of Object.entries(incoming)) {
    next.channels[id] = accountToChannel(id, ch);
  }
  return next;
}

/** @returns {{ config: object, envPatch: Record<string, string>, notes: string[], pending: unknown[] }} */
export function migrateFromLegacy(raw, { channelsFile, env } = {}) {
  const notes = [];
  let src = raw && typeof raw === "object" ? { ...raw } : {};
  // Rescue orphaned gateway.auth.token before normalizeCanonical drops gateway.auth.
  // Always rewrite away gateway.auth — it is not part of the v1 disk shape.
  if (src.gateway && typeof src.gateway === "object" && Object.hasOwn(src.gateway, "auth")) {
    const orphanAuthTok = src.gateway.auth?.token;
    if (typeof orphanAuthTok === "string" && orphanAuthTok && !isEnvRef(orphanAuthTok)) {
      const cliTok = src.cli?.token;
      if (typeof cliTok !== "string" || !cliTok || isEnvRef(cliTok)) {
        src = {
          ...src,
          cli: { ...(typeof src.cli === "object" && src.cli ? src.cli : {}), token: orphanAuthTok },
        };
        notes.push("rescued gateway.auth.token into cli.token");
      }
    }
    notes.push("stripped gateway.auth from config.json (use cli.token)");
  }
  const isV1 = src.version === SCHEMA_VERSION && src.gateway && src.channels;
  let canonical = isV1 ? normalizeCanonical(src) : normalizeCanonical(src);
  if (!isV1 && (src.port || src.host || src.token || src.preferredProvider)) {
    notes.push("migrated flat config.json (host/port/token) into version 1");
  }
  const envPatch = {};
  if (typeof canonical.cli?.token === "string" && canonical.cli.token && !isEnvRef(canonical.cli.token)) {
    envPatch[CLI_TOKEN_ENV] = canonical.cli.token;
    canonical.cli.token = `\${${CLI_TOKEN_ENV}}`;
    notes.push("moved CLI token into .env");
  }
  if (channelsFile?.accounts && typeof channelsFile.accounts === "object") {
    for (const [id, acc] of Object.entries(channelsFile.accounts)) {
      if (!CHANNEL_IDS.includes(id) || !acc) continue;
      if (canonical.channels[id]?.enabled && (canonical.channels[id].token || canonical.channels[id].host)) {
        continue;
      }
      canonical.channels[id] = accountToChannel(id, acc);
      notes.push(`migrated channels.json ${id}`);
    }
  }
  const extracted = extractAllSecrets(canonical.channels);
  canonical.channels = extracted.channels;
  Object.assign(envPatch, extracted.envPatch);
  if (Object.keys(extracted.envPatch).length) notes.push("extracted inline channel secrets into .env");

  const overlay = env && typeof env === "object" ? env : {};
  for (const id of CHANNEL_IDS) {
    const map = SECRET_ENV[id] || {};
    const hasEnv = Object.values(map).some((name) => String(overlay[name] || "").trim());
    if (!hasEnv) continue;
    const ch = canonical.channels[id] || accountToChannel(id, {});
    for (const [field, envName] of Object.entries(map)) {
      if (String(overlay[envName] || "").trim() && !ch[field]) ch[field] = `\${${envName}}`;
    }
    if (hasEnv) {
      ch.enabled = ch.enabled !== false;
      canonical.channels[id] = ch;
    }
  }
  return { config: canonical, envPatch, notes, pending: Array.isArray(channelsFile?.pending) ? channelsFile.pending : [] };
}

export function loadPendingPairs(home = paddyHome()) {
  try {
    if (existsSync(pairingPath(home))) {
      const pairing = JSON.parse(readFileSync(pairingPath(home), "utf8"));
      if (pairing && Array.isArray(pairing.pending)) return pairing.pending;
    }
  } catch {
    /* ignore corrupt pairing file */
  }
  try {
    if (existsSync(legacyChannelsPath(home))) {
      const legacy = JSON.parse(readFileSync(legacyChannelsPath(home), "utf8"));
      if (legacy && Array.isArray(legacy.pending)) return legacy.pending;
    }
  } catch {
    /* ignore */
  }
  return [];
}

export function savePendingPairs(pending, home = paddyHome()) {
  atomicWrite(pairingPath(home), `${JSON.stringify({ pending: pending ?? [] }, null, 2)}\n`, 0o600);
}

function ensureHome(home) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  try {
    chmodSync(home, 0o700);
  } catch {
    /* ignore */
  }
}

export function loadCanonical({ home = paddyHome(), persist = true } = {}) {
  ensureHome(home);
  const raw = existsSync(configPath(home)) ? readJsonFile(configPath(home), {}) : {};
  const channelsFile = existsSync(legacyChannelsPath(home))
    ? readJsonFile(legacyChannelsPath(home), { accounts: {}, pending: [] })
    : { accounts: {}, pending: [] };
  const env = loadSecretEnv(home);
  const migrated = migrateFromLegacy(raw, { channelsFile, env });
  const valid = validateCanonical(migrated.config);
  if (!valid.ok) {
    const err = new Error(`Invalid Paddy config: ${valid.errors.join("; ")}`);
    err.errors = valid.errors;
    throw err;
  }
  if (persist) {
    const needsWrite =
      raw.version !== SCHEMA_VERSION ||
      Object.keys(migrated.envPatch).length > 0 ||
      migrated.notes.length > 0;
    if (needsWrite) {
      if (Object.keys(migrated.envPatch).length) upsertSecrets(migrated.envPatch, home);
      atomicWrite(configPath(home), `${JSON.stringify(migrated.config, null, 2)}\n`, 0o600);
      if (migrated.pending.length && !existsSync(pairingPath(home))) {
        savePendingPairs(migrated.pending, home);
      }
    }
  }
  return { ...migrated, env };
}

export function saveCanonical(config, { home = paddyHome(), envPatch = {} } = {}) {
  const valid = validateCanonical(config);
  if (!valid.ok) {
    const err = new Error(`Invalid Paddy config: ${valid.errors.join("; ")}`);
    err.errors = valid.errors;
    throw err;
  }
  const extracted = extractAllSecrets(config.channels || {});
  const next = { ...config, version: SCHEMA_VERSION, channels: extracted.channels };
  const secrets = { ...envPatch, ...extracted.envPatch };
  if (Object.keys(secrets).length) upsertSecrets(secrets, home);
  ensureHome(home);
  atomicWrite(configPath(home), `${JSON.stringify(next, null, 2)}\n`, 0o600);
  return next;
}

/** @returns {AccountMap} */
export function loadResolvedAccounts(home = paddyHome()) {
  const { config, env } = loadCanonical({ home, persist: true });
  const accounts = {};
  for (const id of CHANNEL_IDS) {
    const ch = config.channels?.[id];
    if (!ch || ch.enabled === false) continue;
    const acc = channelToAccount(id, ch, env);
    const has =
      acc.token || acc.appToken || acc.host || acc.user || acc.number || acc.phoneId;
    if (has) accounts[id] = acc;
  }
  return accounts;
}

/**
 * @param {string} id
 * @param {ChannelAccount} patch
 * @param {string} [home]
 * @returns {ChannelAccount}
 */
export function upsertCanonicalChannel(id, patch, home = paddyHome()) {
  const { config } = loadCanonical({ home, persist: true });
  const prevAcc = channelToAccount(id, config.channels[id] || {}, loadSecretEnv(home));
  const nextAcc = {
    ...prevAcc,
    ...patch,
    allowFrom: patch.allowFrom ?? prevAcc.allowFrom,
    dmPolicy: patch.dmPolicy ?? prevAcc.dmPolicy,
    requireMention: patch.requireMention ?? prevAcc.requireMention,
  };
  const ch = accountToChannel(id, { ...nextAcc, enabled: true });
  config.channels[id] = ch;
  saveCanonical(config, { home });
  return channelToAccount(id, loadCanonical({ home, persist: false }).config.channels[id], loadSecretEnv(home));
}

export function removeCanonicalChannel(id, home = paddyHome()) {
  const { config } = loadCanonical({ home, persist: true });
  if (config.channels[id]) {
    const next = { ...config.channels };
    delete next[id];
    config.channels = next;
    saveCanonical(config, { home });
  }
  const pending = loadPendingPairs(home).filter((p) => p.channelId !== id);
  savePendingPairs(pending, home);
}

/** @returns {Array<{ id: string, reason: string, currentMode: string, incomingMode: string, currentUsers: string[], incomingUsers: string[] }>} */
export function detectImportConflicts(currentChannels, incomingAccounts, env = {}) {
  const conflicts = [];
  for (const id of CHANNEL_IDS) {
    const inc = incomingAccounts[id];
    if (!inc) continue;
    const cur = currentChannels[id];
    if (!cur || cur.enabled === false) continue;
    const curAcc = channelToAccount(id, cur, env);
    const fields = ["token", "appToken", "host", "user", "pass", "number", "phoneId", "verifyToken"];
    const curHas = fields.some((k) => String(curAcc[k] || "").trim());
    const incHas = fields.some((k) => String(inc[k] || "").trim());
    if (!curHas) continue;
    if (!incHas) continue;
    const differs = fields.some((k) => {
      const a = String(curAcc[k] || "").trim();
      const b = String(inc[k] || "").trim();
      return a && b && a !== b;
    });
    const modeDiff = asMode(cur.access?.mode) !== asMode(inc.dmPolicy);
    const curUsers = [...asUsers(cur.access?.users)].map(String).sort();
    const incUsers = [...asUsers(inc.allowFrom)].map(String).sort();
    const usersDiff = curUsers.length > 0 && incUsers.length > 0 && curUsers.join("\0") !== incUsers.join("\0");
    if (differs || modeDiff || usersDiff) {
      const reasons = [];
      if (differs) reasons.push(`${id} already has different credentials`);
      if (modeDiff) {
        reasons.push(
          `${id} access mode is ${cur.access?.mode || "pairing"}, import wants ${inc.dmPolicy || "pairing"}`,
        );
      }
      if (usersDiff) reasons.push(`${id} allowed users differ`);
      conflicts.push({
        id,
        reason: reasons.join("; "),
        currentMode: cur.access?.mode || "pairing",
        incomingMode: inc.dmPolicy || "pairing",
        currentUsers: curUsers,
        incomingUsers: incUsers,
      });
    }
  }
  return conflicts;
}

/**
 * @param {object} currentChannels
 * @param {AccountMap} incomingAccounts
 * @param {{ replace?: string[] }} [opts]
 */
export function mergeImportedAccounts(currentChannels, incomingAccounts, { replace = [] } = {}) {
  const replaceSet = new Set(replace);
  const next = { ...(currentChannels || {}) };
  /** @type {string[]} */
  const imported = [];
  /** @type {string[]} */
  const skipped = [];
  for (const id of CHANNEL_IDS) {
    const inc = incomingAccounts[id];
    if (!inc) continue;
    const cur = next[id];
    const curHas = Boolean(cur && cur.enabled !== false && (cur.token || cur.host || cur.user || cur.appToken));
    const replacing = replaceSet.has(id);
    if (curHas && !replacing) {
      skipped.push(id);
      continue;
    }
    const ch = accountToChannel(id, {
      ...(cur ? channelToAccount(id, cur, {}) : {}),
      ...inc,
      allowFrom: replacing
        ? asUsers(inc.allowFrom)
        : Array.from(
            new Set([
              ...asUsers(cur?.access?.users),
              ...asUsers(inc.allowFrom),
            ]),
          ),
      enabled: true,
    });
    next[id] = ch;
    imported.push(id);
  }
  return { channels: next, imported, skipped };
}

/**
 * @param {{ home?: string, source?: string, replace?: string[], rootHome?: string }} [opts]
 */
export function importFromLineage({
  home = paddyHome(),
  source = "both",
  replace = [],
  rootHome = homedir(),
} = {}) {
  const { config, env } = loadCanonical({ home, persist: true });
  const found = readLineageAccounts(rootHome);
  const sources = source === "both" ? ["openclaw", "hermes"] : [source];
  const incoming = {};
  /** @type {string[]} */
  const from = [];
  for (const src of sources) {
    const accounts = found[src] || {};
    for (const id of CHANNEL_IDS) {
      if (!accounts[id]) continue;
      incoming[id] = { ...(incoming[id] || {}), ...accounts[id] };
      from.push(`${src}:${id}`);
    }
  }
  const conflicts = detectImportConflicts(config.channels, incoming, env);
  const conflictIds = new Set(conflicts.map((c) => c.id));
  const autoReplace = replace.filter((id) => conflictIds.has(id) || replace.includes(id));
  const merge = mergeImportedAccounts(config.channels, incoming, {
    replace: [...autoReplace, ...CHANNEL_IDS.filter((id) => !conflictIds.has(id))],
  });
  config.channels = merge.channels;
  if (merge.imported.length) saveCanonical(config, { home });
  const unresolved = conflicts.filter((c) => !merge.imported.includes(c.id));
  if (!from.length) {
    return {
      ok: false,
      error: "No Telegram/Discord/Slack tokens found in ~/.openclaw or ~/.hermes.",
      imported: [],
      skipped: [],
      conflicts: [],
      sources: [],
      detect: detectLineage(rootHome),
    };
  }
  return {
    ok: true,
    imported: merge.imported,
    skipped: merge.skipped,
    conflicts: unresolved,
    sources: from,
    detect: detectLineage(rootHome),
  };
}

export function exportToLineage(target = "both", { home = paddyHome(), rootHome = homedir() } = {}) {
  const accounts = loadResolvedAccounts(home);
  const paths = [];
  if (target === "openclaw" || target === "both") {
    const path = join(rootHome, ".openclaw", "openclaw.json");
    const prev = existsSync(path) ? readFileSync(path, "utf8") : "{\n  channels: {}\n}\n";
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    atomicWrite(path, mergeOpenClawText(prev, accounts), 0o600);
    paths.push(path);
  }
  if (target === "hermes" || target === "both") {
    const path = join(rootHome, ".hermes", ".env");
    const prev = existsSync(path) ? readFileSync(path, "utf8") : "";
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    atomicWrite(path, mergeHermesEnvText(prev, accounts), 0o600);
    paths.push(path);
  }
  return paths;
}

export function resolvedSnapshot(home = paddyHome()) {
  const { config, env } = loadCanonical({ home, persist: false });
  const missing = missingEnvRefs(config, env);
  return { config, env, missing, redacted: redactConfig(config) };
}

export { parseOpenClawChannels, parseHermesEnv, detectLineage, readLineageAccounts };
