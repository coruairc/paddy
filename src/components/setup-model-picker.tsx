import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ArrowLeft, Check, Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { configSet } from "@/lib/harness/config-api";
import {
  MENU_BACK,
  MENU_DEFAULT_MODEL,
  MENU_KEEP,
  MENU_KEEP_MODEL,
  brainModelMenuOptions,
  brainProviderById,
  brainProviderMenuOptions,
} from "@/lib/harness/brain-catalog.mjs";
import {
  isCliAuthFailure,
  markCliAuthNeeded,
  messageForCliAuthFailure,
} from "@/lib/harness/cli-token";
import { resolveCanonicalBrainPreference } from "@/lib/harness/brain-preference.mjs";
import {
  brainModelSelectionWrite,
  resolveModelPickerSelection,
} from "@/lib/harness/setup-model-picker";
import { normalizeProviderId } from "@/lib/harness/providers";
import { useHelix } from "@/lib/harness/store";
import { cn } from "@/lib/utils";

export type BrainMenuOption = { value: string; label: string; hint?: string };

type Phase = "provider" | "model" | "confirm";

type Props = {
  config: Record<string, unknown> | null;
  disabled?: boolean;
  onConfig: (config: Record<string, unknown>) => void;
};

function handleAuth(err: unknown): boolean {
  if (!isCliAuthFailure(err)) return false;
  markCliAuthNeeded();
  toast.error(messageForCliAuthFailure(err));
  return true;
}


function filterOptions(options: BrainMenuOption[], query: string): BrainMenuOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => {
    const hay = `${o.label} ${o.hint ?? ""} ${o.value}`.toLowerCase();
    return hay.includes(q);
  });
}

function SearchableOptionList({
  options,
  label,
  query,
  onQuery,
  activeIndex,
  onActiveIndex,
  onSelect,
  disabled,
  listId,
}: {
  options: BrainMenuOption[];
  label: string;
  query: string;
  onQuery: (q: string) => void;
  activeIndex: number;
  onActiveIndex: (i: number) => void;
  onSelect: (value: string) => void;
  disabled?: boolean;
  listId: string;
}) {
  const inputId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const filtered = useMemo(() => filterOptions(options, query), [options, query]);

  useEffect(() => {
    if (activeIndex >= filtered.length) {
      onActiveIndex(Math.max(0, filtered.length - 1));
    }
  }, [activeIndex, filtered.length, onActiveIndex]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function onKeyDown(e: KeyboardEvent) {
    if (disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!filtered.length) return;
      onActiveIndex((activeIndex + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!filtered.length) return;
      onActiveIndex((activeIndex - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Home") {
      e.preventDefault();
      onActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      onActiveIndex(Math.max(0, filtered.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = filtered[activeIndex];
      if (row) onSelect(row.value);
    }
  }

  return (
    <div className="flex flex-col gap-2" onKeyDown={onKeyDown}>
      <label htmlFor={inputId} className="sr-only">
        Filter {label}
      </label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <Input
          id={inputId}
          role="combobox"
          aria-expanded={true}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            filtered[activeIndex] ? `${listId}-opt-${filtered[activeIndex]!.value}` : undefined
          }
          placeholder={`Filter ${label.toLowerCase()}…`}
          value={query}
          disabled={disabled}
          onChange={(e) => {
            onQuery(e.target.value);
            onActiveIndex(0);
          }}
          className="pl-9"
          autoComplete="off"
        />
      </div>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={label}
        className="max-h-64 overflow-y-auto rounded-xl border border-border bg-surface/40"
      >
        {filtered.length === 0 ? (
          <li className="px-3 py-4 text-center text-xs text-muted" role="presentation">
            No matches
          </li>
        ) : (
          filtered.map((opt, i) => {
            const active = i === activeIndex;
            const isBack = opt.value === MENU_BACK;
            const isSentinel =
              opt.value === MENU_KEEP ||
              opt.value === MENU_KEEP_MODEL ||
              opt.value === MENU_DEFAULT_MODEL;
            return (
              <li key={opt.value} role="presentation">
                <button
                  type="button"
                  id={`${listId}-opt-${opt.value}`}
                  role="option"
                  aria-selected={active}
                  data-index={i}
                  disabled={disabled}
                  onMouseEnter={() => onActiveIndex(i)}
                  onClick={() => onSelect(opt.value)}
                  className={cn(
                    "flex w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left text-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset",
                    active ? "bg-accent/15 text-fg" : "text-fg hover:bg-elevated",
                    isBack && "text-muted",
                  )}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="font-medium">{opt.label}</span>
                    {isSentinel ? (
                      <Badge variant="default" className="shrink-0 text-[10px]">
                        sentinel
                      </Badge>
                    ) : null}
                  </span>
                  {opt.hint ? (
                    <span className="font-mono text-[11px] text-muted">{opt.hint}</span>
                  ) : null}
                </button>
              </li>
            );
          })
        )}
      </ul>
      <p className="text-[11px] text-muted">
        ↑↓ to move · Enter to select · type to filter
        {filtered.length ? ` · ${filtered.length}/${options.length}` : ""}
      </p>
    </div>
  );
}

export function SetupModelPicker({ config, disabled, onConfig }: Props) {
  const listId = useId();
  const brainPref = resolveCanonicalBrainPreference(config);
  const currentPreferred = brainPref.preferred;
  const currentModel = brainPref.model ?? "";

  const [phase, setPhase] = useState<Phase>("provider");
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [providerChoice, setProviderChoice] = useState<string | null>(null);
  const [modelChoice, setModelChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preferred =
    providerChoice == null || providerChoice === MENU_KEEP || providerChoice === MENU_BACK
      ? currentPreferred
      : providerChoice;
  const provider = brainProviderById(preferred);

  const providerOptions = useMemo(
    () => brainProviderMenuOptions({ currentPreferred }),
    [currentPreferred],
  );
  const modelOptions = useMemo(
    () =>
      providerChoice && providerChoice !== MENU_BACK
        ? brainModelMenuOptions(providerChoice === MENU_KEEP ? currentPreferred : providerChoice, {
            currentModel,
          })
        : [],
    [providerChoice, currentPreferred, currentModel],
  );

  const resetToProvider = useCallback(() => {
    setPhase("provider");
    setQuery("");
    setActiveIndex(0);
    setProviderChoice(null);
    setModelChoice(null);
  }, []);

  const goModel = useCallback(
    (choice: string) => {
      if (choice === MENU_BACK) {
        toast.message("Model / Brain unchanged");
        return;
      }
      const id = choice === MENU_KEEP ? currentPreferred : choice;
      if (!brainProviderById(id)) {
        toast.error(`Unknown provider “${choice}”`);
        return;
      }
      setProviderChoice(choice);
      setModelChoice(null);
      setPhase("model");
      setQuery("");
      setActiveIndex(0);
    },
    [currentPreferred],
  );

  const goConfirm = useCallback((choice: string) => {
    if (choice === MENU_BACK) {
      setPhase("provider");
      setProviderChoice(null);
      setModelChoice(null);
      setQuery("");
      setActiveIndex(0);
      return;
    }
    setModelChoice(choice);
    setPhase("confirm");
    setQuery("");
    setActiveIndex(0);
  }, []);

  const preview = useMemo(() => {
    if (!providerChoice || !modelChoice) return null;
    return resolveModelPickerSelection({
      providerChoice,
      modelChoice,
      currentPreferred,
      currentModel,
    });
  }, [providerChoice, modelChoice, currentPreferred, currentModel]);

  async function save() {
    if (!providerChoice || !modelChoice) return;
    const resolved = resolveModelPickerSelection({
      providerChoice,
      modelChoice,
      currentPreferred,
      currentModel,
    });
    if (!resolved || "back" in resolved) {
      setPhase("model");
      return;
    }
    setBusy(true);
    try {
      const res = await configSet({
        data: brainModelSelectionWrite({
          preferred: resolved.preferred,
          model: resolved.model,
        }),
      });
      if (!res?.ok) {
        toast.error((res as { error?: string })?.error || "Set brain preferred/model failed");
        return;
      }
      if (res.config) onConfig(res.config as Record<string, unknown>);
      const pid = normalizeProviderId(resolved.preferred);
      const helix = useHelix.getState();
      helix.setPreferredProvider(pid);
      if (resolved.model) helix.setProviderModel(pid, resolved.model);
      toast.success(
        `Brain: ${resolved.preferred}${
          resolved.model ? ` (${resolved.model})` : " (provider default)"
        }`,
      );
      resetToProvider();
    } catch (err) {
      if (!handleAuth(err)) toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const locked = Boolean(disabled || busy);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-elevated p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
            OpenClaw-style picker · same catalog as CLI
          </p>
          <p className="mt-1 text-xs text-muted">
            Current:{" "}
            <span className="font-mono text-fg">
              {currentPreferred}
              {currentModel ? ` / ${currentModel}` : " (provider default)"}
            </span>
          </p>
        </div>
        <Badge variant="default">
          {phase === "provider" ? "1 · Provider" : phase === "model" ? "2 · Model" : "3 · Confirm"}
        </Badge>
      </div>

      {phase === "provider" ? (
        <SearchableOptionList
          options={providerOptions}
          label="providers"
          query={query}
          onQuery={setQuery}
          activeIndex={activeIndex}
          onActiveIndex={setActiveIndex}
          onSelect={goModel}
          disabled={locked}
          listId={`${listId}-providers`}
        />
      ) : null}

      {phase === "model" ? (
        <>
          <p className="text-xs text-muted">
            Models for <span className="font-medium text-fg">{provider?.name ?? preferred}</span>
          </p>
          <SearchableOptionList
            options={modelOptions}
            label="models"
            query={query}
            onQuery={setQuery}
            activeIndex={activeIndex}
            onActiveIndex={setActiveIndex}
            onSelect={goConfirm}
            disabled={locked}
            listId={`${listId}-models`}
          />
          <Button type="button" size="sm" variant="ghost" disabled={locked} onClick={resetToProvider}>
            <ArrowLeft className="size-3.5" />
            Back to providers
          </Button>
        </>
      ) : null}

      {phase === "confirm" && preview && !("back" in preview) ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-fg">
            Save{" "}
            <span className="font-mono">
              {preview.preferred}
              {preview.model ? ` / ${preview.model}` : " (provider default)"}
            </span>
            ?
          </p>
          <p className="text-[11px] text-muted">
            Writes <span className="font-mono">brain.preferred</span> and{" "}
            <span className="font-mono">brain.model</span> in one merge configSet on{" "}
            <span className="font-mono">brain</span>. No secrets in this section.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={locked} onClick={() => void save()}>
              <Check className="size-3.5" />
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={locked}
              onClick={() => {
                setPhase("model");
                setModelChoice(null);
                setQuery("");
                setActiveIndex(0);
              }}
            >
              <ArrowLeft className="size-3.5" />
              Back to models
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
