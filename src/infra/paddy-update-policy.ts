// Paddy update policy. Paddy is a fork of OpenClaw with no published package of its own yet.
// The inherited updater installs the upstream `openclaw` npm package or moves a checkout to the
// upstream git remote, and either would replace Paddy with OpenClaw. Until Paddy publishes its own
// package, every mutating update path refuses, and startup update checks default to off.
import type { OpenClawConfig } from "../config/types.openclaw.js";

export const PADDY_SELF_UPDATE_UNAVAILABLE_REASON = "paddy-self-update-unavailable";

export const PADDY_SELF_UPDATE_UNAVAILABLE_MESSAGE =
  "Self-update is disabled: Paddy has no published package yet, and the inherited updater would " +
  'replace Paddy with upstream OpenClaw (npm package "openclaw" or the upstream git remote). ' +
  "Nothing was changed. Update Paddy manually from its own repository until a Paddy package is published.";

export class PaddySelfUpdateUnavailableError extends Error {
  readonly code = PADDY_SELF_UPDATE_UNAVAILABLE_REASON;

  constructor() {
    super(PADDY_SELF_UPDATE_UNAVAILABLE_MESSAGE);
    this.name = "PaddySelfUpdateUnavailableError";
  }
}

// Upstream updater tests exercise the inherited update machinery, which stays intact for when
// Paddy publishes a package. Only the shared test setup flips this; no env or config reaches it.
let selfUpdateAllowedForTest = false;

/** False until Paddy publishes its own package and the updater targets it. */
export function isPaddySelfUpdateAvailable(): boolean {
  return selfUpdateAllowedForTest;
}

/** Throws before any update work starts; call at every mutating update entry point. */
export function assertPaddySelfUpdateAvailable(): void {
  if (!isPaddySelfUpdateAvailable()) {
    throw new PaddySelfUpdateUnavailableError();
  }
}

export function setPaddySelfUpdateAllowedForTest(allowed: boolean): void {
  selfUpdateAllowedForTest = allowed;
}

/** `update.checkOnStart` is opt-in for Paddy (upstream defaults it to true). */
export function isUpdateCheckOnStartEnabled(config: Pick<OpenClawConfig, "update">): boolean {
  return config.update?.checkOnStart === true;
}

/** `nodeHost.autoUpdate.enabled` is opt-in for Paddy (upstream defaults it to true). */
export function isNodeHostAutoUpdateEnabled(config: Pick<OpenClawConfig, "nodeHost">): boolean {
  return config.nodeHost?.autoUpdate?.enabled === true;
}
