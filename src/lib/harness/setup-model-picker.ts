import {
  MENU_BACK,
  MENU_DEFAULT_MODEL,
  MENU_KEEP,
  MENU_KEEP_MODEL,
  brainProviderById,
} from "./brain-catalog.mjs";

/** Resolve CLI sentinels → concrete brain.preferred / brain.model (mirrors configure-wizard). */
export function resolveModelPickerSelection(opts: {
  providerChoice: string;
  modelChoice: string;
  currentPreferred: string;
  currentModel: string;
}): { preferred: string; model: string } | { back: true } | null {
  const { providerChoice, modelChoice, currentPreferred, currentModel } = opts;
  if (!providerChoice || providerChoice === MENU_BACK) return { back: true };
  const preferred = providerChoice === MENU_KEEP ? currentPreferred : providerChoice;
  if (!brainProviderById(preferred)) return null;
  if (!modelChoice || modelChoice === MENU_BACK) return { back: true };
  let model: string;
  if (modelChoice === MENU_DEFAULT_MODEL) model = "";
  else if (modelChoice === MENU_KEEP_MODEL) model = currentModel;
  else model = modelChoice;
  return { preferred, model };
}
