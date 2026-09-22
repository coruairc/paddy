/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — Phase D: Hermes memory defaults for both runtimes (node ESM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configSet,
  loadCanonical,
  resolveOpenClawRuntime,
} from "./config.mjs";
import { callOpenClawChat } from "./openclaw-gateway.ts";
import {
  applyHermesTurnPersistence,
  curatorPass,
} from "./mutate.ts";
import {
  blankWorkspace,
  buildTurnInput,
  createMemoryRepo,
  createMemoryStore,
  SyncConflictError,
} from "./memory-store.ts";
import { recallSystemMessage } from "./memory-recall.ts";
import type { HelixTurnResult, Policy, WorkspaceState } from "./types.ts";

const POLICY: Policy = { autoApprove: ["write_memory"], requireApproval: [] };

function home() {
  return mkdtempSync(join(tmpdir(), "paddy-phase-d-"));
}

function seedWithMemory(): Record<string, WorkspaceState> {
  const ws = blankWorkspace();
  ws.memories = [
    {
      id: "mem_pref",
      text: "Operator prefers Irish dry wit on status updates",
      kind: "preference",
      at: Date.now() - 1000,
      source: "seed",
    },
    {
      id: "mem_fact",
      text: "Billing DB is named aurora-main",
      kind: "fact",
      at: Date.now() - 500,
      source: "seed",
    },
  ];
  ws.files.memory =
    "# MEMORY.md\n\n- (preference) Operator prefers Irish dry wit on status updates\n- (fact) Billing DB is named aurora-main\n";
  // Learned skill old enough for curator to mark stale when unused.
  const old = Date.now() - 10 * 24 * 60 * 60 * 1000;
  ws.skills = [
    {
      name: "dusty-brief",
      description: "unused learned skill",
      instructions: "Say hello",
      status: "active",
      uses: 0,
      triggers: ["brief"],
      origin: "learned",
      createdAt: old,
      lastUsedAt: null,
    },
  ];
  return { paddy: ws };
}

function okTurn(overrides?: Partial<Extract<HelixTurnResult, { ok: true }>>): HelixTurnResult {
  return {
    ok: true,
    text: "Noted via OpenClaw path.",
    mutations: [
      {
        type: "write_memory",
        text: "OpenClaw turn wrote a durable fact",
        kind: "fact",
        mode: "append",
      },
    ],
    traces: [{ kind: "model", title: "Direct reply", status: "ok" }],
    usage: {
      promptTokens: 12,
      completionTokens: 4,
      toolCalls: 1,
      model: "openclaw",
      provider: "OpenClaw",
    },
    ...overrides,
  };
}

test("OpenClaw runtime stays active while Hermes MemoryStore is still the persist path", () => {
  const dir = home();
  loadCanonical({ home: dir, persist: true });
  configSet("openclaw.runtime", "openclaw", { home: dir });
  configSet("openclaw.url", "http://127.0.0.1:18789", { home: dir });
  const oc = resolveOpenClawRuntime({ home: dir });
  assert.equal(oc.active, true);
  assert.equal(oc.runtime, "openclaw");
});

test("before turn: ranked recall is injected as system for OpenClaw-shaped chat body", async () => {
  const store = createMemoryStore(createMemoryRepo(), { seed: seedWithMemory });
  await store.initialize();
  const ws = await store.prefetch("paddy");
  const input = buildTurnInput(ws, {
    profileName: "Paddy Irishman",
    role: "operator",
    userMessage: "How is billing looking?",
    sessionId: "web:operator",
    channelId: "web",
    policy: POLICY,
  });
  const recall = recallSystemMessage(input);
  assert.match(recall, /## Memory/);
  assert.match(recall, /aurora-main|Billing/i);
  // Primary system stays in executeTurn via buildSystemPrompt; Phase D adds
  // recall as its own system message for both runtimes (mocked OpenClaw fetch).
  const primarySystem = `You are Paddy.\n<memory-context>\n${input.memories.map((m) => m.text).join("\n")}\n</memory-context>`;
  assert.match(primarySystem, /aurora-main|Billing/i);

  let posted: unknown;
  await callOpenClawChat({
    target: { url: "http://127.0.0.1:18789", token: "t", model: "openclaw" },
    messages: [
      { role: "system", content: primarySystem },
      { role: "system", content: recall },
      { role: "user", content: input.userMessage },
    ],
    fetchImpl: async (_url, init) => {
      posted = JSON.parse(String(init?.body ?? "{}"));
      const sse = [
        'data: {"choices":[{"delta":{"content":"Billing is fine."}}]}',
        "",
        "data: [DONE]",
        "",
      ].join("\n");
      return new Response(sse, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    },
  });
  const body = posted as { messages?: { role: string; content: string }[]; stream?: boolean };
  assert.equal(body.stream, true);
  const systems = (body.messages ?? []).filter((m) => m.role === "system");
  assert.ok(systems.length >= 2, "expected primary system + Hermes recall system");
  assert.ok(
    systems.some((m) => /aurora-main|Billing/i.test(m.content)),
    "OpenClaw request must carry Hermes recall",
  );
});

test("after OpenClaw-shaped turn: curatorPass + syncTurn persist (MemoryStore lifecycle)", async () => {
  const store = createMemoryStore(createMemoryRepo(), { seed: seedWithMemory });
  await store.initialize();
  const ws = await store.prefetch("paddy");
  const baseRev = ws.revision ?? 0;

  const next = applyHermesTurnPersistence(ws, {
    userText: "Remember this from OpenClaw",
    channelId: "web",
    sessionId: "web:operator",
    result: okTurn(),
    clearUnread: true,
  });
  assert.ok(
    next.memories.some((m) => m.text === "OpenClaw turn wrote a durable fact"),
    "mutation applied",
  );
  const dusty = next.skills.find((s) => s.name === "dusty-brief");
  assert.equal(dusty?.status, "stale", "curator marks unused learned skill stale");

  await store.syncTurn("paddy", next);
  assert.equal(next.revision, baseRev + 1);

  const again = await store.prefetch("paddy");
  assert.ok(again.memories.some((m) => m.text === "OpenClaw turn wrote a durable fact"));
  assert.equal(again.skills.find((s) => s.name === "dusty-brief")?.status, "stale");
});

test("SyncConflictError still surfaces after OpenClaw-shaped persist (not swallowed)", async () => {
  const store = createMemoryStore(createMemoryRepo(), { seed: seedWithMemory });
  await store.initialize();
  const a = await store.prefetch("paddy");
  const b = await store.prefetch("paddy");
  const base = a.revision ?? 0;

  const nextA = applyHermesTurnPersistence(a, {
    userText: "first",
    channelId: "web",
    sessionId: "web:operator",
    result: okTurn({ text: "A" }),
  });
  await store.syncTurn("paddy", nextA);
  assert.equal(nextA.revision, base + 1);

  const stale = applyHermesTurnPersistence(b, {
    userText: "stale",
    channelId: "web",
    sessionId: "web:operator",
    result: okTurn({ text: "B" }),
  });
  // stale still holds old revision
  stale.revision = base;
  await assert.rejects(
    () => store.syncTurn("paddy", stale),
    (err: unknown) =>
      err instanceof SyncConflictError && err.expected === base && err.actual === base + 1,
  );
});

test("curatorPass alone still archives learned skills (Hermes design preserved)", () => {
  const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
  const ws = blankWorkspace();
  ws.skills = [
    {
      name: "ancient",
      description: "x",
      instructions: "y",
      status: "active",
      uses: 0,
      triggers: ["x"],
      origin: "learned",
      createdAt: old,
      lastUsedAt: null,
    },
  ];
  const pass = curatorPass(ws);
  assert.equal(pass.skills[0]?.status, "archived");
});
