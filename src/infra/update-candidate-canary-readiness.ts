import { setTimeout as sleep } from "node:timers/promises";
import { isRecord } from "@openclaw/normalization-core/record-coerce";
import {
  redactSupportDiagnosticLine,
  redactSupportString,
  type SupportRedactionContext,
} from "../logging/diagnostic-support-redaction.js";
import { scheduleAbsoluteDeadline } from "../utils/absolute-deadline.js";
import { formatErrorMessageWithCode, toErrorObject } from "./errors.js";
import {
  getActiveManagedProxyLoopbackMode,
  getActiveManagedProxyUrl,
} from "./net/proxy/active-proxy-state.js";
import { registerManagedProxyGatewayLoopbackBypass } from "./net/proxy/proxy-lifecycle.js";
import type { UpdateCanaryStartupProgress } from "./update-candidate-canary-progress.js";
import { createUpdateFailureFact, type UpdateFailureFact } from "./update-failure-facts.js";

/** Poll candidate control-plane endpoints under the existing managed loopback policy. */
export async function waitForUpdateCandidateReadiness(
  params: SupportRedactionContext & {
    port: number;
    workDeadline: number;
    started: number;
    signal?: AbortSignal;
    processExitSignal: AbortSignal;
    assertCurrent?: () => void;
    hasExited: () => boolean;
    getExitReason: () => string | undefined;
    getStartupProgress: () => UpdateCanaryStartupProgress | undefined;
    onWarning: (message: string) => void;
    onEndpoint: (endpoint: "startupz" | "readyz") => void;
    capture: (message: string) => void;
  },
): Promise<{ fact: UpdateFailureFact; message: string } | undefined> {
  const deadline = new AbortController();
  const stallBudgetMs = Math.max(1, params.workDeadline - Date.now());
  let workDeadline = params.workDeadline;
  let observedProgress: UpdateCanaryStartupProgress | undefined;
  let lastProgress: UpdateCanaryStartupProgress | undefined;
  let deadlineFailure: Error | undefined;
  let warned = false;
  const recordProgress = (progress: UpdateCanaryStartupProgress) => {
    if (!lastProgress || progress.completedAt >= lastProgress.completedAt) {
      lastProgress = progress;
      workDeadline = Math.max(workDeadline, progress.completedAt + stallBudgetMs);
    }
  };
  const refreshDeadline = () => {
    if (deadline.signal.aborted) {
      return;
    }
    const progress = params.getStartupProgress();
    if (progress && progress !== observedProgress) {
      observedProgress = progress;
      recordProgress(progress);
    }
    if (!warned && Date.now() >= params.workDeadline && Date.now() < workDeadline) {
      warned = true;
      params.onWarning(
        `Candidate Gateway startup is still progressing after ${Date.now() - params.started}ms; continuing to wait while startup milestones advance.`,
      );
    }
  };
  let cancelDeadline = () => {};
  const checkDeadline = () => {
    try {
      params.signal?.throwIfAborted();
      params.assertCurrent?.();
      refreshDeadline();
      if (Date.now() >= workDeadline) {
        deadline.abort();
      } else {
        cancelDeadline = scheduleAbsoluteDeadline(workDeadline, checkDeadline);
      }
    } catch (error) {
      deadlineFailure = toErrorObject(error, "Candidate startup wait failed");
      deadline.abort();
    }
  };
  cancelDeadline = scheduleAbsoluteDeadline(workDeadline, checkDeadline);
  const signal = AbortSignal.any([
    deadline.signal,
    params.processExitSignal,
    ...(params.signal ? [params.signal] : []),
  ]);
  const assertRunning = () => {
    if (deadlineFailure !== undefined) {
      throw deadlineFailure;
    }
    params.signal?.throwIfAborted();
    params.assertCurrent?.();
    if (params.hasExited()) {
      throw new Error(params.getExitReason() ?? "The updated Gateway exited before it was ready");
    }
  };
  try {
    for (const endpoint of ["startupz", "readyz"] as const) {
      params.onEndpoint(endpoint);
      const url = `http://127.0.0.1:${params.port}/${endpoint}`;
      const releaseBypass = registerManagedProxyGatewayLoopbackBypass(url);
      const proxy =
        getActiveManagedProxyLoopbackMode() === "proxy" ? getActiveManagedProxyUrl() : undefined;
      let failure: { fact: UpdateFailureFact; message: string } | undefined;
      let candidatePending = false;
      try {
        while (true) {
          assertRunning();
          refreshDeadline();
          if (Date.now() >= workDeadline) {
            if (lastProgress && (candidatePending || !proxy)) {
              throw new Error(
                `Candidate Gateway startup stalled for ${stallBudgetMs}ms after ${lastProgress.milestone}`,
              );
            }
            if (!failure) {
              throw new Error("Update validation deadline exceeded");
            }
            params.capture(failure.message);
            return failure;
          }
          let outcome = "";
          let ready = false;
          try {
            const response = await fetch(url, { signal });
            outcome = `HTTP ${response.status}`;
            if (response.status === 200 || response.status === 503) {
              const payload: unknown = await response.json();
              ready =
                response.status === 200 &&
                (endpoint === "readyz" || (isRecord(payload) && payload.status === "started"));
              candidatePending =
                isRecord(payload) &&
                (endpoint === "startupz" ? payload.status === "starting" : payload.ready === false);
              outcome += " (startup response not ready within the validation budget)";
            } else {
              candidatePending = false;
              await response.body?.cancel();
            }
          } catch (error) {
            if (!deadline.signal.aborted) {
              candidatePending = false;
            }
            outcome = `${outcome ? `${outcome}: ` : ""}${formatErrorMessageWithCode(error)}`;
          }
          assertRunning();
          refreshDeadline();
          if (ready && Date.now() < workDeadline) {
            params.capture(
              `${endpoint}: ${endpoint === "startupz" ? "started" : "ready"} (${Date.now() - params.started}ms)`,
            );
            recordProgress({ milestone: endpoint, completedAt: Date.now() });
            break;
          }
          // Keep the last observed cause when the common deadline aborts a later poll.
          if (!deadline.signal.aborted || !failure) {
            const detail = redactSupportDiagnosticLine(outcome, params);
            const nextStep = "Check Gateway logs and proxy.loopbackMode; rerun openclaw update.";
            failure = {
              message: redactSupportString(
                `Readiness probe ${url} failed: ${detail}${proxy ? ` (via proxy ${proxy.origin})` : ""}. ${nextStep}`,
                params,
              ),
              fact: createUpdateFailureFact(
                {
                  check: endpoint,
                  code: "candidate-readiness-probe-failed",
                  message: `Readiness probe ${endpoint} failed: ${detail}. ${nextStep}`,
                },
                params.env,
              ),
            };
          }
          if (Date.now() >= workDeadline) {
            continue;
          }
          await sleep(Math.min(100, workDeadline - Date.now()), undefined, {
            signal: params.signal,
          });
        }
      } finally {
        releaseBypass?.();
      }
    }
    return undefined;
  } finally {
    cancelDeadline();
  }
}
