import { test } from "node:test";
import assert from "node:assert/strict";
import { relatedItems } from "./related.ts";
import { blankWorkspace } from "./memory-store.ts";

test("relatedItems links memories and skills by lexical overlap", () => {
  const ws = blankWorkspace();
  ws.memories = [
    { id: "m1", text: "Prefer terse weekday standups at nine", kind: "preference", at: 1, source: "x" },
    { id: "m2", text: "The cat sat on the mat", kind: "episode", at: 2, source: "x" },
  ];
  ws.skills = [
    {
      id: "s1",
      name: "standup-notes",
      description: "Turn bullets into a standup",
      instructions: "Ask for notes",
      triggers: ["standup", "scrum"],
      status: "active",
      uses: 1,
      lastUsedAt: null,
      createdAt: 1,
      origin: "seeded",
    },
  ];
  const hits = relatedItems(ws, "weekday standup notes");
  assert.ok(hits.some((h) => h.id === "m1"));
  assert.ok(hits.some((h) => h.kind === "skill" && h.label === "standup-notes"));
  assert.ok(!hits.some((h) => h.id === "m2"));
});
