// Paddy's default config (memory-hermes slot + dreaming.enabled: false) keeps memory-core's
// dreaming sidecar off with main's loader (patch A from PR #3: a non-owner sidecar starts only on
// an explicit dreaming.enabled: true). The opt-in control proves the sidecar path is live, so the
// default-config case cannot pass vacuously.
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { applyPaddyMemoryDefaults } from "../config/paddy-memory-defaults.js";
import { loadOpenClawPlugins } from "./loader.js";
import {
  globalAfterAll1,
  globalAfterEach0,
  memoryPluginBody,
  setupBundledDreamingMemoryPlugins,
} from "./loader.test-harness.js";

afterEach(globalAfterEach0);
afterAll(globalAfterAll1);

describe("Paddy default memory config at plugin load", () => {
  it("does not start memory-core as a dreaming sidecar beside memory-hermes", () => {
    setupBundledDreamingMemoryPlugins({
      selectedId: "memory-hermes",
      coreBody: `throw new Error("memory-core must not load with Paddy's default memory config");`,
    });

    const registry = loadOpenClawPlugins({ cache: false, config: applyPaddyMemoryDefaults({}) });

    const core = registry.plugins.find((entry) => entry.id === "memory-core");
    const hermes = registry.plugins.find((entry) => entry.id === "memory-hermes");
    expect(hermes?.status).toBe("loaded");
    expect(hermes?.memorySlotSelected).toBe(true);
    expect(core?.status).not.toBe("loaded");
    expect(core?.status).not.toBe("error");
  });

  it("control: an explicit Hermes dreaming.enabled: true still starts memory-core as the sidecar", () => {
    setupBundledDreamingMemoryPlugins({
      selectedId: "memory-hermes",
      coreBody: memoryPluginBody("memory-core"),
    });

    const registry = loadOpenClawPlugins({
      cache: false,
      config: applyPaddyMemoryDefaults({
        plugins: { entries: { "memory-hermes": { config: { dreaming: { enabled: true } } } } },
      }),
    });

    const core = registry.plugins.find((entry) => entry.id === "memory-core");
    const hermes = registry.plugins.find((entry) => entry.id === "memory-hermes");
    expect(hermes?.memorySlotSelected).toBe(true);
    expect(core?.status).toBe("loaded");
  });

  it("with main's patch A, an unset memory slot does not start memory-core either", () => {
    setupBundledDreamingMemoryPlugins({
      selectedId: "memory-hermes",
      coreBody: `throw new Error("memory-core must not load without an explicit dreaming opt-in");`,
    });

    // No `plugins.slots.memory` and no dreaming setting anywhere. The bare memory-hermes entry is
    // required: under VITEST, applyTestPluginDefaults turns plugins off and forces the memory slot
    // to "none" unless a memory slot or memory-hermes entry is present, which would make this case
    // pass without the sidecar decision ever running.
    const registry = loadOpenClawPlugins({
      cache: false,
      config: { plugins: { entries: { "memory-hermes": { enabled: true } } } },
    });

    // The slot resolves to the default owner, so the sidecar decision really ran...
    const hermes = registry.plugins.find((entry) => entry.id === "memory-hermes");
    expect(hermes?.status).toBe("loaded");
    expect(hermes?.memorySlotSelected).toBe(true);
    // ...and memory-core is neither loaded nor attempted (its body throws).
    const core = registry.plugins.find((entry) => entry.id === "memory-core");
    expect(core?.status).not.toBe("loaded");
    expect(core?.status).not.toBe("error");
  });
});
