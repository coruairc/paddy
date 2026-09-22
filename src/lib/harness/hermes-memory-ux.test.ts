import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HERMES_MEMORY_LIFECYCLE,
  applyPersistedWorkspaceRevision,
  configuredRuntimeFromConfig,
  describeHermesMemoryPath,
  formatSyncConflictMessage,
  isHostedPaddyDemoEnv,
  isSyncConflictResult,
  resolveEffectiveRuntimeForMemoryUx,
} from "./hermes-memory-ux.ts";
import { blankWorkspace, createMemoryRepo, createMemoryStore, SyncConflictError } from "./memory-store.ts";

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

test("formatSyncConflictMessage is imperative (reload to sync — not past tense)", () => {
  const msg = formatSyncConflictMessage({ expected: 3, actual: 4 });
  assert.match(msg, /sync conflict/i);
  assert.match(msg, /3/);
  assert.match(msg, /4/);
  assert.match(msg, /Reload to sync/i);
  assert.doesNotMatch(msg, /Reloaded/i);
});

test("applyPersistedWorkspaceRevision advances tip from saveWorkspace ok payload", () => {
  const ws = { revision: 2, label: "x" };
  const next = applyPersistedWorkspaceRevision(ws, { ok: true, revision: 3 });
  assert.equal(next.revision, 3);
  assert.notEqual(next, ws);
  assert.equal(applyPersistedWorkspaceRevision(ws, { ok: false, error: "sync_conflict" }), ws);
  assert.equal(applyPersistedWorkspaceRevision(ws, { ok: true }), ws);
});

test("two sequential persists do not self-conflict when client applies res.revision", async () => {
  const store = createMemoryStore(createMemoryRepo(), {
    seed: async () => ({ paddy: blankWorkspace() }),
  });
  await store.initialize();
  let client = await store.prefetch("paddy");

  async function persistLikeSaveWorkspace(ws: ReturnType<typeof blankWorkspace>) {
    const copy = structuredClone(ws);
    try {
      await store.syncTurn("paddy", copy);
      return { ok: true as const, revision: copy.revision };
    } catch (err) {
      if (err instanceof SyncConflictError) {
        return {
          ok: false as const,
          error: "sync_conflict" as const,
          expected: err.expected,
          actual: err.actual,
        };
      }
      throw err;
    }
  }

  const r1 = await persistLikeSaveWorkspace(client);
  assert.equal(r1.ok, true);
  if (!r1.ok) throw new Error("unreachable");
  // BUG without this: client keeps stale rev → second save 409s against itself
  client = applyPersistedWorkspaceRevision(client, r1);
  assert.equal(client.revision, r1.revision);

  client = {
    ...client,
    files: { ...client.files, memory: `${client.files.memory}\nnote` },
  };
  const r2 = await persistLikeSaveWorkspace(client);
  assert.equal(r2.ok, true, "second persist must not self-conflict after revision patch");
  if (!r2.ok) throw new Error("unreachable");
  client = applyPersistedWorkspaceRevision(client, r2);
  assert.equal(client.revision, r2.revision);

  // Prove the stale-rev path still 409s (regression guard for the bug class)
  const stale = structuredClone(client);
  stale.revision = (r1.revision ?? 0);
  const rStale = await persistLikeSaveWorkspace(stale);
  assert.equal(rStale.ok, false);
  if (rStale.ok) throw new Error("unreachable");
  assert.equal(rStale.error, "sync_conflict");
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
