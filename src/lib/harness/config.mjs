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
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ok: false, errors: ["config must be a JSON object"] };
  }
  const version = config.version;
  if (version != null && version !== SCHEMA_VERSION) {
    errors.push(`unsupported config version ${version} (expected ${SCHEMA_VERSION})`);
  }
  const gw = config.gateway;
  if (gw != null) {
    if (typeof gw !== "object" || Array.isArray(gw)) errors.push("gateway must be an object");
    else {
      if (gw.host != null && (typeof gw.host !== "string" || !gw.host.trim())) {
        errors.push("gateway.host must be a non-empty string");
      }
      if (gw.port != null) {
        const n = Number(gw.port);
        if (!Number.isInteger(n) || n < 1 || n > 65535) errors.push("gateway.port must be 1–65535");
      }
    }
  }
  const channels = config.channels;
  if (channels != null) {
    if (typeof channels !== "object" || Array.isArray(channels)) {
      errors.push("channels must be an object");
    } else {
      for (const [id, ch] of Object.entries(channels)) {
        if (!ch || typeof ch !== "object") {
          errors.push(`channels.${id} must be an object`);
          continue;
        }
        if (ch.enabled != null && typeof ch.enabled !== "boolean") {
          errors.push(`channels.${id}.enabled must be a boolean`);
        }
        const mode = ch.access?.mode ?? ch.dmPolicy;
        if (mode != null && !ACCESS_MODES.includes(String(mode))) {
          errors.push(`channels.${id}.access.mode must be pairing | allowlist | open`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
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
