// Paddy refuses Gateway-initiated self-update until it publishes its own package.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PADDY_SELF_UPDATE_UNAVAILABLE_MESSAGE,
  setPaddySelfUpdateAllowedForTest,
} from "../../infra/paddy-update-policy.js";
import { listUpdateRuns } from "../../infra/update-run-ledger.js";
import {
  invokeUpdateRun,
  mockGlobalInstallSurface,
  recordLatestUpdateRestartSentinelMock,
  scheduleGatewayRestartMock,
  startManagedServiceUpdateHandoffMock,
} from "./update.test-harness.js";

describe("update.run Paddy refusal", () => {
  beforeEach(() => {
    setPaddySelfUpdateAllowedForTest(false);
  });

  afterEach(() => {
    setPaddySelfUpdateAllowedForTest(true);
  });

  it("responds UNAVAILABLE without recording a run, sentinel, handoff, or restart", async () => {
    mockGlobalInstallSurface();
    const runsBefore = listUpdateRuns().length;
    const respond = vi.fn();

    await invokeUpdateRun({}, respond);

    expect(respond).toHaveBeenCalledExactlyOnceWith(
      false,
      undefined,
      expect.objectContaining({
        code: "UNAVAILABLE",
        message: PADDY_SELF_UPDATE_UNAVAILABLE_MESSAGE,
      }),
    );
    expect(listUpdateRuns()).toHaveLength(runsBefore);
    expect(startManagedServiceUpdateHandoffMock).not.toHaveBeenCalled();
    expect(recordLatestUpdateRestartSentinelMock).not.toHaveBeenCalled();
    expect(scheduleGatewayRestartMock).not.toHaveBeenCalled();
  });
});
