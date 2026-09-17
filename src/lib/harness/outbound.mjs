/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Durable outbound queue for channel sends.
 *
 * Failure modes this guards:
 * - wipe-then-send (crash drops the batch)
 * - silent network failure (message lost)
 * - unbounded retry (poison pill)
 * - secrets leaking into lastError
 *
 * File format (~/.paddy/outbound.json): array of OutboundJob.
 * Exhausted jobs move to outbound-dead.json (capped).
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function paddyHome() {
  return process.env.PADDY_HOME?.trim() || join(homedir(), ".paddy");
}

export function outboundPath(home = paddyHome()) {
  return join(home, "outbound.json");
}

export function outboundDeadPath(home = paddyHome()) {
  return join(home, "outbound-dead.json");
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function intFrom(env, name, fallback) {
  const raw = env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** @param {NodeJS.ProcessEnv} [env] */
export function outboundLimits(env = process.env) {
  return {
    maxAttempts: clamp(intFrom(env, "PADDY_OUTBOUND_MAX_ATTEMPTS", 5), 1, 20),
    baseMs: clamp(intFrom(env, "PADDY_OUTBOUND_BASE_MS", 2000), 100, 600_000),
    maxQueue: clamp(intFrom(env, "PADDY_OUTBOUND_MAX_QUEUE", 100), 10, 1000),
    deadCap: 40,
  };
}

/** Strip tokens / bearer material from error text before persistence. */
export function sanitizeOutboundError(err) {
  let s = err instanceof Error ? err.message : String(err ?? "send failed");
  s = s.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer ***");
  s = s.replace(/\b(xox[baprs]-|xapp-|ghp_|sk-|EAA)[A-Za-z0-9_\-]+/g, "***");
  s = s.replace(/\b\d{8,}:[A-Za-z0-9_\-]{20,}\b/g, "***");
  return s.slice(0, 240);
}

export function backoffMs(attempts, baseMs) {
  const exp = Math.min(8, Math.max(0, attempts - 1));
  return baseMs * 2 ** exp;
}

function newId(now = Date.now()) {
  return `out_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Normalize legacy `{channelId,chatId,message,at}` rows into durable jobs.
 * @param {unknown} raw
 * @param {number} [now]
 */
export function normalizeOutboundJob(raw, now = Date.now()) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const channelId = typeof o.channelId === "string" ? o.channelId : "";
  const message = typeof o.message === "string" ? o.message : "";
  if (!channelId || !message) return null;
  const attempts = Number.isFinite(Number(o.attempts)) ? Math.max(0, Number(o.attempts)) : 0;
  const at = typeof o.at === "number" ? o.at : now;
  const nextAt = typeof o.nextAt === "number" ? o.nextAt : at;
  return {
    id: typeof o.id === "string" && o.id ? o.id : newId(now),
    channelId,
    chatId: typeof o.chatId === "string" ? o.chatId : undefined,
    message: message.slice(0, 4000),
    at,
    attempts,
    nextAt,
    lastError: typeof o.lastError === "string" ? sanitizeOutboundError(o.lastError) : undefined,
  };
}

/** @param {unknown} raw */
export function loadOutboundJobs(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw) {
    const job = normalizeOutboundJob(row);
    if (job) out.push(job);
  }
  return out;
}

/**
 * Enqueue a job. On backpressure, oldest jobs are returned in `overflowed`
 * (caller should dead-letter) instead of being silently dropped.
 * @param {NonNullable<ReturnType<typeof normalizeOutboundJob>>[]} queue
 * @param {{ channelId: string, chatId?: string, message: string }} row
 * @param {ReturnType<typeof outboundLimits>} limits
 * @param {number} [now]
 * @returns {{ queue: NonNullable<ReturnType<typeof normalizeOutboundJob>>[], overflowed: NonNullable<ReturnType<typeof normalizeOutboundJob>>[] }}
 */
export function enqueueOutboundJob(queue, row, limits, now = Date.now()) {
  const job = normalizeOutboundJob({ ...row, at: now, attempts: 0, nextAt: now }, now);
  if (!job) return { queue, overflowed: [] };
  const next = [...queue, job];
  if (next.length <= limits.maxQueue) {
    return { queue: next, overflowed: [] };
  }
  const drop = next.length - limits.maxQueue;
  const overflowed = next.slice(0, drop).map((j) => ({
    ...j,
    lastError: sanitizeOutboundError(j.lastError || "queue overflow (dropped under backpressure)"),
  }));
  return { queue: next.slice(drop), overflowed };
}

/**
 * @param {NonNullable<ReturnType<typeof normalizeOutboundJob>>[]} queue
 * @param {number} now
 * @param {ReturnType<typeof outboundLimits>} limits
 */
export function partitionOutbound(queue, now, limits) {
  /** @type {typeof queue} */
  const due = [];
  /** @type {typeof queue} */
  const waiting = [];
  /** @type {typeof queue} */
  const dead = [];
  for (const job of queue) {
    if (job.attempts >= limits.maxAttempts) {
      dead.push(job);
      continue;
    }
    if (job.nextAt <= now) due.push(job);
    else waiting.push(job);
  }
  return { due, waiting, dead };
}

/**
 * @param {NonNullable<ReturnType<typeof normalizeOutboundJob>>} job
 * @param {unknown} err
 * @param {ReturnType<typeof outboundLimits>} limits
 * @param {number} [now]
 */
export function markOutboundFailure(job, err, limits, now = Date.now()) {
  const attempts = job.attempts + 1;
  return {
    ...job,
    attempts,
    nextAt: now + backoffMs(attempts, limits.baseMs),
    lastError: sanitizeOutboundError(err),
  };
}

function ensureHome(home) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
}

function writeJsonSecure(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
}

export function readOutboundQueue(home = paddyHome()) {
  try {
    return loadOutboundJobs(JSON.parse(readFileSync(outboundPath(home), "utf8"));
  } catch {
    return [];
  }
}

export function writeOutboundQueue(queue, home = paddyHome()) {
  ensureHome(home);
  writeJsonSecure(outboundPath(home), queue);
}

export function appendOutboundDead(dead, home = paddyHome(), limits = outboundLimits()) {
  if (!dead.length) return;
  ensureHome(home);
  let prev = [];
  try {
    prev = loadOutboundJobs(JSON.parse(readFileSync(outboundDeadPath(home), "utf8")));
  } catch {
    prev = [];
  }
  writeJsonSecure(outboundDeadPath(home), [...dead, ...prev].slice(0, limits.deadCap));
}

/**
 * Disk enqueue used by harness + CLI.
 * @param {{ channelId: string, chatId?: string, message: string }} row
 */
export function enqueueOutboundDurable(row, home = paddyHome(), env = process.env) {
  const limits = outboundLimits(env);
  const { queue, overflowed } = enqueueOutboundJob(readOutboundQueue(home), row, limits);
  if (overflowed.length) appendOutboundDead(overflowed, home, limits);
  writeOutboundQueue(queue, home);
  return queue[queue.length - 1];
}
