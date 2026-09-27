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
  const replacements = new Map<string, PluginToolRegistration[]>();
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
    const local = target.tools.filter((entry) => entry.pluginId === pluginId);
    if (
      owned.length > 0 &&
      (owned.length !== local.length || owned.some((entry, index) => entry !== local[index]))
    ) {
      replacements.set(pluginId, owned);
    }
  }
  if (replacements.size === 0) {
    return target;
  }
  // Keep target plugin precedence and the donor's registration order within each plugin.
  const emitted = new Set<string>();
  const tools = target.tools.flatMap((entry) => {
    const replacement = replacements.get(entry.pluginId);
    if (!replacement) {
      return [entry];
    }
    if (emitted.has(entry.pluginId)) {
      return [];
    }
    emitted.add(entry.pluginId);
    return replacement;
  });
  return { ...target, tools };
}
