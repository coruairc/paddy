// @ts-nocheck
/**
 * OpenClaw (~/.openclaw/openclaw.json) and Hermes (~/.hermes/.env) channel interop.
 * Same Telegram / Discord / Slack / WhatsApp / Signal / email fields both harnesses use.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const LINEAGE_CHANNELS = [
  "telegram",
  "discord",
  "slack",
  "whatsapp",
  "signal",
  "email",
];

export function parseJson5(text) {
  const src = String(text ?? "");
  let out = "";
  let i = 0;
  let inStr = false;
  let quote = "";
  let escape = false;
  while (i < src.length) {
    const c = src[i];
    if (inStr) {
      out += c;
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === quote) inStr = false;
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
      out += c === "'" ? '"' : c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  out = out.replace(/,\s*([}\]])/g, "$1");
  let quoted = "";
  inStr = false;
  quote = "";
  escape = false;
  i = 0;
  while (i < out.length) {
    const c = out[i];
    if (inStr) {
      quoted += c;
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === quote) inStr = false;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      quote = c;
      quoted += c;
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < out.length && /[A-Za-z0-9_]/.test(out[j])) j++;
      let k = j;
      while (k < out.length && /\s/.test(out[k])) k++;
      if (out[k] === ":") {
        quoted += `"${out.slice(i, j)}"`;
        i = j;
        continue;
      }
    }
    quoted += c;
    i++;
  }
  return JSON.parse(quoted);
}

function asList(value) {
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function asPolicy(value, fallback = "pairing") {
  const v = String(value ?? "").toLowerCase();
  if (v === "open" || v === "allowlist" || v === "pairing") return v;
  return fallback;
}

function pickToken(obj, keys) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function accountFromOpenClaw(id, raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.enabled === false) return null;
  const nested =
    raw.accounts && typeof raw.accounts === "object"
      ? raw.accounts.default || raw.accounts[Object.keys(raw.accounts)[0]] || {}
      : {};
  const src = { ...nested, ...raw };
  const acc = {
    dmPolicy: asPolicy(src.dmPolicy || src.dm_policy, "pairing"),
    allowFrom: asList(src.allowFrom || src.allow_from),
    requireMention: src.requireMention !== false,
  };
  if (id === "telegram") acc.token = pickToken(src, ["botToken", "bot_token", "token"]);
  else if (id === "discord") acc.token = pickToken(src, ["token", "botToken"]);
  else if (id === "slack") {
    acc.token = pickToken(src, ["botToken", "token"]);
    acc.appToken = pickToken(src, ["appToken", "app_token"]);
  } else if (id === "whatsapp") {
    acc.token = pickToken(src, ["accessToken", "token", "cloudToken"]);
    acc.phoneId = pickToken(src, ["phoneNumberId", "phoneId", "phone_number_id"]);
    acc.verifyToken = pickToken(src, ["verifyToken", "verify_token"]);
  } else if (id === "signal") {
    acc.host = pickToken(src, ["httpUrl", "url", "host"]);
    acc.number = pickToken(src, ["account", "number"]);
  } else if (id === "email") {
    acc.host = pickToken(src, ["imapHost", "host"]);
    acc.user = pickToken(src, ["user", "username"]);
    acc.pass = pickToken(src, ["pass", "password"]);
    acc.from = pickToken(src, ["from"]);
  }
  const groups = src.groups && typeof src.groups === "object" ? src.groups["*"] : null;
  if (groups && typeof groups === "object" && "requireMention" in groups) {
    acc.requireMention = groups.requireMention !== false;
  }
  const hasSecret = ["token", "appToken", "phoneId", "host", "user", "pass", "number"].some(
    (k) => typeof acc[k] === "string" && acc[k].trim(),
  );
  if (!hasSecret && !acc.allowFrom.length) return null;
  return acc;
}

export function parseOpenClawChannels(text) {
  const accounts = {};
  let parsed;
  try {
    parsed = parseJson5(text);
  } catch {
    return accounts;
  }
  const channels = parsed?.channels && typeof parsed.channels === "object" ? parsed.channels : {};
  for (const id of LINEAGE_CHANNELS) {
    const acc = accountFromOpenClaw(id, channels[id]);
    if (acc) accounts[id] = acc;
  }
  return accounts;
}

export function parseDotEnv(text) {
  const out = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k) out[k] = v;
  }
  return out;
}

function hermesAccount(env, id) {
  const acc = {
    dmPolicy: "pairing",
    allowFrom: [],
    requireMention: true,
  };
  const allowAll = /^(1|true|yes)$/i.test(String(env.GATEWAY_ALLOW_ALL_USERS || ""));
  if (allowAll) acc.dmPolicy = "open";
  const globalAllow = asList(env.GATEWAY_ALLOWED_USERS || env.PADDY_ALLOWED_USERS);
  if (id === "telegram") {
    acc.token = (env.TELEGRAM_BOT_TOKEN || "").trim();
    acc.allowFrom = asList(env.TELEGRAM_ALLOWED_USERS);
    if (env.TELEGRAM_BOTS_REQUIRE_MENTION === "false") acc.requireMention = false;
  } else if (id === "discord") {
    acc.token = (env.DISCORD_BOT_TOKEN || env.DISCORD_TOKEN || "").trim();
    acc.allowFrom = asList(env.DISCORD_ALLOWED_USERS);
  } else if (id === "slack") {
    acc.token = (env.SLACK_BOT_TOKEN || "").trim();
    acc.appToken = (env.SLACK_APP_TOKEN || "").trim();
    acc.allowFrom = asList(env.SLACK_ALLOWED_USERS);
  } else if (id === "whatsapp") {
    acc.token = (env.WHATSAPP_TOKEN || env.WHATSAPP_ACCESS_TOKEN || "").trim();
    acc.phoneId = (env.WHATSAPP_PHONE_ID || env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
    acc.verifyToken = (env.WHATSAPP_VERIFY_TOKEN || "").trim();
    acc.allowFrom = asList(env.WHATSAPP_ALLOWED_USERS);
  } else if (id === "signal") {
    acc.host = (env.SIGNAL_HTTP_URL || env.SIGNAL_CLI_URL || "").trim();
    acc.number = (env.SIGNAL_ACCOUNT || env.SIGNAL_NUMBER || "").trim();
    acc.allowFrom = asList(env.SIGNAL_ALLOWED_USERS);
  } else if (id === "email") {
    acc.host = (env.IMAP_HOST || env.EMAIL_HOST || "").trim();
    acc.user = (env.IMAP_USER || env.EMAIL_USER || "").trim();
    acc.pass = (env.IMAP_PASS || env.EMAIL_PASS || "").trim();
    acc.from = (env.EMAIL_FROM || "").trim();
  }
  acc.allowFrom = Array.from(new Set([...acc.allowFrom, ...globalAllow]));
  if (acc.allowFrom.length && acc.dmPolicy === "pairing") acc.dmPolicy = "allowlist";
  const hasSecret = ["token", "appToken", "phoneId", "host", "user", "pass", "number"].some(
    (k) => typeof acc[k] === "string" && acc[k].trim(),
  );
  return hasSecret ? acc : null;
}

export function parseHermesEnv(text) {
  const env = parseDotEnv(text);
  const accounts = {};
  for (const id of LINEAGE_CHANNELS) {
    const acc = hermesAccount(env, id);
    if (acc) accounts[id] = acc;
  }
  return accounts;
}

export function summarizeImported(accounts) {
  return LINEAGE_CHANNELS.filter((id) => accounts[id]).map((id) => {
    const acc = accounts[id];
    return {
      id,
      dmPolicy: acc.dmPolicy,
      allowFrom: acc.allowFrom?.length ?? 0,
      hasToken: Boolean(acc.token || acc.appToken || acc.host),
    };
  });
}

export function mergeOpenClawText(existing, accounts) {
  let doc = {};
  if (existing && existing.trim()) {
    try {
      doc = parseJson5(existing);
    } catch {
      doc = {};
    }
  }
  if (!doc.channels || typeof doc.channels !== "object") doc.channels = {};
  for (const [id, acc] of Object.entries(accounts || {})) {
    if (!LINEAGE_CHANNELS.includes(id) || !acc) continue;
    const prev = doc.channels[id] && typeof doc.channels[id] === "object" ? doc.channels[id] : {};
    const next = { ...prev, enabled: true, dmPolicy: acc.dmPolicy || prev.dmPolicy || "pairing" };
    if (acc.allowFrom?.length) next.allowFrom = acc.allowFrom;
    if (acc.requireMention === false) {
      if (!next.groups) next.groups = {};
      next.groups["*"] = { ...(next.groups["*"] || {}), requireMention: false };
    } else if (acc.requireMention) {
      if (!next.groups) next.groups = {};
      next.groups["*"] = { ...(next.groups["*"] || {}), requireMention: true };
    }
    if (id === "telegram" && acc.token) next.botToken = acc.token;
    if (id === "discord" && acc.token) next.token = acc.token;
    if (id === "slack") {
      if (acc.token) next.botToken = acc.token;
      if (acc.appToken) next.appToken = acc.appToken;
    }
    if (id === "whatsapp") {
      if (acc.token) next.accessToken = acc.token;
      if (acc.phoneId) next.phoneNumberId = acc.phoneId;
      if (acc.verifyToken) next.verifyToken = acc.verifyToken;
    }
    if (id === "signal") {
      if (acc.host) next.httpUrl = acc.host;
      if (acc.number) next.account = acc.number;
    }
    if (id === "email") {
      if (acc.host) next.imapHost = acc.host;
      if (acc.user) next.user = acc.user;
      if (acc.pass) next.password = acc.pass;
      if (acc.from) next.from = acc.from;
    }
    doc.channels[id] = next;
  }
  return `${JSON.stringify(doc, null, 2)}\n`;
}

const HERMES_KEYS = {
  telegram: (acc) => ({
    TELEGRAM_BOT_TOKEN: acc.token,
    TELEGRAM_ALLOWED_USERS: (acc.allowFrom || []).join(","),
  }),
  discord: (acc) => ({
    DISCORD_BOT_TOKEN: acc.token,
    DISCORD_ALLOWED_USERS: (acc.allowFrom || []).join(","),
  }),
  slack: (acc) => ({
    SLACK_BOT_TOKEN: acc.token,
    SLACK_APP_TOKEN: acc.appToken,
    SLACK_ALLOWED_USERS: (acc.allowFrom || []).join(","),
  }),
  whatsapp: (acc) => ({
    WHATSAPP_TOKEN: acc.token,
    WHATSAPP_PHONE_ID: acc.phoneId,
    WHATSAPP_VERIFY_TOKEN: acc.verifyToken,
    WHATSAPP_ALLOWED_USERS: (acc.allowFrom || []).join(","),
  }),
  signal: (acc) => ({
    SIGNAL_HTTP_URL: acc.host,
    SIGNAL_ACCOUNT: acc.number,
    SIGNAL_ALLOWED_USERS: (acc.allowFrom || []).join(","),
  }),
  email: (acc) => ({
    IMAP_HOST: acc.host,
    IMAP_USER: acc.user,
    IMAP_PASS: acc.pass,
    EMAIL_FROM: acc.from,
  }),
};

export function mergeHermesEnvText(existing, accounts) {
  const lines = String(existing ?? "").split(/\r?\n/);
  const keys = {};
  for (const [id, acc] of Object.entries(accounts || {})) {
    const fn = HERMES_KEYS[id];
    if (!fn || !acc) continue;
    Object.assign(keys, fn(acc));
  }
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
      const v = keys[k];
      if (v) next.push(`${k}=${v}`);
      else next.push(line);
      seen.add(k);
    } else {
      next.push(line);
    }
  }
  const missing = Object.entries(keys).filter(([k, v]) => v && !seen.has(k));
  if (missing.length) {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push("# written by paddy channels export");
    for (const [k, v] of missing) next.push(`${k}=${v}`);
  }
  return next.join("\n").replace(/\n*$/, "\n");
}

export function detectLineage(rootHome = homedir()) {
  const openclawPath = join(rootHome, ".openclaw", "openclaw.json");
  const hermesEnvPath = join(rootHome, ".hermes", ".env");
  return {
    openclaw: existsSync(openclawPath),
    hermes: existsSync(hermesEnvPath),
    openclawPath,
    hermesEnvPath,
  };
}

export function readLineageAccounts(rootHome = homedir()) {
  const det = detectLineage(rootHome);
  const openclaw = det.openclaw ? parseOpenClawChannels(readFileSync(det.openclawPath, "utf8")) : {};
  const hermes = det.hermes ? parseHermesEnv(readFileSync(det.hermesEnvPath, "utf8")) : {};
  return { ...det, openclaw, hermes };
}

function writeSecretFile(path, text) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, text, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
}

export function writeOpenClawAccounts(accounts, rootHome = homedir()) {
  const path = join(rootHome, ".openclaw", "openclaw.json");
  const prev = existsSync(path) ? readFileSync(path, "utf8") : "{\n  channels: {}\n}\n";
  writeSecretFile(path, mergeOpenClawText(prev, accounts));
  return path;
}

export function writeHermesAccounts(accounts, rootHome = homedir()) {
  const path = join(rootHome, ".hermes", ".env");
  const prev = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeSecretFile(path, mergeHermesEnvText(prev, accounts));
  return path;
}

export function envAccountsFromProcess(env = process.env) {
  return parseHermesEnv(
    Object.entries(env)
      .filter(([, v]) => typeof v === "string" && v.trim())
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  );
}
