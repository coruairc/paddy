import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMutation, applyTurnToWorkspace, curatorPass, matchSkills, parseMemoryFile, parseSkillMd, toSkillMd } from "./mutate.ts";
import type { Skill, WorkspaceState } from "./types.ts";

function emptyWs(over: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    files: {
      soul: "# SOUL",
      identity: "# ID",
      user: "# USER",
      memory: "# MEMORY.md\n",
      agents: "# AGENTS",
      heartbeat: "# HEARTBEAT",
      ...over.files,
    },
    skills: over.skills ?? [],
    memories: over.memories ?? [],
    messages: [],
    traces: [],
    canvas: [],
    checkpoints: [],
    wakes: [],
    dailyNotes: over.dailyNotes ?? [],
    tickets: over.tickets ?? [],
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      turns: 0,
      toolCalls: 0,
      lastModel: "",
      lastProvider: "",
      lastAt: null,
      turnsSinceMemoryWrite: 0,
      lastTurnToolCalls: 0,
      skillNudge: false,
    },
    sessions: [],
  };
}

function skill(name: string, extra: Partial<Skill> = {}): Skill {
  return {
    id: name,
    name,
    description: `${name} desc`,
    instructions: "do the thing",
    triggers: extra.triggers ?? [name],
    status: extra.status ?? "active",
    uses: extra.uses ?? 0,
    lastUsedAt: extra.lastUsedAt ?? null,
    createdAt: extra.createdAt ?? Date.now(),
    origin: extra.origin ?? "learned",
    ...extra,
  };
}

test("write_memory appends and rebuilds MEMORY.md", () => {
  const ws = applyMutation(emptyWs(), {
    type: "write_memory",
    text: "Prefer terse replies",
    kind: "preference",
    mode: "append",
  });
  assert.equal(ws.memories.length, 1);
  assert.match(ws.files.memory, /Prefer terse replies/);
});

test("write_memory replace clears prior facts", () => {
  const first = applyMutation(emptyWs(), {
    type: "write_memory",
    text: "old",
    kind: "fact",
    mode: "append",
  });
  const next = applyMutation(first, {
    type: "write_memory",
    text: "new",
    kind: "fact",
    mode: "replace",
  });
  assert.equal(next.memories.length, 1);
  assert.equal(next.memories[0]?.text, "new");
  assert.doesNotMatch(next.files.memory, /old/);
});

test("update_heartbeat writes HEARTBEAT.md", () => {
  const ws = applyMutation(emptyWs(), {
    type: "update_heartbeat",
    content: "# HEARTBEAT.md\n\nHEARTBEAT_OK\n",
  });
  assert.match(ws.files.heartbeat, /HEARTBEAT_OK/);
});

test("toSkillMd emits YAML frontmatter", () => {
  const md = toSkillMd({
    name: "standup-notes",
    description: "nine lines",
    instructions: "Ask for notes.",
    triggers: ["standup", "scrum"],
    status: "active",
  });
  assert.match(md, /^---\nname: standup-notes/m);
  assert.match(md, /triggers: \[standup, scrum\]/);
  assert.match(md, /Ask for notes/);
});

test("parseSkillMd reads OpenClaw frontmatter", () => {
  const parsed = parseSkillMd(`---
name: Morning Brief
description: Compress overnight notes.
triggers:
  - morning brief
  - overnight
version: 1.0.0
---

1. search_memory
2. canvas_render kind=markdown
`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.name, "morning-brief");
  assert.equal(parsed.description, "Compress overnight notes.");
  assert.deepEqual(parsed.triggers, ["morning brief", "overnight"]);
  assert.match(parsed.instructions, /canvas_render/);
  assert.equal(parsed.version, "1.0.0");
});

test("parseSkillMd round-trips toSkillMd", () => {
  const md = toSkillMd({
    name: "ticket-cut",
    description: "cut work",
    instructions: "create_ticket for each slice.",
    triggers: ["cut tickets"],
    status: "active",
  });
  const parsed = parseSkillMd(md);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.name, "ticket-cut");
  assert.equal(parsed.instructions, "create_ticket for each slice.");
  assert.deepEqual(parsed.triggers, ["cut tickets"]);
});

test("parseSkillMd uses heading when frontmatter is missing", () => {
  const parsed = parseSkillMd("# Decision log\n\nwrite_memory kind=lesson\n");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.name, "decision-log");
  assert.match(parsed.instructions, /write_memory/);
});

test("create_skill can land active", () => {
  const ws = applyMutation(emptyWs(), {
    type: "create_skill",
    name: "morning-brief",
    description: "brief",
    instructions: "canvas_render",
    triggers: ["morning brief"],
    status: "active",
    origin: "learned",
  });
  assert.equal(ws.skills[0]?.status, "active");
  assert.equal(ws.skills[0]?.name, "morning-brief");
});

test("matchSkills prefers trigger hits over popularity", () => {
  const skills = [
    skill("canvas-brief", { uses: 99, status: "active", triggers: ["diagram"] }),
    skill("standup-notes", { uses: 1, status: "active", triggers: ["standup", "scrum"] }),
  ];
  const hits = matchSkills(skills, "please turn this into a standup");
  assert.equal(hits[0]?.name, "standup-notes");
});

test("matchSkills returns empty when nothing matches", () => {
  const skills = [skill("canvas-brief", { uses: 99, status: "active", triggers: ["diagram"] })];
  const hits = matchSkills(skills, "what is the weather in cork");
  assert.equal(hits.length, 0);
});

test("matchSkills pins a forced skill", () => {
  const skills = [
    skill("canvas-brief", { uses: 99, status: "active", triggers: ["diagram"] }),
    skill("standup-notes", { uses: 1, status: "active", triggers: ["standup"] }),
  ];
  const hits = matchSkills(skills, "hello", 3, "standup-notes");
  assert.equal(hits[0]?.name, "standup-notes");
});

test("curator archives unused learned skills after 30d", () => {
  const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
  const pass = curatorPass(
    emptyWs({
      skills: [skill("dusty", { origin: "learned", uses: 0, createdAt: old, lastUsedAt: null })],
    }),
  );
  assert.equal(pass.skills[0]?.status, "archived");
});

test("curator folds skills that share two triggers", () => {
  const pass = curatorPass(
    emptyWs({
      skills: [
        skill("alpha", { uses: 2, triggers: ["brief", "recap"], status: "active", origin: "learned" }),
        skill("beta", { uses: 9, triggers: ["brief", "recap"], status: "active", origin: "learned" }),
      ],
    }),
  );
  const archived = pass.skills.filter((s) => s.status === "archived");
  const live = pass.skills.filter((s) => s.status !== "archived");
  assert.equal(archived.length, 1);
  assert.equal(live[0]?.name, "beta");
  assert.match(archived[0]?.instructions ?? "", /Superseded by beta/);
});

test("parseMemoryFile rebuilds entries from MEMORY.md bullets", () => {
  const entries = parseMemoryFile(
    "# MEMORY.md\n\n- (preference) Prefer terse replies\n- (lesson) Silence is cheaper\n- (empty)\n",
  );
  assert.equal(entries.length, 2);
  assert.equal(entries[0]?.kind, "preference");
  assert.equal(entries[0]?.text, "Prefer terse replies");
  assert.equal(entries[1]?.kind, "lesson");
});

test("applyTurnToWorkspace is the shared CLI/web write path", () => {
  const payload = {
    userText: "Remember I like diagrams",
    channelId: "web",
    sessionId: "web:operator",
    result: {
      ok: true as const,
      text: "Noted.",
      mutations: [
        { type: "write_memory" as const, text: "Likes diagrams", kind: "preference" as const, mode: "append" as const },
      ],
      traces: [{ kind: "memory" as const, title: "Memory synced", status: "ok" as const }],
    },
    clearUnread: true,
  };
  const cli = applyTurnToWorkspace(emptyWs(), payload);
  const web = applyTurnToWorkspace(emptyWs(), payload);
  assert.equal(cli.memories[0]?.text, web.memories[0]?.text);
  assert.equal(cli.messages[1]?.content, "Noted.");
  assert.match(cli.files.memory, /Likes diagrams/);
});
