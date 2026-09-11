import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMutation } from "./mutate.ts";
import {
  blankWorkspace,
  buildTurnInput,
  coerceSnapshot,
  createMemoryRepo,
  createMemoryStore,
  createSqlRepo,
} from "./memory-store.ts";
import type { Policy, WorkspaceState } from "./types.ts";

const POLICY: Policy = { autoApprove: ["write_memory"], requireApproval: [] };

function seedPaddy(): Record<string, WorkspaceState> {
  const ws = blankWorkspace();
  ws.files.memory = "# MEMORY.md\n\n- (fact) seeded\n";
  ws.memories = [
    { id: "mem_seed", text: "seeded", kind: "fact", at: 1, source: "seed" },
  ];
  return { paddy: ws };
}

test("CLI-shaped write is visible to a web-shaped read", async () => {
  const store = createMemoryStore(createMemoryRepo(), { seed: seedPaddy });
  await store.initialize();

  const cliWs = await store.prefetch("paddy");
  const afterCli = applyMutation(cliWs, {
    type: "write_memory",
    text: "Prefer terse replies on weekdays",
    kind: "preference",
    mode: "append",
  });
  await store.syncTurn("paddy", afterCli);

  const webWs = await store.prefetch("paddy");
  assert.equal(webWs.memories.at(-1)?.text, "Prefer terse replies on weekdays");
  assert.match(webWs.files.memory, /Prefer terse replies on weekdays/);
  assert.deepEqual(
    webWs.memories.map((m) => m.text),
    afterCli.memories.map((m) => m.text),
  );
});

test("disk PGLite snapshot survives a reopen (gateway restart)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "paddy-pg-"));
  const dataDir = join(dir, "pglite");
  const { PGlite } = await import("@electric-sql/pglite");
  const migration = readFileSync(join(process.cwd(), "migrations/0002_paddy.sql"), "utf8");

  const wrap = (pg: InstanceType<typeof PGlite>) => ({
    query: async <T>(text: string, params: unknown[] = []) => {
      const result = await pg.query<T>(text, params);
      return result.rows;
    },
  });

  const first = new PGlite(dataDir);
  await first.waitReady;
  await first.exec(migration);
  const storeA = createMemoryStore(createSqlRepo(wrap(first)), { seed: seedPaddy });
  await storeA.initialize();
  const ws = await storeA.prefetch("paddy");
  await storeA.syncTurn(
    "paddy",
    applyMutation(ws, {
      type: "write_memory",
      text: "survives restart",
      kind: "lesson",
      mode: "append",
    }),
  );
  await storeA.shutdown();
  await first.close();

  const second = new PGlite(dataDir);
  await second.waitReady;
  const storeB = createMemoryStore(createSqlRepo(wrap(second)));
  await storeB.initialize();
  const again = await storeB.prefetch("paddy");
  assert.ok(again.memories.some((m) => m.text === "survives restart"));
  await second.close();
});

test("initialize migrates ~/.paddy/workspace.json once", async () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-home-"));
  writeFileSync(
    join(home, "workspace.json"),
    JSON.stringify({
      files: { memory: "# MEMORY.md\n\n- (fact) from cli file\n" },
      memories: [{ id: "m1", text: "from cli file", kind: "fact", at: 2, source: "cli" }],
      history: [{ role: "user", content: "hi" }],
    }),
  );
  const repo = createMemoryRepo();
  const store = createMemoryStore(repo, { home, seed: seedPaddy });
  await store.initialize();
  const ws = await store.prefetch("paddy");
  assert.equal(ws.memories[0]?.text, "from cli file");
  assert.equal(ws.messages[0]?.content, "hi");
  assert.equal(existsSync(join(home, "workspace.migrated")), true);
  await store.initialize();
  const again = await store.prefetch("paddy");
  assert.equal(again.memories.length, 1);
});

test("coerceSnapshot fills missing slices and maps CLI history", () => {
  const ws = coerceSnapshot({
    files: { soul: "# s" },
    history: [{ role: "assistant", content: "ok" }],
  });
  assert.equal(ws.files.soul, "# s");
  assert.equal(ws.files.memory, "");
  assert.equal(ws.messages[0]?.content, "ok");
  assert.equal(ws.usage.turns, 0);
  assert.deepEqual(ws.tickets, []);
});

test("buildTurnInput reads the store snapshot, not a hardcoded seed", async () => {
  const store = createMemoryStore(createMemoryRepo(), { seed: seedPaddy });
  const ws = await store.prefetch("paddy");
  ws.memories.push({
    id: "m2",
    text: "operator likes diagrams",
    kind: "preference",
    at: 3,
    source: "cli",
  });
  const input = buildTurnInput(ws, {
    profileName: "Paddy Irishman",
    role: "operator",
    userMessage: "hello",
    policy: POLICY,
  });
  assert.ok(input.memories.some((m) => m.text === "operator likes diagrams"));
  assert.equal(input.userMessage, "hello");
  assert.equal(input.files.memory.includes("seeded"), true);
});
