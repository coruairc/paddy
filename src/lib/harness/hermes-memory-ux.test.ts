import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HERMES_MEMORY_LIFECYCLE,
  configuredRuntimeFromConfig,
  describeHermesMemoryPath,
  formatSyncConflictMessage,
  isHostedPaddyDemoEnv,
  isSyncConflictResult,
  resolveEffectiveRuntimeForMemoryUx,
} from "./hermes-memory-ux.ts";

test("lifecycle lists MemoryStore steps including curatorPass + syncTurn", () => {
  assert.deepEqual([...HERMES_MEMORY_LIFECYCLE], [
    "initialize",
    "prefetch",
    "syncTurn",
    "curatorPass",
    "shutdown",
  ]);
});

test("both runtimes advertise Hermes MemoryStore — never OpenClaw file memory", () => {
  const paddy = describeHermesMemoryPath({ configuredRuntime: "paddy", hostedDemo: false });
  assert.equal(paddy.memoryPath, "hermes-memory-store");
  assert.equal(paddy.runtime, "paddy");
  assert.equal(paddy.openclawModelOnly, false);
  assert.match(paddy.title, /Hermes MemoryStore/i);
  assert.match(paddy.lifecycleLabel, /curatorPass/);
  assert.doesNotMatch(paddy.blurb, /OpenClaw file memory/i);

  const oc = describeHermesMemoryPath({ configuredRuntime: "openclaw", hostedDemo: false });
  assert.equal(oc.memoryPath, "hermes-memory-store");
  assert.equal(oc.runtime, "openclaw");
  assert.equal(oc.openclawModelOnly, true);
  assert.match(oc.blurb, /MemoryStore/i);
  assert.match(oc.blurb, /curatorPass/i);
  assert.match(oc.blurb, /not OpenClaw file memory/i);
  assert.doesNotMatch(oc.title, /file memory/i);
});

test("hosted demo forces paddy + Hermes (no OpenClaw loopback pretend)", () => {
  assert.equal(isHostedPaddyDemoEnv({}), true);
  assert.equal(isHostedPaddyDemoEnv({ PADDY_CLI_TOKEN: "tok" }), false);
  assert.equal(
    resolveEffectiveRuntimeForMemoryUx({ configured: "openclaw", hostedDemo: true }),
    "paddy",
  );
  const hosted = describeHermesMemoryPath({
    configuredRuntime: "openclaw",
    hostedDemo: true,
  });
  assert.equal(hosted.runtime, "paddy");
  assert.equal(hosted.hostedDemo, true);
  assert.equal(hosted.openclawModelOnly, false);
  assert.match(hosted.blurb, /SuperGrok|Hermes/i);
  assert.doesNotMatch(hosted.blurb, /127\.0\.0\.1|loopback/i);
});

test("isSyncConflictResult detects 409-shaped saveWorkspace / CLI payloads", () => {
  assert.equal(isSyncConflictResult({ ok: false, error: "sync_conflict", expected: 1, actual: 2 }), true);
  assert.equal(isSyncConflictResult({ ok: true }), false);
  assert.equal(isSyncConflictResult({ ok: false, error: "other" }), false);
  assert.equal(isSyncConflictResult(null), false);
  assert.equal(isSyncConflictResult(undefined), false);
});

test("formatSyncConflictMessage is recoverable (reload + retry)", () => {
  const msg = formatSyncConflictMessage({ expected: 3, actual: 4 });
  assert.match(msg, /sync conflict/i);
  assert.match(msg, /3/);
  assert.match(msg, /4/);
  assert.match(msg, /Reloaded|retry/i);
});

test("configuredRuntimeFromConfig reads openclaw.runtime without token", () => {
  assert.equal(
    configuredRuntimeFromConfig({
      openclaw: { runtime: "openclaw", token: "secret" },
    }),
    "openclaw",
  );
  assert.equal(configuredRuntimeFromConfig({}), null);
  assert.equal(configuredRuntimeFromConfig(null), null);
});
