import { test } from "node:test";
import assert from "node:assert/strict";
import { POLICY } from "./defaults.ts";
import { openaiTools } from "./tools.ts";
import { resolveSubagentToolPolicy, subagentMayUse, toolNeedsApproval } from "./subagent-policy.ts";
import type { ToolName } from "./types.ts";

test("subagent inherits auto-approve minus send_channel and spawn_subagent", () => {
  const allow = resolveSubagentToolPolicy(POLICY);
  assert.ok(allow.includes("write_memory"));
  assert.ok(allow.includes("search_memory"));
  assert.ok(!allow.includes("send_channel"));
  assert.ok(!allow.includes("spawn_subagent"));
});

test("negative: a parent that auto-approves send_channel still cannot pass it down", () => {
  const parent = {
    autoApprove: ["write_memory", "send_channel", "spawn_subagent"] as const,
    requireApproval: [],
  };
  const allow = resolveSubagentToolPolicy({
    autoApprove: [...parent.autoApprove],
    requireApproval: [],
  });
  assert.deepEqual(allow, ["write_memory"]);
  assert.equal(subagentMayUse({ autoApprove: [...parent.autoApprove], requireApproval: [] }, "send_channel"), false);
  assert.equal(subagentMayUse({ autoApprove: [...parent.autoApprove], requireApproval: [] }, "spawn_subagent"), false);
});

test("negative: inherited openai tool list never includes send_channel or spawn_subagent", () => {
  const policy = {
    autoApprove: POLICY.autoApprove.concat(["send_channel", "spawn_subagent"]) as ToolName[],
    requireApproval: [],
  };
  const allow = new Set(resolveSubagentToolPolicy(policy));
  const nested = openaiTools().filter((t) => allow.has(t.function.name as ToolName));
  const names = nested.map((t) => t.function.name);
  assert.ok(names.includes("write_memory"));
  assert.ok(!names.includes("send_channel"));
  assert.ok(!names.includes("spawn_subagent"));
});

test("MCP tools always need approval, even if the parent would auto-approve", () => {
  const policy = { autoApprove: [...POLICY.autoApprove], requireApproval: [] };
  assert.equal(toolNeedsApproval("mcp__paddy__echo", policy), true);
  assert.equal(toolNeedsApproval("mcp__echo__ping", policy), true);
  assert.equal(toolNeedsApproval("write_memory", policy), false);
  assert.equal(toolNeedsApproval("send_channel", POLICY), true);
  assert.equal(subagentMayUse(POLICY, "mcp__paddy__echo"), false);
});
