import { test } from "node:test";
import assert from "node:assert/strict";
import { compactMessages, pruneToolOutput } from "./compact.ts";
import type { ChatMsg } from "./brain.ts";

test("pruneToolOutput clips long tool results first", () => {
  const long = "x".repeat(400);
  const clipped = pruneToolOutput(long, 40);
  assert.equal(clipped.length, 41);
  assert.match(clipped, /…$/);
});

test("compactMessages protects system head and last N turns", () => {
  const messages: ChatMsg[] = [
    { role: "system", content: "SOUL" },
    { role: "user", content: "one" },
    { role: "assistant", content: "two" },
    { role: "tool", tool_call_id: "t1", content: "tool-noise-".repeat(80) },
    { role: "user", content: "three" },
    { role: "assistant", content: "four" },
    { role: "user", content: "five" },
    { role: "assistant", content: "six" },
  ];
  const compact = compactMessages(messages, {
    keepHead: 1,
    keepTail: 4,
    budgetChars: 50,
  });
  assert.equal(compact[0]?.role, "system");
  assert.match(String(compact[0]?.content), /SOUL/);
  assert.equal(compact.at(-1)?.content, "six");
  assert.equal(compact.at(-2)?.content, "five");
  const middle = compact.find((m) => typeof m.content === "string" && m.content.startsWith("[compacted"));
  assert.ok(middle);
});
