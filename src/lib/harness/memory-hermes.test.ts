import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyMemoryWrite,
  DEFAULT_MEMORY_CHAR_LIMIT,
  DEFAULT_USER_CHAR_LIMIT,
  ensureSessionFreeze,
  filesForTurn,
  memoryList,
  memoryReset,
  memoryStatus,
  resolveMemoryLimits,
  usageMeters,
} from "./memory-hermes.mjs";
import { blankWorkspace } from "./memory-store.ts";

test("defaults are Hermes caps 2200 / 1375", () => {
  assert.equal(DEFAULT_MEMORY_CHAR_LIMIT, 2200);
  assert.equal(DEFAULT_USER_CHAR_LIMIT, 1375);
  const lim = resolveMemoryLimits({ PADDY_HOME: "/nonexistent-paddy-home-xyz" });
  assert.equal(lim.memoryCharLimit, 2200);
  assert.equal(lim.userCharLimit, 1375);
});

test("env overrides char limits", () => {
  const lim = resolveMemoryLimits({
    PADDY_HOME: "/nonexistent-paddy-home-xyz",
    PADDY_MEMORY_CHAR_LIMIT: "100",
    PADDY_USER_CHAR_LIMIT: "50",
  });
  assert.equal(lim.memoryCharLimit, 100);
  assert.equal(lim.userCharLimit, 50);
});

test("agents.defaults.memory from config.json when present", () => {
  const home = mkdtempSync(join(tmpdir(), "paddy-mem-cfg-"));
  writeFileSync(
    join(home, "config.json"),
    JSON.stringify({
      version: 1,
      agents: { defaults: { memory: { memoryCharLimit: 300, userCharLimit: 200, recallLimit: 5 } } },
    }),
  );
  const lim = resolveMemoryLimits({ PADDY_HOME: home }, home);
  assert.equal(lim.memoryCharLimit, 300);
  assert.equal(lim.userCharLimit, 200);
  assert.equal(lim.recallLimit, 5);
});

test("add / replace / remove on memory target", () => {
  let ws = blankWorkspace();
  const limits = { memoryCharLimit: 2200, userCharLimit: 1375 };
  let r = applyMemoryWrite(ws, { target: "memory", action: "add", text: "likes tea", kind: "preference", limits });
  assert.equal(r.ok, true);
  ws = r.workspace;
  assert.equal(ws.memories.length, 1);
  assert.match(ws.files.memory, /likes tea/);

  r = applyMemoryWrite(ws, {
    target: "memory",
    action: "replace",
    oldText: "likes tea",
    text: "likes strong tea",
    limits,
  });
  assert.equal(r.ok, true);
  ws = r.workspace;
  assert.equal(ws.memories[0]?.text, "likes strong tea");
  assert.equal(r.replacedEntry, "likes tea");

  r = applyMemoryWrite(ws, { target: "memory", action: "remove", oldText: "strong tea", text: "", limits });
  assert.equal(r.ok, true);
  ws = r.workspace;
  assert.equal(ws.memories.length, 0);
});

test("overflow rejects add — never silent truncate", () => {
  let ws = blankWorkspace();
  const limits = { memoryCharLimit: 40, userCharLimit: 20 };
  const first = applyMemoryWrite(ws, {
    target: "memory",
    action: "add",
    text: "xxxxxxxxxxxxxxxxxxxx", // 20
    limits,
  });
  assert.equal(first.ok, true);
  ws = first.workspace;
  const second = applyMemoryWrite(ws, {
    target: "memory",
    action: "add",
    text: "yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy", // 32 → over
    limits,
  });
  assert.equal(second.ok, false);
  assert.equal(second.code, "overflow");
  assert.match(String(second.error), /exceed/i);
  // original intact
  assert.equal(ws.memories.length, 1);
  assert.equal(ws.memories[0]?.text, "xxxxxxxxxxxxxxxxxxxx");
});

test("user target add/remove with cap", () => {
  let ws = blankWorkspace();
  const limits = { memoryCharLimit: 2200, userCharLimit: 30 };
  let r = applyMemoryWrite(ws, { target: "user", action: "add", text: "Name is Ada", limits });
  assert.equal(r.ok, true);
  ws = r.workspace;
  assert.match(ws.files.user, /Name is Ada/);
  r = applyMemoryWrite(ws, {
    target: "user",
    action: "add",
    text: "This is a long preference that blows the tiny user budget",
    limits,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "overflow");
});

test("memoryStatus shape for Frontend", () => {
  const ws = blankWorkspace();
  ws.memories = [{ id: "m1", text: "fact one", kind: "fact", at: 1, source: "t" }];
  ws.files.user = "# USER.md\n\n- prefers dark mode\n";
  const status = memoryStatus(ws, { PADDY_HOME: "/nonexistent" });
  assert.equal(typeof status.memoryChars, "number");
  assert.equal(status.memoryLimit, 2200);
  assert.equal(typeof status.userChars, "number");
  assert.equal(status.userLimit, 1375);
  assert.equal(typeof status.entryCount, "number");
  assert.equal(status.ftsEnabled, false);
  assert.equal(status.embeddingMode, "local");
});

test("memoryList returns entries + raw markdown", () => {
  const ws = blankWorkspace();
  ws.memories = [{ id: "m1", text: "alpha", kind: "fact", at: 1, source: "t" }];
  ws.files.memory = "# MEMORY.md\n\n- (fact) alpha\n";
  ws.files.user = "# USER.md\n\n- beta\n";
  const mem = memoryList(ws, "memory");
  assert.equal(mem.target, "memory");
  assert.equal(mem.entries.length, 1);
  assert.match(mem.markdown, /alpha/);
  const user = memoryList(ws, "user");
  assert.equal(user.target, "user");
  assert.equal(user.entries[0]?.text, "beta");
});

test("memoryReset requires confirm", () => {
  const ws = blankWorkspace();
  ws.memories = [{ id: "m1", text: "keep", kind: "fact", at: 1, source: "t" }];
  const denied = memoryReset(ws, "all", false);
  assert.equal(denied.ok, false);
  const ok = memoryReset(ws, "memory", true);
  assert.equal(ok.ok, true);
  assert.equal(ok.workspace.memories.length, 0);
});

test("session freeze does not mutate mid-session after write", () => {
  let ws = blankWorkspace();
  ws.files.memory = "# MEMORY.md\n\n- (fact) frozen-seed\n";
  ws.memories = [{ id: "m1", text: "frozen-seed", kind: "fact", at: 1, source: "t" }];
  const freeze = ensureSessionFreeze(ws, "web:op", "web");
  ws = freeze.workspace;
  assert.equal(freeze.created, true);
  assert.match(freeze.frozen.memory, /frozen-seed/);

  const wrote = applyMemoryWrite(ws, {
    target: "memory",
    action: "add",
    text: "live-only",
    limits: { memoryCharLimit: 2200, userCharLimit: 1375 },
  });
  assert.equal(wrote.ok, true);
  ws = wrote.workspace;
  // Persist freeze row still points at original snapshot
  const again = ensureSessionFreeze(ws, "web:op", "web");
  assert.equal(again.created, false);
  const files = filesForTurn(again.workspace, "web:op");
  assert.match(files.memory, /frozen-seed/);
  assert.doesNotMatch(files.memory, /live-only/);
  // Live store has the new entry
  assert.ok(ws.memories.some((m) => m.text === "live-only"));
});

test("usageMeters format memory/user strings", () => {
  const ws = blankWorkspace();
  ws.memories = [{ id: "m1", text: "abc", kind: "fact", at: 1, source: "t" }];
  const meters = usageMeters(ws, { memoryCharLimit: 2200, userCharLimit: 1375 });
  assert.equal(meters.memory, "3/2200");
  assert.equal(meters.user, "0/1375");
});
