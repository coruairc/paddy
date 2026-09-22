/**
 * Static brain provider/model catalog for `paddy configure` Model / Brain.
 *
 * Mirrors src/lib/harness/providers.ts PROVIDER_DEFS (id/name/plan/models/default).
 * Data lives in brain-catalog.data.json — regenerate when providers.ts changes:
 *   node --experimental-strip-types scripts/sync-brain-catalog.mjs  (optional)
 * Auth secrets stay in ~/.paddy/.env via existing BRAIN_KEY_ENV — this catalog
 * only drives picker labels; it does not store keys.
 *
 * Pure ESM + JSON import so CLI and dashboard can share the same helpers
 * (no node:fs — safe for Vite client bundles).
 */
import raw from "./brain-catalog.data.json" with { type: "json" };

/** @typedef {{ readonly id: string, readonly name: string }} BrainModelOption */
/** @typedef {{ readonly id: string, readonly name: string, readonly plan: string, readonly group: string, readonly defaultModel: string, readonly models: ReadonlyArray<BrainModelOption> }} BrainProviderOption */

/** @type {ReadonlyArray<BrainProviderOption>} */
export const BRAIN_PROVIDER_CATALOG = Object.freeze(
  (raw.providers || []).map((p) =>
    Object.freeze({
      id: String(p.id),
      name: String(p.name),
      plan: String(p.plan || ""),
      group: String(p.group || ""),
      defaultModel: String(p.defaultModel || ""),
      models: Object.freeze(
        (p.models || []).map((m) => Object.freeze({ id: String(m.id), name: String(m.name) })),
      ),
    }),
  ),
);

/** @type {Readonly<Record<string, string>>} */
export const BRAIN_PROVIDER_GROUP_LABEL = Object.freeze({ ...(raw.groupLabels || {}) });

export const MENU_BACK = "__back__";
export const MENU_KEEP = "__keep__";
export const MENU_KEEP_MODEL = "__keep_model__";
export const MENU_DEFAULT_MODEL = "__default__";

/** @param {string} [id] */
export function brainProviderById(id) {
  const want = String(id || "")
    .trim()
    .toLowerCase();
  return BRAIN_PROVIDER_CATALOG.find((p) => p.id === want) ?? null;
}

/**
 * Menu rows for the provider picker (OpenClaw-style searchable list).
 * @param {{ currentPreferred?: string }} [opts]
 */
export function brainProviderMenuOptions(opts = {}) {
  const current = String(opts.currentPreferred || "").trim();
  /** @type {Array<{ value: string, label: string, hint?: string }>} */
  const rows = [];
  if (current) {
    const cur = brainProviderById(current);
    rows.push({
      value: MENU_KEEP,
      label: `Keep current (${cur?.name || current})`,
      hint: current,
    });
  }
  for (const p of BRAIN_PROVIDER_CATALOG) {
    const group = BRAIN_PROVIDER_GROUP_LABEL[p.group] || p.group;
    rows.push({
      value: p.id,
      label: p.name,
      hint: `${group} · ${p.plan}`,
    });
  }
  rows.push({ value: MENU_BACK, label: "Back", hint: "Return without saving" });
  return rows;
}

/**
 * Menu rows for the model picker for a provider.
 * @param {string} providerId
 * @param {{ currentModel?: string }} [opts]
 */
export function brainModelMenuOptions(providerId, opts = {}) {
  const provider = brainProviderById(providerId);
  /** @type {Array<{ value: string, label: string, hint?: string }>} */
  const rows = [];
  if (!provider) {
    rows.push({ value: MENU_BACK, label: "Back", hint: "Unknown provider" });
    return rows;
  }
  const current = String(opts.currentModel || "").trim();
  rows.push({
    value: MENU_DEFAULT_MODEL,
    label: `Provider default (${provider.defaultModel})`,
    hint: "Clear brain.model override",
  });
  if (current && current !== provider.defaultModel) {
    rows.push({
      value: MENU_KEEP_MODEL,
      label: `Keep current model (${current})`,
      hint: current,
    });
  }
  for (const m of provider.models) {
    rows.push({
      value: m.id,
      label: m.name,
      hint: m.id,
    });
  }
  rows.push({ value: MENU_BACK, label: "Back", hint: "Pick another provider" });
  return rows;
}
