import { PRODUCT_NAME } from "../brand.js";
import type { ResolvedApprovalView } from "../infra/approval-view-model.types.js";

type SystemAgentResolvedView = Extract<ResolvedApprovalView, { approvalKind: "system-agent" }>;
type ApprovalTerminalOutcome =
  | ResolvedApprovalView["decision"]
  | "cancelled"
  | "applied"
  | "not-applied";

const TERMINAL_LABELS = {
  "allow-once": "Allowed once",
  "allow-always": "Allowed always",
  deny: "Denied",
  cancelled: "Cancelled",
  applied: "Applied",
  "not-applied": "Completion unconfirmed",
};

/** Label a recorded decision without implying that a system change was applied. */
export function formatApprovalDecisionLabel(decision: ResolvedApprovalView["decision"]): string {
  return TERMINAL_LABELS[decision];
}

function interpretApprovalTerminalOutcome(
  view: ResolvedApprovalView,
  precedence: "application" | "denial",
): ApprovalTerminalOutcome {
  if (view.approvalKind !== "system-agent") {
    return view.decision;
  }
  if (view.terminalStatus === "cancelled") {
    return "cancelled";
  }
  // Denied changes also publish not-applied. Preserve rich-label and prose precedence.
  return view.decision === "deny" &&
    (precedence === "denial" || view.applicationStatus === "not-applied")
    ? "deny"
    : (view.applicationStatus ?? view.decision);
}

/** Format a rich terminal label, retaining transport-specific decision spelling. */
export function formatChannelApprovalResolvedLabel(
  view: ResolvedApprovalView,
  formatDecision?: (decision: ResolvedApprovalView["decision"]) => string,
): string {
  const outcome = interpretApprovalTerminalOutcome(view, "application");
  return formatDecision && outcome === view.decision
    ? formatDecision(view.decision)
    : TERMINAL_LABELS[outcome];
}

/** Describe a system change using denial-first prose and a prepared operation summary. */
export function buildSystemAgentApprovalResolvedText(view: SystemAgentResolvedView): string {
  const outcome = interpretApprovalTerminalOutcome(view, "denial");
  return outcome === "cancelled"
    ? `⚠️ ${PRODUCT_NAME} change was cancelled because its run ended. No change was made. Retry.`
    : outcome === "deny"
      ? `❌ ${PRODUCT_NAME} change denied. No change was made.`
      : outcome === "applied"
        ? `✅ ${PRODUCT_NAME} change approved and applied: ${view.operationSummary}`
        : outcome === "not-applied"
          ? `⚠️ ${PRODUCT_NAME} change approved, but completion could not be confirmed. Check the current settings before retrying.`
          : `✅ ${PRODUCT_NAME} change approved. Applying: ${view.operationSummary}`;
}

/** Terminal copy for a system change approval that expired before a decision. */
export const SYSTEM_AGENT_APPROVAL_EXPIRED_TEXT = `⏱️ ${PRODUCT_NAME} change expired. No change was made.`;
