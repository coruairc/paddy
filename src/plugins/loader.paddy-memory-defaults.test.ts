// Paddy's default config (memory-hermes slot + dreaming.enabled: false) keeps memory-core's
// dreaming sidecar off with the inherited loader as it is on main, without Frontend's loader
// patch. The control case shows the gap that backstop closes: an unset slot still starts it.
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

  it("control: with the memory slot unset, the inherited loader still starts memory-core", () => {
    setupBundledDreamingMemoryPlugins({
      selectedId: "memory-hermes",
      coreBody: memoryPluginBody("memory-core"),
    });

    const registry = loadOpenClawPlugins({ cache: false, config: {} });

    const core = registry.plugins.find((entry) => entry.id === "memory-core");
    const hermes = registry.plugins.find((entry) => entry.id === "memory-hermes");
    expect(hermes?.memorySlotSelected).toBe(true);
    expect(core?.status).toBe("loaded");
  });
});
