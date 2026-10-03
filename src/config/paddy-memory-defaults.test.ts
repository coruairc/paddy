// Paddy's two-key memory backstop: a fresh config names memory-hermes as the memory slot owner
// and sets its dreaming.enabled to false, so the inherited dreaming resolution never starts
// memory-core as a sidecar beside Hermes. Explicit user values are never overwritten.
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { applyLocalSetupWorkspaceConfig } from "../commands/onboard-config.js";
import {
  isMemoryDreamingSidecarExplicitlyEnabled,
  resolveMemoryDreamingConfig,
  resolveMemoryDreamingPluginConfig,
  resolveMemoryDreamingPluginId,
} from "../memory-host-sdk/dreaming.js";
import { validateJsonSchemaValue } from "../plugins/schema-validator.js";
import { createConfigIO } from "./io.factory.js";
import { applyPaddyMemoryDefaults, PADDY_MEMORY_PLUGIN_ID } from "./paddy-memory-defaults.js";
import type { OpenClawConfig } from "./types.openclaw.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

const PADDY_DEFAULT_MEMORY_PLUGINS = {
  slots: { memory: "memory-hermes" },
  entries: { "memory-hermes": { config: { dreaming: { enabled: false } } } },
};

function expectDreamingSidecarOff(cfg: OpenClawConfig) {
  // Both keys: main's loader (patch A, plugins/loader-shared.ts) starts the sidecar only on an
  // explicit dreaming.enabled: true, and the inherited resolvers also read Hermes's false.
  expect(isMemoryDreamingSidecarExplicitlyEnabled(cfg)).toBe(false);
  expect(resolveMemoryDreamingPluginId(cfg)).toBe("memory-hermes");
  expect(
    resolveMemoryDreamingConfig({ pluginConfig: resolveMemoryDreamingPluginConfig(cfg), cfg })
      .enabled,
  ).toBe(false);
}

const hermesManifest = JSON.parse(
  fs.readFileSync(
    path.resolve(import.meta.dirname, "../../extensions/memory-hermes/openclaw.plugin.json"),
    "utf8",
  ),
) as { configSchema: Parameters<typeof validateJsonSchemaValue>[0]["schema"] };

function validateHermesConfig(value: unknown) {
  return validateJsonSchemaValue({ schema: hermesManifest.configSchema, value, cache: false });
}

describe("memory-hermes configSchema", () => {
  it.each([
    { label: "dreaming disabled", value: { dreaming: { enabled: false } } },
    { label: "dreaming enabled", value: { dreaming: { enabled: true } } },
    { label: "empty dreaming block", value: { dreaming: {} } },
    { label: "empty config", value: {} },
    {
      label: "curatorModel with dreaming",
      value: { curatorModel: "a/b", dreaming: { enabled: false } },
    },
  ])("accepts $label", ({ value }) => {
    expect(validateHermesConfig(value).ok).toBe(true);
  });

  it.each([
    { label: "a string enabled", value: { dreaming: { enabled: "false" } } },
    { label: "a numeric enabled", value: { dreaming: { enabled: 0 } } },
    { label: "a non-object dreaming", value: { dreaming: false } },
    { label: "unknown dreaming keys", value: { dreaming: { enabled: false, frequency: "daily" } } },
    { label: "unknown top-level keys", value: { dreamingEnabled: false } },
  ])("rejects $label", ({ value }) => {
    expect(validateHermesConfig(value).ok).toBe(false);
  });
});

describe("applyPaddyMemoryDefaults", () => {
  it("writes both keys into an empty config", () => {
    const next = applyPaddyMemoryDefaults({});
    expect(next).toEqual({ plugins: PADDY_DEFAULT_MEMORY_PLUGINS });
    expect(PADDY_MEMORY_PLUGIN_ID).toBe("memory-hermes");
    expectDreamingSidecarOff(next);
  });

  it("documents the gap it backstops: with the slot unset, the inherited resolvers say memory-core (on)", () => {
    const unset: OpenClawConfig = {};
    // Main's loader (patch A) already keeps the sidecar off here; the defaults are the second key
    // if that check regresses or another caller uses the inherited resolvers.
    expect(isMemoryDreamingSidecarExplicitlyEnabled(unset)).toBe(false);
    expect(resolveMemoryDreamingPluginId(unset)).toBe("memory-core");
    expect(
      resolveMemoryDreamingConfig({ pluginConfig: resolveMemoryDreamingPluginConfig(unset) })
        .enabled,
    ).toBe(true);
  });

  it("keeps unrelated plugin settings and Hermes config fields", () => {
    const cfg: OpenClawConfig = {
      gateway: { mode: "local" },
      plugins: {
        allow: ["memory-hermes", "telegram"],
        slots: { contextEngine: "legacy" },
        entries: {
          telegram: { enabled: true },
          "memory-hermes": { enabled: true, config: { curatorModel: "a/b" } },
        },
      },
    };
    expect(applyPaddyMemoryDefaults(cfg)).toEqual({
      gateway: { mode: "local" },
      plugins: {
        allow: ["memory-hermes", "telegram"],
        slots: { contextEngine: "legacy", memory: "memory-hermes" },
        entries: {
          telegram: { enabled: true },
          "memory-hermes": {
            enabled: true,
            config: { curatorModel: "a/b", dreaming: { enabled: false } },
          },
        },
      },
    });
    expect(cfg.plugins?.slots).toEqual({ contextEngine: "legacy" });
  });

  it.each(["memory-core", "memory-lancedb", "none", ""])(
    "leaves an explicit memory slot %j and its entries unchanged",
    (slot) => {
      const cfg: OpenClawConfig = {
        plugins: {
          slots: { memory: slot },
          entries: { "memory-core": { config: { dreaming: { enabled: true } } } },
        },
      };
      expect(applyPaddyMemoryDefaults(cfg)).toBe(cfg);
    },
  );

  it("keeps an explicit Hermes dreaming.enabled and only fills the slot", () => {
    const next = applyPaddyMemoryDefaults({
      plugins: { entries: { "memory-hermes": { config: { dreaming: { enabled: true } } } } },
    });
    expect(next.plugins).toEqual({
      slots: { memory: "memory-hermes" },
      entries: { "memory-hermes": { config: { dreaming: { enabled: true } } } },
    });
  });

  it("fills dreaming.enabled when the slot already names memory-hermes", () => {
    const next = applyPaddyMemoryDefaults({
      plugins: { slots: { memory: "memory-hermes" }, entries: {} },
    });
    expect(next.plugins).toEqual(PADDY_DEFAULT_MEMORY_PLUGINS);
  });

  it("returns the same config when both keys are already set", () => {
    const cfg: OpenClawConfig = { plugins: structuredClone(PADDY_DEFAULT_MEMORY_PLUGINS) };
    expect(applyPaddyMemoryDefaults(cfg)).toBe(cfg);
  });

  it("leaves an unset slot alone when memory-core's dreaming.enabled is explicit", () => {
    const cfg: OpenClawConfig = {
      plugins: { entries: { "memory-core": { config: { dreaming: { enabled: true } } } } },
    };
    expect(applyPaddyMemoryDefaults(cfg)).toBe(cfg);
  });

  it("leaves a malformed Hermes dreaming block for validation to report", () => {
    const cfg = {
      plugins: { entries: { "memory-hermes": { config: { dreaming: "off" } } } },
    } as OpenClawConfig;
    expect(applyPaddyMemoryDefaults(cfg)).toBe(cfg);
  });
});

describe("Paddy default config carries the memory backstop", () => {
  function missingConfigIO() {
    const root = tempDirs.make("paddy-memory-defaults-");
    const configPath = path.join(root, "openclaw.json");
    const env: NodeJS.ProcessEnv = {
      HOME: root,
      USERPROFILE: root,
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_STATE_DIR: root,
      OPENCLAW_DISABLE_BUNDLED_PLUGINS: "1",
      VITEST: "true",
    };
    const io = createConfigIO({
      env,
      configPath,
      homedir: () => root,
      observe: false,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    return { io, configPath };
  }

  it("builds both keys when no config file exists (snapshot and load)", async () => {
    const { io, configPath } = missingConfigIO();
    const snapshot = await io.readConfigFileSnapshot();
    expect(snapshot.exists).toBe(false);
    expect(snapshot.valid).toBe(true);
    expect(snapshot.sourceConfig.plugins).toMatchObject(PADDY_DEFAULT_MEMORY_PLUGINS);
    expect(snapshot.runtimeConfig.plugins).toMatchObject(PADDY_DEFAULT_MEMORY_PLUGINS);
    expectDreamingSidecarOff(snapshot.runtimeConfig);

    const loaded = io.loadConfig();
    expect(loaded.plugins).toMatchObject(PADDY_DEFAULT_MEMORY_PLUGINS);
    expectDreamingSidecarOff(loaded);
    expect(fs.existsSync(configPath)).toBe(false);
  });

  it("writes both keys during local onboarding without overriding explicit choices", () => {
    const onboarded = applyLocalSetupWorkspaceConfig({}, "/tmp/paddy-workspace");
    expect(onboarded.plugins).toEqual(PADDY_DEFAULT_MEMORY_PLUGINS);
    expect(onboarded.gateway?.mode).toBe("local");
    expectDreamingSidecarOff(onboarded);

    const explicit: OpenClawConfig = {
      plugins: { slots: { memory: "memory-core" } },
    };
    expect(applyLocalSetupWorkspaceConfig(explicit, "/tmp/paddy-workspace").plugins).toEqual({
      slots: { memory: "memory-core" },
    });
  });
});
