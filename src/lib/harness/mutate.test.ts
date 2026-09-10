import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMutation, curatorPass, matchSkills, parseMemoryFile, toSkillMd } from "./mutate.ts";
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

test("matchSkills prefers trigger hits over popularity", () => {
  const skills = [
    skill("canvas-brief", { uses: 99, status: "active", triggers: ["diagram"] }),
    skill("standup-notes", { uses: 1, status: "active", triggers: ["standup", "scrum"] }),
  ];
  const hits = matchSkills(skills, "please turn this into a standup");
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
