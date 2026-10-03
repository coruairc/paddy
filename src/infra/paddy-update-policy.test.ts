// Paddy has no published package yet: every mutating update path must refuse before any work,
// and startup update checks plus node-host auto-update must default to off.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateCommand } from "../cli/update-cli/update-command.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { runGlobalPackageUpdateSteps } from "./package-update-steps.js";
import {
  assertPaddySelfUpdateAvailable,
  isNodeHostAutoUpdateEnabled,
  isPaddySelfUpdateAvailable,
  isUpdateCheckOnStartEnabled,
  PADDY_SELF_UPDATE_UNAVAILABLE_MESSAGE,
  PADDY_SELF_UPDATE_UNAVAILABLE_REASON,
  PaddySelfUpdateUnavailableError,
  setPaddySelfUpdateAllowedForTest,
} from "./paddy-update-policy.js";
import { updateGitCheckout } from "./update-runner-git.js";
import { runAutoUpdateCommand } from "./update-startup-auto-run.js";

describe("Paddy update policy defaults", () => {
  it("ships with self-update unavailable", async () => {
    // test/setup.shared.ts opts the shared module in for upstream suites; a fresh module
    // instance shows the shipped default.
    vi.resetModules();
    const fresh = await import("./paddy-update-policy.js");
    expect(fresh.isPaddySelfUpdateAvailable()).toBe(false);
    expect(() => fresh.assertPaddySelfUpdateAvailable()).toThrow(
      fresh.PaddySelfUpdateUnavailableError,
    );
  });

  it.each([
    { config: {}, expected: false },
    { config: { update: {} }, expected: false },
    { config: { update: { checkOnStart: false } }, expected: false },
    { config: { update: { checkOnStart: true } }, expected: true },
  ] satisfies Array<{ config: OpenClawConfig; expected: boolean }>)(
    "treats update.checkOnStart as opt-in ($config)",
    ({ config, expected }) => {
      expect(isUpdateCheckOnStartEnabled(config)).toBe(expected);
    },
  );

  it.each([
    { config: {}, expected: false },
    { config: { nodeHost: {} }, expected: false },
    { config: { nodeHost: { autoUpdate: {} } }, expected: false },
    { config: { nodeHost: { autoUpdate: { enabled: false } } }, expected: false },
    { config: { nodeHost: { autoUpdate: { enabled: true } } }, expected: true },
  ] satisfies Array<{ config: OpenClawConfig; expected: boolean }>)(
    "treats nodeHost.autoUpdate.enabled as opt-in ($config)",
    ({ config, expected }) => {
      expect(isNodeHostAutoUpdateEnabled(config)).toBe(expected);
    },
  );
});

describe("Paddy self-update refusal guard", () => {
  beforeEach(() => {
    setPaddySelfUpdateAllowedForTest(false);
  });

  afterEach(() => {
    setPaddySelfUpdateAllowedForTest(true);
  });

  it("names the reason and says nothing was changed", () => {
    expect(isPaddySelfUpdateAvailable()).toBe(false);
    let thrown: unknown;
    try {
      assertPaddySelfUpdateAvailable();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PaddySelfUpdateUnavailableError);
    expect(thrown).toMatchObject({
      code: PADDY_SELF_UPDATE_UNAVAILABLE_REASON,
      message: PADDY_SELF_UPDATE_UNAVAILABLE_MESSAGE,
    });
    expect(PADDY_SELF_UPDATE_UNAVAILABLE_MESSAGE).toContain("Nothing was changed");
    expect(PADDY_SELF_UPDATE_UNAVAILABLE_MESSAGE).toContain('npm package "openclaw"');
  });

  it("refuses a global package install before running any command", async () => {
    const runCommand = vi.fn();
    const runStep = vi.fn();
    await expect(
      runGlobalPackageUpdateSteps({
        installTarget: { manager: "npm" },
        installSpec: "openclaw@latest",
        packageName: "openclaw",
        runCommand,
        runStep,
        timeoutMs: 1_000,
      } as never),
    ).rejects.toBeInstanceOf(PaddySelfUpdateUnavailableError);
    expect(runCommand).not.toHaveBeenCalled();
    expect(runStep).not.toHaveBeenCalled();
  });

  it("refuses a git checkout update before fetching", async () => {
    const runCommand = vi.fn();
    const inspectGitTarget = vi.fn();
    const beforeGitMutation = vi.fn();
    await expect(
      updateGitCheckout({
        opts: { inspectGitTarget, beforeGitMutation, validateCandidate: vi.fn() },
        gitRoot: "/synthetic/paddy-checkout",
        runCommand,
        defaultCommandEnv: undefined,
        timeoutMs: 1_000,
        startedAt: Date.now(),
      } as never),
    ).rejects.toBeInstanceOf(PaddySelfUpdateUnavailableError);
    expect(runCommand).not.toHaveBeenCalled();
    expect(inspectGitTarget).not.toHaveBeenCalled();
    expect(beforeGitMutation).not.toHaveBeenCalled();
  });

  it("skips Gateway auto-update runs with the Paddy reason", async () => {
    const log = { info: vi.fn() };
    const result = await runAutoUpdateCommand(
      {
        runId: "paddy-refusal-run",
        channel: "stable",
        mode: "npm",
        timeoutMs: 1_000,
        restartDrainTimeoutMs: undefined,
        root: "/synthetic/paddy",
      },
      log,
    );
    expect(result).toMatchObject({
      status: "failed",
      message: PADDY_SELF_UPDATE_UNAVAILABLE_MESSAGE,
      result: {
        status: "skipped",
        reason: PADDY_SELF_UPDATE_UNAVAILABLE_REASON,
        steps: [],
      },
    });
  });

  it("refuses the update command before opening a run", async () => {
    await expect(updateCommand({ json: true })).rejects.toBeInstanceOf(
      PaddySelfUpdateUnavailableError,
    );
  });
});
