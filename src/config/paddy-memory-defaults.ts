// Paddy memory backstop: memory-hermes owns the memory slot and memory-core's dreaming sidecar
// stays off. Paddy's loader and gateway read the sidecar opt-in only from the resolved slot
// owner's own entry (an unset slot resolves to memory-hermes), so memory-core's own entry never
// starts a sidecar beside Hermes. The upstream resolvers (`resolveMemoryDreamingPluginId`) still
// read memory-core's entry, where dreaming defaults to on, when the slot is unset. Writing both
// keys makes every reader see memory-hermes's own `dreaming.enabled: false`.
import { defaultSlotIdForKey } from "../plugins/slots.js";
import type { ConfigValidationIssue } from "./types.js";
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

function isMemorySlotUnset(cfg: OpenClawConfig): boolean {
  return cfg.plugins?.slots?.memory === undefined;
}

// memory-core's own dreaming block, written by a user who leaves the slot unset. Upstream that
// meant "memory-core owns memory and dreams"; in Paddy the unset slot resolves to memory-hermes.
function readUnsetSlotMemoryCoreDreaming(cfg: OpenClawConfig): Record<string, unknown> | undefined {
  return isMemorySlotUnset(cfg)
    ? readDreaming(cfg.plugins?.entries?.[DREAMING_ENGINE_PLUGIN_ID])
    : undefined;
}

/**
 * Config warning for a user who configured memory-core dreaming but left `plugins.slots.memory`
 * unset: memory-hermes owns memory, and memory-core's dreaming does not run. No warning when that
 * block explicitly turns dreaming off, because nothing the user asked for is lost.
 */
export function collectPaddyMemoryDreamingOwnerWarnings(
  cfg: OpenClawConfig,
): ConfigValidationIssue[] {
  const dreaming = readUnsetSlotMemoryCoreDreaming(cfg);
  if (!dreaming || dreaming.enabled === false) {
    return [];
  }
  return [
    {
      path: "plugins.slots.memory",
      message: `plugins.entries.${DREAMING_ENGINE_PLUGIN_ID}.config.dreaming is set but plugins.slots.memory is unset, so ${PADDY_MEMORY_PLUGIN_ID} owns memory and ${DREAMING_ENGINE_PLUGIN_ID} dreaming won't run; set plugins.slots.memory to "${DREAMING_ENGINE_PLUGIN_ID}" to keep it.`,
    },
  ];
}

/**
 * Fills `plugins.slots.memory: "memory-hermes"` and
 * `plugins.entries.memory-hermes.config.dreaming.enabled: false` when they are unset.
 *
 * Never overwrites a value the user set: another memory owner (or "none") in the slot, an
 * explicit `dreaming.enabled`, or a malformed Hermes entry all leave the config unchanged.
 *
 * With the slot unset and a `memory-core` `config.dreaming` block, the slot stays unset: that
 * user configured memory-core, and writing `memory-hermes` would pin an owner they never chose
 * and hide the `collectPaddyMemoryDreamingOwnerWarnings` hint to set the slot to memory-core.
 * Hermes's own `dreaming.enabled: false` is still filled; it changes nothing for the unset slot
 * (which already resolves to memory-hermes with the sidecar off) and never turns dreaming on.
 * Returns the same object when nothing needs to be filled.
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
  const keepSlotUnset = readUnsetSlotMemoryCoreDreaming(cfg) !== undefined;

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
  if ((hasSlot || keepSlotUnset) && !needsDreaming) {
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
      ...(keepSlotUnset
        ? {}
        : { slots: { ...slots, memory: hasSlot ? rawSlot : PADDY_MEMORY_PLUGIN_ID } }),
      entries: { ...entries, [PADDY_MEMORY_PLUGIN_ID]: nextEntry },
    },
  };
}
