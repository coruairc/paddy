import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { resetConfigRuntimeState } from "../config/config.js";
import * as packageRoot from "../infra/openclaw-root.js";
import * as pluginMetadata from "../plugins/current-plugin-metadata-state.js";
import { createPluginMetadataSnapshotFixture } from "../plugins/plugin-metadata.test-support.js";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import { createDeferredCore } from "../shared/deferred.js";
import { createTestGatewayScheduler } from "../test-utils/gateway-scheduler-clock.js";
import * as version from "../version.js";
import { createDesktopSessionRegistry } from "./desktop/session-registry.js";
import {
  createGatewayWorkerEnvironmentRuntime,
  loadGatewayWorkerEnvironmentStartupState,
} from "./server-worker-environment-startup.js";
import { withGatewayWorkerEnvironmentStartupState } from "./server-worker-environment-startup.state.test-support.js";
import type { WorkerInstallationArtifact } from "./worker-environments/bundle.js";
import {
  createNodeBootstrapArtifactProvider,
  type NodeBootstrapArtifact,
} from "./worker-environments/node-bootstrap-artifact.js";
import { createWorkerBundleProducer } from "./worker-environments/runtime.js";
import * as workerServices from "./worker-environments/service.js";
import type { WorkerEnvironmentServiceOptions } from "./worker-environments/service.types.js";

vi.mock("./worker-environments/node-bootstrap-artifact.js", () => ({
  createNodeBootstrapArtifactProvider: vi.fn(),
}));
vi.mock("./worker-environments/runtime.js", () => ({
  createWorkerBundleProducer: vi.fn(),
}));

const bootstrapArtifact: NodeBootstrapArtifact = {
  tarballPath: "/synthetic/node-runtime.tgz",
  tarballSha256: "a".repeat(64),
  tarballBytes: 100,
  openclawVersion: "2026.9.26",
  buildId: "synthetic-build",
  enabledPluginIds: [],
};
const bundleArtifact: Extract<WorkerInstallationArtifact, { install: "bundle" }> = {
  install: "bundle",
  bundleHash: "b".repeat(64),
  tarballSha256: "c".repeat(64),
  tarballPath: "/synthetic/worker-bundle.tgz",
  tarballBytes: 100,
  openclawVersion: "2026.9.26",
  protocolFeatures: ["worker-heartbeat-v1"],
};
const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(() => {
    vi.restoreAllMocks();
    resetConfigRuntimeState();
    cleanup();
  }),
);

async function withArtifactRuntime(
  run: (fixture: { options: WorkerEnvironmentServiceOptions }) => Promise<void>,
) {
  const stateDir = tempDirs.make("openclaw-worker-artifact-overlap-");
  await withGatewayWorkerEnvironmentStartupState(stateDir, async () => {
    vi.spyOn(pluginMetadata, "getGatewayPluginMetadataSnapshot").mockReturnValue(
      createPluginMetadataSnapshotFixture(),
    );
    vi.spyOn(packageRoot, "resolveOpenClawPackageRootSync").mockReturnValue("/synthetic/openclaw");
    vi.spyOn(version, "resolveRuntimeServiceBuildId").mockReturnValue("synthetic-build");
    const createService = workerServices.createWorkerEnvironmentService;
    let options: WorkerEnvironmentServiceOptions | undefined;
    vi.spyOn(workerServices, "createWorkerEnvironmentService").mockImplementation((input) => {
      options = input;
      return createService(input);
    });
    const startup = await loadGatewayWorkerEnvironmentStartupState();
    const registry = createEmptyPluginRegistry();
    const runtime = await createGatewayWorkerEnvironmentRuntime({
      scheduler: createTestGatewayScheduler(),
      getPluginRegistry: () => registry,
      getPortalRuntime: () => undefined,
      resolveGatewayContext: () => undefined,
      desktopSessionRegistry: createDesktopSessionRegistry(),
      startup,
      log: { child: () => ({ warn: () => {} }) },
    });
    const service = runtime.workerEnvironmentService;
    if (!options || !service) {
      throw new Error("Worker artifact runtime was not composed");
    }
    try {
      await run({ options });
    } finally {
      await service.stop();
    }
  });
}

describe("Gateway cold artifact preparation", () => {
  it.each(["success", "bootstrap failure", "bundle failure", "cancellation"] as const)(
    "overlaps both artifacts and retains their consumer lifetime through %s",
    async (outcome) => {
      const bootstrap = createDeferredCore<NodeBootstrapArtifact>();
      const bundle = createDeferredCore<typeof bundleArtifact>();
      const prepareBootstrap = vi.fn((_signal?: AbortSignal) => bootstrap.promise);
      const prepareBundle = vi.fn(() => bundle.promise);
      vi.mocked(createNodeBootstrapArtifactProvider).mockReturnValue({
        prepare: prepareBootstrap,
        close: async () => {},
      });
      const producer = {
        prepare: prepareBundle,
        prune: async () => {},
        close: async () => {},
      };
      vi.mocked(createWorkerBundleProducer).mockReturnValue(producer);

      await withArtifactRuntime(async ({ options }) => {
        const controller = new AbortController();
        const failure = new Error(outcome);
        const preparing = options.prepareNodeArtifacts!({}, controller.signal);
        const settled = vi.fn();
        void preparing.then(settled, settled);
        try {
          await vi.dynamicImportSettled();
          expect(prepareBootstrap).toHaveBeenCalledOnce();
          expect(prepareBundle).toHaveBeenCalledOnce();
          const signal = prepareBootstrap.mock.calls[0]?.[0];
          expect(signal).toBeInstanceOf(AbortSignal);
          expect(signal?.aborted).toBe(false);

          if (outcome === "bootstrap failure") {
            bootstrap.reject(failure);
          } else if (outcome === "bundle failure") {
            bundle.reject(failure);
          } else if (outcome === "cancellation") {
            bootstrap.resolve(bootstrapArtifact);
            await vi.dynamicImportSettled();
            controller.abort(failure);
          } else {
            bootstrap.resolve(bootstrapArtifact);
          }
          await vi.dynamicImportSettled();
          expect(settled).not.toHaveBeenCalled();
          expect(signal?.aborted).toBe(outcome === "cancellation");

          bootstrap.resolve(bootstrapArtifact);
          bundle.resolve(bundleArtifact);
          if (outcome === "success") {
            await expect(preparing).resolves.toMatchObject({
              artifacts: {
                nodeBootstrapSha256: bootstrapArtifact.tarballSha256,
                workerBundleHash: bundleArtifact.bundleHash,
                workerArchiveSha256: bundleArtifact.tarballSha256,
              },
            });
          } else if (outcome === "cancellation") {
            await expect(preparing).rejects.toThrow();
          } else {
            await expect(preparing).rejects.toBe(failure);
          }
          expect(signal?.aborted).toBe(true);
        } finally {
          bootstrap.resolve(bootstrapArtifact);
          bundle.resolve(bundleArtifact);
          await preparing.catch(() => undefined);
        }
      });
    },
  );
});
