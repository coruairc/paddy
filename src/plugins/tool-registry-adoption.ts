import { isDeepStrictEqual } from "node:util";
import { projectConfigOntoRuntimeSourceSnapshot } from "../config/runtime-source-projection.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { isPluginRecordActive, isPluginRegistryRetired } from "./registry-lifecycle.js";
import type { PluginRegistry, PluginToolRegistration } from "./registry-types.js";
import { getPluginRuntimeLoadContext } from "./runtime/load-context.js";

/** Tools borrow the Gateway instance whose services prepared their runtime. */
export function adoptRuntimeToolRegistrations(
  target: PluginRegistry,
  runtime: PluginRegistry,
  config: OpenClawConfig,
): PluginRegistry {
  const preparedConfig = getPluginRuntimeLoadContext(runtime)?.activationSourceConfig;
  if (!preparedConfig || isPluginRegistryRetired(target) || isPluginRegistryRetired(runtime)) {
    return target;
  }
  const sourceConfig = projectConfigOntoRuntimeSourceSnapshot(config);
  const replacements = new Map<PluginToolRegistration, PluginToolRegistration>();
  for (const pluginId of new Set(target.tools.map((entry) => entry.pluginId))) {
    const localRecord = target.plugins.find((record) => record.id === pluginId);
    const runtimeRecord = runtime.plugins.find((record) => record.id === pluginId);
    if (
      localRecord?.status !== "loaded" ||
      !localRecord.enabled ||
      !runtimeRecord ||
      localRecord.source !== runtimeRecord.source ||
      !isPluginRecordActive(runtime, runtimeRecord) ||
      !isDeepStrictEqual(
        sourceConfig.plugins?.entries?.[pluginId]?.config,
        preparedConfig.plugins?.entries?.[pluginId]?.config,
      )
    ) {
      continue;
    }
    const owned = runtime.tools.filter((entry) => entry.pluginId === pluginId);
    for (const local of target.tools.filter((entry) => entry.pluginId === pluginId)) {
      const names = new Set(local.names);
      if (names.size === 0) {
        continue;
      }
      const replacement = owned.find((entry) => {
        const ownedNames = new Set(entry.names);
        return (
          entry.optional === local.optional &&
          ownedNames.size === names.size &&
          [...names].every((name) => ownedNames.has(name))
        );
      });
      if (replacement && replacement !== local) {
        replacements.set(local, replacement);
      }
    }
  }
  return replacements.size === 0
    ? target
    : { ...target, tools: target.tools.map((entry) => replacements.get(entry) ?? entry) };
}
