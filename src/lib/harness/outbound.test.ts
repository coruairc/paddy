import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backoffMs,
  enqueueOutboundDurable,
  enqueueOutboundJob,
  loadOutboundJobs,
  markOutboundFailure,
  outboundLimits,
  partitionOutbound,
  sanitizeOutboundError,
  writeOutboundQueue,
  readOutboundQueue,
  appendOutboundDead,
} from "./outbound.mjs";

test("sanitizeOutboundError strips bearer and bot tokens", () => {
  const s = sanitizeOutboundError("Bearer sk-abc123XYZ failed; token 123456789:AAHHxx_test_token_value_here");
  assert.equal(s.includes("Bearer ***"), true);
  assert.equal(s.includes("sk-abc"), false);
});

test("backoff grows then caps exponent", () => {
  assert.equal(backoffMs(1, 1000), 1000);
  assert.equal(backoffMs(2, 1000), 2000);
  assert.equal(backoffMs(3, 1000), 4000);
  assert.equal(backoffMs(20, 1000), 1000 * 2 ** 8);
});

test("partitionOutbound separates due, waiting, dead", () => {
  const limits = outboundLimits({ PADDY_OUTBOUND_MAX_ATTEMPTS: "3" });
  const now = 10_000;
  const jobs = loadOutboundJobs([
    { id: "a", channelId: "telegram", message: "hi", at: 1, attempts: 0, nextAt: 1 },
    { id: "b", channelId: "slack", message: "later", at: 1, attempts: 1, nextAt: 20_000 },
    { id: "c", channelId: "discord", message: "dead", at: 1, attempts: 3, nextAt: 1 },
  ]);
  const { due, waiting, dead } = partitionOutbound(jobs, now, limits);
  assert.deepEqual(due.map((j) => j.id), ["a"]);
  assert.deepEqual(waiting.map((j) => j.id), ["b"]);
  assert.deepEqual(dead.map((j) => j.id), ["c"]);
});

test("markOutboundFailure increments attempts and schedules nextAt", () => {
  const limits = outboundLimits({ PADDY_OUTBOUND_BASE_MS: "1000", PADDY_OUTBOUND_MAX_ATTEMPTS: "5" });
  const job = loadOutboundJobs([{ channelId: "telegram", message: "x", at: 0, attempts: 0, nextAt: 0 }])[0]!;
  const failed = markOutboundFailure(job, new Error("Bearer SECRET_TOKEN boom"), limits, 5000);
  assert.equal(failed.attempts, 1);
  assert.equal(failed.nextAt, 5000 + 1000);
  assert.equal(failed.lastError?.includes("SECRET_TOKEN"), false);
});

test("enqueueOutboundDurable persists jobs without wiping on read", () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-out-"));
  enqueueOutboundDurable({ channelId: "telegram", chatId: "1", message: "one" }, home, {
    PADDY_OUTBOUND_MAX_QUEUE: "40",
  });
  enqueueOutboundDurable({ channelId: "telegram", chatId: "1", message: "two" }, home, {
    PADDY_OUTBOUND_MAX_QUEUE: "40",
  });
  const q = readOutboundQueue(home);
  assert.equal(q.length, 2);
  assert.equal(q[0]!.message, "one");
  assert.ok(q[0]!.id);
  assert.equal(q[0]!.attempts, 0);
});

test("legacy rows without id/attempts normalize", () => {
  const jobs = loadOutboundJobs([{ channelId: "email", message: "hello", at: 9 }]);
  assert.equal(jobs.length, 1);
  assert.ok(jobs[0]!.id.startsWith("out_"));
  assert.equal(jobs[0]!.attempts, 0);
});

test("dead letter append is capped", () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-dead-"));
  const limits = outboundLimits({});
  const dead = loadOutboundJobs(
    Array.from({ length: 5 }, (_, i) => ({
      channelId: "telegram",
      message: `m${i}`,
      attempts: 9,
      at: i,
      nextAt: i,
    })),
  );
  appendOutboundDead(dead, home, { ...limits, deadCap: 3 });
  const raw = JSON.parse(readFileSync(join(home, "outbound-dead.json"), "utf8"));
  assert.equal(raw.length, 3);
});
