/**
 * Phase D FE: Hermes memory UX defaults (pure, client-safe).
 *
 * MemoryStore lifecycle is the default path for BOTH runtimes
 * (openclaw.runtime=paddy | openclaw). OpenClaw only owns the model HTTP
 * hop — Paddy still owns MemoryStore, ranked recall, curatorPass, syncTurn.
 * Hosted demo never pretends OpenClaw loopback.
 */

export type AgentRuntimeLabel = "paddy" | "openclaw";

/** Hermes MemoryStore lifecycle shown in Memory panel / inspector. */
export const HERMES_MEMORY_LIFECYCLE = [
  "initialize",
  "prefetch",
  "syncTurn",
  "curatorPass",
  "shutdown",
] as const;

export type HermesMemoryLifecycleStep = (typeof HERMES_MEMORY_LIFECYCLE)[number];

export type HermesMemoryPathStatus = {
  /** Effective model runtime (hosted demo always paddy). */
  runtime: AgentRuntimeLabel;
  /** Always Hermes — never "OpenClaw file memory". */
  memoryPath: "hermes-memory-store";
  title: string;
  blurb: string;
  lifecycleLabel: string;
  /** True when model runtime is openclaw but memory stays in Paddy. */
  openclawModelOnly: boolean;
  hostedDemo: boolean;
};

export type SyncConflictPayload = {
  ok: false;
  error: "sync_conflict";
  expected?: number;
  actual?: number;
};

/**
 * Hosted shared demo: no PADDY_CLI_TOKEN → force paddy (SuperGrok + Hermes).
 * Same gate as persistBrainKeys / FE Phase B helpers.
 */
export function isHostedPaddyDemoEnv(
  env: { PADDY_CLI_TOKEN?: string | undefined } = typeof process !== "undefined"
    ? process.env
    : {},
): boolean {
  return !(env.PADDY_CLI_TOKEN ?? "").trim();
}

/** Effective runtime for UX copy — hosted demo never shows openclaw as active. */
export function resolveEffectiveRuntimeForMemoryUx(opts: {
  configured?: string | null;
  hostedDemo: boolean;
}): AgentRuntimeLabel {
  if (opts.hostedDemo) return "paddy";
  return opts.configured === "openclaw" ? "openclaw" : "paddy";
}

/**
 * Runtime-agnostic Hermes status for Memory panel / inspector.
 * OpenClaw runtime still surfaces MemoryStore + curator — not file memory.
 */
export function describeHermesMemoryPath(opts: {
  configuredRuntime?: string | null;
  hostedDemo?: boolean;
}): HermesMemoryPathStatus {
  const hostedDemo = Boolean(opts.hostedDemo);
  const runtime = resolveEffectiveRuntimeForMemoryUx({
    configured: opts.configuredRuntime,
    hostedDemo,
  });
  const openclawModelOnly = runtime === "openclaw";
  const lifecycleLabel = HERMES_MEMORY_LIFECYCLE.join(" → ");
  if (openclawModelOnly) {
    return {
      runtime,
      memoryPath: "hermes-memory-store",
      title: "Hermes MemoryStore (default)",
      blurb:
        "OpenClaw runs the model hop only. Memory stays on Paddy: MemoryStore initialize → prefetch / versioned syncTurn → curatorPass after every turn (not OpenClaw file memory).",
      lifecycleLabel,
      openclawModelOnly: true,
      hostedDemo,
    };
  }
  return {
    runtime,
    memoryPath: "hermes-memory-store",
    title: "Hermes MemoryStore (default)",
    blurb: hostedDemo
      ? "Hosted demo: SuperGrok + Hermes memory. MemoryStore is ON for every turn (prefetch → ranked recall → curatorPass → syncTurn)."
      : "Paddy brain + Hermes memory. MemoryStore is the default path: initialize → prefetch / syncTurn (versioned) → curatorPass after every turn → shutdown.",
    lifecycleLabel,
    openclawModelOnly: false,
    hostedDemo,
  };
}

export function isSyncConflictResult(res: unknown): res is SyncConflictPayload {
  if (!res || typeof res !== "object") return false;
  const r = res as { ok?: unknown; error?: unknown };
  return r.ok === false && r.error === "sync_conflict";
}

/** Recoverable UX copy for SyncConflictError / HTTP 409 — never silent-fail. */
export function formatSyncConflictMessage(res: {
  expected?: number;
  actual?: number;
}): string {
  const exp = typeof res.expected === "number" ? String(res.expected) : "?";
  const act = typeof res.actual === "number" ? String(res.actual) : "?";
  return `Memory sync conflict (revision ${exp} → ${act}). Reloaded the latest workspace — retry your edit.`;
}

/**
 * Parse openclaw.runtime from redacted getConfig payload (never trust token).
 */
export function configuredRuntimeFromConfig(config: unknown): string | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const oc = (config as { openclaw?: unknown }).openclaw;
  if (!oc || typeof oc !== "object" || Array.isArray(oc)) return null;
  const rt = (oc as { runtime?: unknown }).runtime;
  return typeof rt === "string" && rt.trim() ? rt.trim() : null;
}
