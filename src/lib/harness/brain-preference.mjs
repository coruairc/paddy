/**
 * Pure canonical brain preference resolution (no node:fs).
 * Shared by config.mjs (disk-backed canonicalBrainPreference) and FE Setup/Config/chat.
 *
 * SoT is config.brain.preferred / config.brain.model — not legacy preferredProvider.
 * PADDY_MODEL is only a last-resort override when brain.preferred is unset.
 */

export const DEFAULT_BRAIN_PREFERRED = "supergrok";

/**
 * @param {unknown} config Canonical (or redacted) config object, or null/undefined
 * @param {{ envOverride?: string }} [opts]
 * @returns {{ preferred: string, model: string | undefined }}
 */
export function resolveCanonicalBrainPreference(config, { envOverride = "" } = {}) {
  const brain =
    config && typeof config === "object" && !Array.isArray(config)
      ? /** @type {Record<string, unknown>} */ (config).brain
      : undefined;
  const section =
    brain && typeof brain === "object" && !Array.isArray(brain)
      ? /** @type {Record<string, unknown>} */ (brain)
      : undefined;
  const preferredRaw = section?.preferred;
  const modelRaw = section?.model;
  const env = typeof envOverride === "string" ? envOverride.trim() : "";
  const preferred =
    typeof preferredRaw === "string" && preferredRaw.trim()
      ? preferredRaw.trim()
      : env || DEFAULT_BRAIN_PREFERRED;
  const model =
    typeof modelRaw === "string" && modelRaw.trim() ? modelRaw.trim() : undefined;
  return { preferred, model };
}
