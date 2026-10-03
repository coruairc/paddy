// Paddy memory backstop: memory-hermes owns the memory slot and memory-core's dreaming sidecar
// stays off. The inherited loader reads dreaming settings from the plugin entry named by the raw
// `plugins.slots.memory` value. When the slot is unset it reads memory-core's entry instead, where
// dreaming defaults to on, so memory-core would start as a dreaming sidecar beside Hermes. Writing
// both keys makes the loader read memory-hermes's own `dreaming.enabled: false`.
import { defaultSlotIdForKey } from "../plugins/slots.js";
import type { OpenClawConfig } from "./types.openclaw.js";
import type { PluginEntryConfig } from "./types.plugins.js";

/** Paddy's default memory slot owner (`memory-hermes`). */
export const PADDY_MEMORY_PLUGIN_ID = defaultSlotIdForKey("memory");

// Upstream's dreaming engine (DEFAULT_MEMORY_DREAMING_PLUGIN_ID in memory-host-sdk/dreaming.ts).
const DREAMING_ENGINE_PLUGIN_ID = "memory-core";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readDreaming(entry: unknown): Record<string, unknown> | undefined {
  if (!isRecord(entry) || !isRecord(entry.config)) {
    return undefined;
  }
  return isRecord(entry.config.dreaming) ? entry.config.dreaming : undefined;
}

/**
 * Fills `plugins.slots.memory: "memory-hermes"` and
 * `plugins.entries.memory-hermes.config.dreaming.enabled: false` when they are unset.
 *
 * Never overwrites a value the user set: another memory owner (or "none") in the slot, an
 * explicit `dreaming.enabled`, or a malformed Hermes entry all leave the config unchanged. With
 * the slot unset and an explicit `memory-core` `dreaming.enabled`, the user already chose how the
 * inherited resolution behaves, so that config is left unchanged too. Returns the same object
 * when nothing needs to be filled.
 */
export function applyPaddyMemoryDefaults(cfg: OpenClawConfig): OpenClawConfig {
  const plugins = cfg.plugins;
  const slots = plugins?.slots;
  const rawSlot = slots?.memory;
  const hasSlot = rawSlot !== undefined;
  if (
    hasSlot &&
    (typeof rawSlot !== "string" || rawSlot.trim().toLowerCase() !== PADDY_MEMORY_PLUGIN_ID)
  ) {
    return cfg;
  }
  const entries = plugins?.entries;
  if (!hasSlot && readDreaming(entries?.[DREAMING_ENGINE_PLUGIN_ID])?.enabled !== undefined) {
    return cfg;
  }

  const hermesEntry = entries?.[PADDY_MEMORY_PLUGIN_ID];
  if (hermesEntry !== undefined && !isRecord(hermesEntry)) {
    return cfg;
  }
  const hermesConfig = hermesEntry?.config;
  if (hermesConfig !== undefined && !isRecord(hermesConfig)) {
    return cfg;
  }
  const hermesDreaming: unknown = hermesConfig?.dreaming;
  if (hermesDreaming !== undefined && !isRecord(hermesDreaming)) {
    return cfg;
  }
  const needsDreaming = hermesDreaming?.enabled === undefined;
  if (hasSlot && !needsDreaming) {
    return cfg;
  }

  const nextEntry: PluginEntryConfig = {
    ...hermesEntry,
    config: {
      ...hermesConfig,
      dreaming: { ...hermesDreaming, ...(needsDreaming ? { enabled: false } : {}) },
    },
  };
  return {
    ...cfg,
    plugins: {
      ...plugins,
      slots: { ...slots, memory: hasSlot ? rawSlot : PADDY_MEMORY_PLUGIN_ID },
      entries: { ...entries, [PADDY_MEMORY_PLUGIN_ID]: nextEntry },
    },
  };
}
