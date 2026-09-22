// @ts-nocheck
/**
 * Hermes-style curated MEMORY / USER stores: char caps, add|replace|remove,
 * overflow rejects (never silent truncate), session-start frozen snapshot.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_MEMORY_CHAR_LIMIT = 2200;
export const DEFAULT_USER_CHAR_LIMIT = 1375;
export const ENTRY_DELIMITER = "\n";

function parsePositiveInt(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string" && v.trim()) {
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function uid(prefix = "mem") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`;
}

export function resolveMemoryLimits(env = process.env, home) {
  const fromEnvMem = parsePositiveInt(env.PADDY_MEMORY_CHAR_LIMIT);
  const fromEnvUser = parsePositiveInt(env.PADDY_USER_CHAR_LIMIT);
  const fromEnvRecall = parsePositiveInt(env.PADDY_RECALL_LIMIT);
  let memoryCharLimit = fromEnvMem ?? DEFAULT_MEMORY_CHAR_LIMIT;
  let userCharLimit = fromEnvUser ?? DEFAULT_USER_CHAR_LIMIT;
  let recallLimit = fromEnvRecall ?? 12;
  let enabled = true;
  let fts = false;
  const cfgPath = join((home || env.PADDY_HOME || "").trim() || join(homedir(), ".paddy"), "config.json");
  try {
    if (existsSync(cfgPath)) {
      const raw = JSON.parse(readFileSync(cfgPath, "utf8"));
      const mem = raw?.agents?.defaults?.memory;
      if (mem && typeof mem === "object" && !Array.isArray(mem)) {
        if (typeof mem.enabled === "boolean") enabled = mem.enabled;
        if (fromEnvMem == null) { const n = parsePositiveInt(mem.memoryCharLimit); if (n != null) memoryCharLimit = n; }
        if (fromEnvUser == null) { const n = parsePositiveInt(mem.userCharLimit); if (n != null) userCharLimit = n; }
        if (fromEnvRecall == null) { const n = parsePositiveInt(mem.recallLimit); if (n != null) recallLimit = n; }
        if (typeof mem.fts === "boolean") fts = mem.fts;
      }
    }
  } catch { /* ignore */ }
  return {
    enabled,
    memoryCharLimit: Math.max(0, memoryCharLimit),
    userCharLimit: Math.max(0, userCharLimit),
    recallLimit: Math.min(32, Math.max(1, recallLimit)),
    ftsEnabled: Boolean(fts),
  };
}

export function charCountOf(texts) {
  if (!texts.length) return 0;
  return texts.join(ENTRY_DELIMITER).length;
}

export function charLimitFor(target, limits) {
  return target === "user" ? limits.userCharLimit : limits.memoryCharLimit;
}

export function parseUserEntries(markdown) {
  const out = [];
  for (const line of String(markdown ?? "").split("\n")) {
    const m = line.match(/^- (?:\((\w+)\)\s+)?(.+)$/);
    if (!m) continue;
    const body = (m[2] ?? "").trim();
    if (!body || body === "(empty)") continue;
    out.push(body);
  }
  if (!out.length) {
    const stripped = String(markdown ?? "")
      .replace(/^#\s*USER\.md\s*/i, "")
      .replace(/^#\s*MEMORY\.md\s*/i, "")
      .trim();
    if (stripped) out.push(stripped);
  }
  return out;
}

export function rebuildUserFile(entries) {
  const lines = entries.map((t) => `- ${t}`);
  return `# USER.md\n\n${lines.join("\n") || "- (empty)"}`;
}

export function rebuildMemoryFile(memories) {
  const lines = (memories ?? []).map((m) => `- (${m.kind || "fact"}) ${m.text}`);
  return `# MEMORY.md\n\n${lines.join("\n") || "- (empty)"}`;
}

export function findUniqueMatch(texts, oldText) {
  const exact = [];
  for (let i = 0; i < texts.length; i += 1) if (texts[i] === oldText) exact.push(i);
  const matches = exact.length ? exact : texts.map((t, i) => (t.includes(oldText) ? i : -1)).filter((i) => i >= 0);
  const distinct = new Set(matches.map((i) => texts[i]));
  if (distinct.size > 1) return { index: null, ambiguous: true };
  if (!matches.length) return { index: null, ambiguous: false };
  return { index: matches[0], ambiguous: false };
}

function clip(s, n) { return s.length <= n ? s : `${s.slice(0, n)}...`; }

function overflowError(target, currentOrProposed, limit, addChars, entries, isReplace = false) {
  const label = target === "user" ? "USER" : "MEMORY";
  const msg = isReplace
    ? `Replacement would put ${label} at ${currentOrProposed.toLocaleString()}/${limit.toLocaleString()} chars. Shorten the new content, or remove other entries, then retry.`
    : `${label} at ${currentOrProposed.toLocaleString()}/${limit.toLocaleString()} chars. Adding this entry (${addChars} chars) would exceed the limit. Consolidate with replace/remove, then retry.`;
  return { ok: false, error: msg, code: "overflow", currentEntries: entries, usage: `${currentOrProposed}/${limit}` };
}

export function usageMeters(ws, limits) {
  const lim = limits ?? resolveMemoryLimits();
  const memTexts = (ws.memories ?? []).map((m) => String(m.text ?? ""));
  const userTexts = parseUserEntries(ws.files?.user ?? "");
  const memoryChars = charCountOf(memTexts);
  const userChars = charCountOf(userTexts);
  return {
    memoryChars, memoryLimit: lim.memoryCharLimit, userChars, userLimit: lim.userCharLimit,
    memory: `${memoryChars}/${lim.memoryCharLimit}`, user: `${userChars}/${lim.userCharLimit}`,
  };
}

export function applyMemoryWrite(ws, opts) {
  const target = opts.target === "user" ? "user" : "memory";
  const action = opts.action;
  const text = String(opts.text ?? "").trim();
  const oldText = String(opts.oldText ?? "").trim();
  const limits = {
    memoryCharLimit: opts.limits?.memoryCharLimit ?? DEFAULT_MEMORY_CHAR_LIMIT,
    userCharLimit: opts.limits?.userCharLimit ?? DEFAULT_USER_CHAR_LIMIT,
  };
  const limit = charLimitFor(target, limits);
  const now = opts.now ? opts.now() : Date.now();

  if (action !== "add" && action !== "replace" && action !== "remove") {
    return { ok: false, error: `Unknown action '${action}'. Use: add, replace, remove` };
  }
  if (action === "add" && !text) return { ok: false, error: "Content is required for 'add' action." };
  if ((action === "replace" || action === "remove") && !oldText) {
    return { ok: false, error: action === "replace"
      ? "oldText is required for 'replace' (substring identifying the entry)."
      : "oldText is required for 'remove'." };
  }
  if (action === "replace" && !text) {
    return { ok: false, error: "text is required for 'replace' action. Use 'remove' to delete." };
  }

  const next = { ...ws, files: { ...(ws.files ?? {}) }, memories: [...(ws.memories ?? [])] };

  if (target === "memory") {
    const texts = next.memories.map((m) => String(m.text ?? ""));
    if (action === "add") {
      if (texts.includes(text)) {
        return { ok: true, workspace: next, message: "Entry already exists (no duplicate added).", usage: usageMeters(next, limits) };
      }
      const proposed = charCountOf([...texts, text]);
      if (proposed > limit) return overflowError(target, charCountOf(texts), limit, text.length, texts);
      const kind = ["preference","lesson","episode","fact"].includes(opts.kind) ? opts.kind : "fact";
      const embedding = opts.embed ? opts.embed(text) : undefined;
      next.memories.push({
        id: uid("mem"), text, kind, at: now, source: "api", embedding,
        importance: kind === "preference" ? 0.9 : kind === "fact" ? 0.75 : 0.6,
      });
      next.files.memory = rebuildMemoryFile(next.memories);
      return { ok: true, workspace: next, message: "Entry added.", usage: usageMeters(next, limits) };
    }
    const { index, ambiguous } = findUniqueMatch(texts, oldText);
    if (ambiguous) return { ok: false, error: `Multiple entries matched '${oldText}'. Be more specific.`, matches: texts.filter((t) => t.includes(oldText)).map((t) => clip(t, 80)) };
    if (index == null) return { ok: false, error: `No entry matched '${oldText}'.`, currentEntries: texts };
    if (action === "remove") {
      next.memories = next.memories.filter((_, i) => i !== index);
      next.files.memory = rebuildMemoryFile(next.memories);
      return { ok: true, workspace: next, message: "Entry removed.", usage: usageMeters(next, limits) };
    }
    const proposedTexts = texts.map((t, i) => (i === index ? text : t));
    const proposed = charCountOf(proposedTexts);
    if (proposed > limit) return overflowError(target, proposed, limit, text.length, texts, true);
    const kind = ["preference","lesson","episode","fact"].includes(opts.kind) ? opts.kind : next.memories[index]?.kind || "fact";
    const replaced = next.memories[index];
    const embedding = opts.embed ? opts.embed(text, replaced?.embedding) : replaced?.embedding;
    next.memories = next.memories.map((m, i) => i === index ? {
      ...m, text, kind, at: now, source: "api", embedding,
      importance: kind === "preference" ? 0.9 : kind === "fact" ? 0.75 : m.importance ?? 0.6,
    } : m);
    next.files.memory = rebuildMemoryFile(next.memories);
    return { ok: true, workspace: next, message: "Entry replaced.", replacedEntry: replaced?.text, usage: usageMeters(next, limits) };
  }

  const texts = parseUserEntries(next.files.user ?? "");
  if (action === "add") {
    if (texts.includes(text)) {
      return { ok: true, workspace: next, message: "Entry already exists (no duplicate added).", usage: usageMeters(next, limits) };
    }
    const proposed = charCountOf([...texts, text]);
    if (proposed > limit) return overflowError(target, charCountOf(texts), limit, text.length, texts);
    next.files.user = rebuildUserFile([...texts, text]);
    return { ok: true, workspace: next, message: "Entry added.", usage: usageMeters(next, limits) };
  }
  const { index, ambiguous } = findUniqueMatch(texts, oldText);
  if (ambiguous) return { ok: false, error: `Multiple entries matched '${oldText}'. Be more specific.`, matches: texts.filter((t) => t.includes(oldText)).map((t) => clip(t, 80)) };
  if (index == null) return { ok: false, error: `No entry matched '${oldText}'.`, currentEntries: texts };
  if (action === "remove") {
    next.files.user = rebuildUserFile(texts.filter((_, i) => i !== index));
    return { ok: true, workspace: next, message: "Entry removed.", usage: usageMeters(next, limits) };
  }
  const proposedTexts = texts.map((t, i) => (i === index ? text : t));
  const proposed = charCountOf(proposedTexts);
  if (proposed > limit) return overflowError(target, proposed, limit, text.length, texts, true);
  const replacedEntry = texts[index];
  next.files.user = rebuildUserFile(proposedTexts);
  return { ok: true, workspace: next, message: "Entry replaced.", replacedEntry, usage: usageMeters(next, limits) };
}

export function memoryStatus(ws, env = process.env) {
  const limits = resolveMemoryLimits(env);
  const meters = usageMeters(ws, limits);
  const embeddingMode =
    (env.PADDY_EMBEDDING_URL || "").trim() &&
    (env.PADDY_EMBEDDING_API_KEY || env.OPENAI_API_KEY || env.XAI_API_KEY || "").trim()
      ? "http" : "local";
  return {
    memoryChars: meters.memoryChars, memoryLimit: meters.memoryLimit,
    userChars: meters.userChars, userLimit: meters.userLimit,
    entryCount: (ws.memories ?? []).length + parseUserEntries(ws.files?.user ?? "").length,
    ftsEnabled: false, embeddingMode,
  };
}

export function memoryList(ws, target) {
  const memories = Array.isArray(ws.memories) ? ws.memories : [];
  if (target === "memory") {
    return { target: "memory", entries: memories, markdown: typeof ws.files?.memory === "string" ? ws.files.memory : rebuildMemoryFile(memories) };
  }
  if (target === "user") {
    const texts = parseUserEntries(ws.files?.user ?? "");
    return {
      target: "user",
      entries: texts.map((text, i) => ({ id: `user_${i}`, text, kind: "preference", at: 0, source: "user" })),
      markdown: typeof ws.files?.user === "string" ? ws.files.user : rebuildUserFile(texts),
    };
  }
  return { memory: memoryList(ws, "memory"), user: memoryList(ws, "user") };
}

export function memoryReset(ws, target, confirm) {
  if (confirm !== true) return { ok: false, error: "confirm: true is required to reset memory." };
  if (target !== "all" && target !== "memory" && target !== "user") {
    return { ok: false, error: `Unknown reset target '${target}'. Use all|memory|user.` };
  }
  const next = { ...ws, files: { ...(ws.files ?? {}) }, memories: [...(ws.memories ?? [])] };
  if (target === "memory" || target === "all") { next.memories = []; next.files.memory = rebuildMemoryFile([]); }
  if (target === "user" || target === "all") { next.files.user = rebuildUserFile([]); }
  return { ok: true, workspace: next, message: `Reset ${target}.` };
}

export function ensureSessionFreeze(ws, sessionId, channelId = "web") {
  const sid = sessionId || "web:operator";
  const sessions = Array.isArray(ws.sessions) ? [...ws.sessions] : [];
  const idx = sessions.findIndex((s) => s.id === sid);
  const memoryMd = typeof ws.files?.memory === "string" ? ws.files.memory : rebuildMemoryFile(ws.memories ?? []);
  const userMd = typeof ws.files?.user === "string" ? ws.files.user : rebuildUserFile([]);
  if (idx >= 0) {
    const cur = sessions[idx];
    if (cur.frozenMemory && typeof cur.frozenMemory.memory === "string") {
      return { workspace: ws, frozen: cur.frozenMemory, created: false };
    }
    const frozen = { memory: memoryMd, user: userMd, at: Date.now() };
    sessions[idx] = { ...cur, frozenMemory: frozen };
    return { workspace: { ...ws, sessions }, frozen, created: true };
  }
  const frozen = { memory: memoryMd, user: userMd, at: Date.now() };
  sessions.unshift({ id: sid, channelId: channelId || "web", title: channelId || "web", lastAt: Date.now(), preview: "", unread: 0, frozenMemory: frozen });
  return { workspace: { ...ws, sessions }, frozen, created: true };
}

export function filesForTurn(ws, sessionId) {
  const sid = sessionId || "web:operator";
  const session = (ws.sessions ?? []).find((s) => s.id === sid);
  const frozen = session?.frozenMemory;
  const files = { ...(ws.files ?? {}) };
  if (frozen && typeof frozen.memory === "string") files.memory = frozen.memory;
  if (frozen && typeof frozen.user === "string") files.user = frozen.user;
  return files;
}

export function wouldMemoryOverflow(ws, text, mode = "append", limits) {
  const lim = limits?.memoryCharLimit ?? resolveMemoryLimits().memoryCharLimit;
  const base = mode === "replace" ? [] : (ws.memories ?? []).map((m) => String(m.text ?? ""));
  const body = String(text ?? "").trim();
  if (!body) return { overflow: false, chars: charCountOf(base), limit: lim };
  if (base.includes(body) && mode === "append") return { overflow: false, chars: charCountOf(base), limit: lim };
  const proposed = charCountOf([...base, body]);
  return { overflow: proposed > lim, chars: proposed, limit: lim, current: charCountOf(base) };
}

export function wouldUserOverflow(content, limits) {
  const lim = limits?.userCharLimit ?? resolveMemoryLimits().userCharLimit;
  const chars = charCountOf(parseUserEntries(content));
  return { overflow: chars > lim, chars, limit: lim };
}
