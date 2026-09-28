export const GLOBAL_SCOPE = "global";

export type ScopeInput = {
  senderId?: string;
  channel?: string;
  sessionKey?: string;
  agentId?: string;
};

/**
 * Per conversation identity. Nothing becomes `global` from an active turn.
 * Returns "" when the turn has no identity — callers must not store or recall
 * under a shared fallback bucket.
 */
export function scopeKey(input: ScopeInput): string {
  const sender = input.senderId?.trim();
  if (sender) {
    const channel = input.channel?.trim() || "direct";
    return `user:${channel}:${sender}`;
  }
  const session = input.sessionKey?.trim();
  if (session) {
    return `session:${session}`;
  }
  const agent = input.agentId?.trim();
  if (agent) {
    return `agent:${agent}`;
  }
  return "";
}
