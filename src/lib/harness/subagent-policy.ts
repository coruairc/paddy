import type { Policy, ToolName } from "./types";

const NESTED_DENY = new Set<ToolName>(["send_channel", "spawn_subagent"]);

function looksLikeMcp(name: string): boolean {
  return name.startsWith("mcp__");
}

/** Inherit the parent's auto-approve list, minus nested-dangerous tools. */
export function resolveSubagentToolPolicy(parent: Policy): ToolName[] {
  return parent.autoApprove.filter((t) => !NESTED_DENY.has(t));
}

export function subagentMayUse(parent: Policy, name: string): boolean {
  if (looksLikeMcp(name)) return false;
  if (NESTED_DENY.has(name as ToolName)) return false;
  return parent.autoApprove.includes(name as ToolName);
}

/** One approval-policy check for built-in and MCP tools. MCP is always gated. */
export function toolNeedsApproval(name: string, policy: Policy): boolean {
  if (looksLikeMcp(name)) return true;
  if (policy.autoApprove.includes(name as ToolName)) return false;
  return policy.requireApproval.includes(name as ToolName);
}

export function approvalReason(name: string): string {
  if (looksLikeMcp(name)) return "MCP tools are always approval-gated.";
  if (name === "send_channel") {
    return "Outbound channel send is delivered by the live bridge after you approve.";
  }
  if (name === "spawn_subagent") return "Subagents spend a nested model call.";
  return `${name} is gated in this profile’s approval policy.`;
}
