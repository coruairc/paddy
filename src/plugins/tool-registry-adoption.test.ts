import { expect, it } from "vitest";
import { createPluginRecord } from "./loader-records.js";
import { createEmptyPluginRegistry } from "./registry-empty.js";
import { markPluginRegistryActive, markPluginRegistryRetired } from "./registry-lifecycle.js";
import type { PluginToolRegistration } from "./registry-types.js";
import { setPluginRuntimeLoadContext } from "./runtime/load-context.js";
import { adoptRuntimeToolRegistrations } from "./tool-registry-adoption.js";

it("keeps discovery tools when the Gateway source, config, or lifetime does not match", () => {
  const config = { plugins: { entries: { owner: { config: { account: "original" } } } } };
  const runtime = createEmptyPluginRegistry();
  const target = createEmptyPluginRegistry();
  const record = createPluginRecord({
    id: "owner",
    source: "/synthetic/plugin.ts",
    origin: "global",
    enabled: true,
    configSchema: false,
  });
  const tool: PluginToolRegistration = {
    pluginId: record.id,
    source: record.source,
    factory: () => null,
    names: ["owner_tool"],
    optional: false,
  };
  runtime.plugins.push(record);
  runtime.tools.push(tool);
  const localRecord = { ...record };
  target.plugins.push(localRecord);
  const localTool = { ...tool, factory: () => null };
  target.tools.push(localTool);
  setPluginRuntimeLoadContext(runtime, {
    rawConfig: config,
    config,
    activationSourceConfig: config,
    autoEnabledReasons: {},
    workspaceDir: "/synthetic",
    env: process.env,
    logger: { info() {}, warn() {}, error() {} },
  });
  markPluginRegistryActive(runtime);
  try {
    expect(adoptRuntimeToolRegistrations(target, runtime, config).tools).toEqual([tool]);
    expect(target.tools).toEqual([localTool]);
    expect(
      adoptRuntimeToolRegistrations(target, runtime, {
        plugins: { entries: { owner: { config: { account: "other" } } } },
      }),
    ).toBe(target);
    localRecord.source = "/workspace/shadow.ts";
    expect(adoptRuntimeToolRegistrations(target, runtime, config)).toBe(target);
    localRecord.source = record.source;
    localRecord.enabled = false;
    expect(adoptRuntimeToolRegistrations(target, runtime, config)).toBe(target);
    localRecord.enabled = true;
    markPluginRegistryRetired(runtime);
    expect(adoptRuntimeToolRegistrations(target, runtime, config)).toBe(target);
  } finally {
    markPluginRegistryRetired(runtime);
  }
});
