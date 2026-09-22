import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MENU_BACK,
  MENU_DEFAULT_MODEL,
  MENU_KEEP,
  MENU_KEEP_MODEL,
  brainModelMenuOptions,
  brainProviderById,
  brainProviderMenuOptions,
} from "./brain-catalog.mjs";

/** Mirrors resolveModelPickerSelection in setup-model-picker.tsx */
function resolveModelPickerSelection({
  providerChoice,
  modelChoice,
  currentPreferred,
  currentModel,
}) {
  if (!providerChoice || providerChoice === MENU_BACK) return { back: true };
  const preferred = providerChoice === MENU_KEEP ? currentPreferred : providerChoice;
  if (!brainProviderById(preferred)) return null;
  if (!modelChoice || modelChoice === MENU_BACK) return { back: true };
  let model;
  if (modelChoice === MENU_DEFAULT_MODEL) model = "";
  else if (modelChoice === MENU_KEEP_MODEL) model = currentModel;
  else model = modelChoice;
  return { preferred, model };
}

test("shared catalog helpers expose OpenClaw menu rows for Setup picker", () => {
  const providers = brainProviderMenuOptions({ currentPreferred: "supergrok" });
  assert.ok(providers.some((o) => o.value === MENU_KEEP));
  assert.equal(providers.at(-1)?.value, MENU_BACK);
  assert.ok(providers.every((o) => o.label && o.value));
  const models = brainModelMenuOptions("claude", { currentModel: "claude-opus-4-5" });
  assert.ok(models.some((o) => o.value === MENU_DEFAULT_MODEL));
  assert.ok(models.some((o) => o.value === MENU_KEEP_MODEL));
  assert.equal(models.at(-1)?.value, MENU_BACK);
});

test("resolveModelPickerSelection maps CLI sentinels like configure-wizard", () => {
  assert.deepEqual(
    resolveModelPickerSelection({
      providerChoice: MENU_BACK,
      modelChoice: "x",
      currentPreferred: "supergrok",
      currentModel: "grok-4",
    }),
    { back: true },
  );
  assert.deepEqual(
    resolveModelPickerSelection({
      providerChoice: MENU_KEEP,
      modelChoice: MENU_DEFAULT_MODEL,
      currentPreferred: "supergrok",
      currentModel: "grok-4",
    }),
    { preferred: "supergrok", model: "" },
  );
  assert.deepEqual(
    resolveModelPickerSelection({
      providerChoice: "claude",
      modelChoice: MENU_KEEP_MODEL,
      currentPreferred: "supergrok",
      currentModel: "claude-opus-4-5",
    }),
    { preferred: "claude", model: "claude-opus-4-5" },
  );
  assert.deepEqual(
    resolveModelPickerSelection({
      providerChoice: "claude",
      modelChoice: "claude-sonnet-4-5",
      currentPreferred: "supergrok",
      currentModel: "",
    }),
    { preferred: "claude", model: "claude-sonnet-4-5" },
  );
});
