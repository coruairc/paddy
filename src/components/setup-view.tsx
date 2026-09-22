import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfigFieldRow } from "@/components/config-field-row";
import {
  configSet,
  configUnset,
  configValidate,
  getConfig,
  getConfigSchema,
} from "@/lib/harness/config-api";
import {
  buildSetupFields,
  formatFieldDisplay,
  getByDottedPath,
  MEMORY_SCHEMA_DEFAULTS,
  parseFieldInput,
  setSetupDismissed,
  SETUP_SECTIONS,
  valueForField,
  type ConfigFieldDef,
  type SchemaNode,
} from "@/lib/harness/config-panel";
import {
  isCliAuthFailure,
  markCliAuthNeeded,
  messageForCliAuthFailure,
} from "@/lib/harness/cli-token";
import { memoryStatus } from "@/lib/harness/memory-api";
import { useHelix } from "@/lib/harness/store";
import { cn } from "@/lib/utils";

type Issue = { path?: string; message: string; severity?: string };

type MemStatus = {
  ok: true;
  memoryChars: number;
  memoryLimit: number;
  userChars: number;
  userLimit: number;
  entryCount: number;
  ftsEnabled: boolean;
  embeddingMode: string;
};

function handleAuth(err: unknown): boolean {
  if (!isCliAuthFailure(err)) return false;
  markCliAuthNeeded();
  toast.error(messageForCliAuthFailure(err));
  return true;
}

function meterPct(chars: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((chars / limit) * 100));
}

export function SetupView() {
  const setView = useHelix((s) => s.setView);
  const [stepIndex, setStepIndex] = useState(0);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [schema, setSchema] = useState<SchemaNode | null>(null);
  const [schemaStub, setSchemaStub] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<Issue[]>([]);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [memStatus, setMemStatus] = useState<MemStatus | null>(null);

  const section = SETUP_SECTIONS[stepIndex]!;
  const sectionId = section.id;
  const fields = useMemo(() => buildSetupFields(schema, sectionId), [schema, sectionId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, sch] = await Promise.all([getConfig(), getConfigSchema()]);
      if (cfg?.ok && cfg.config) {
        setConfig(cfg.config as Record<string, unknown>);
      }
      if (sch?.ok && sch.schema) {
        setSchema(sch.schema as SchemaNode);
        setSchemaStub(Boolean((sch as { stub?: boolean }).stub));
      }
      setDrafts({});
    } catch (err) {
      if (!handleAuth(err)) {
        toast.error(err instanceof Error ? err.message : "Failed to load config");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (sectionId !== "memory" && sectionId !== "done") return;
    void (async () => {
      try {
        const st = await memoryStatus();
        if (st?.ok) setMemStatus(st as MemStatus);
      } catch (err) {
        if (!handleAuth(err)) {
          /* memoryStatus optional on health/done */
        }
      }
    })();
  }, [sectionId]);

  useEffect(() => {
    if (sectionId !== "health") return;
    void (async () => {
      setBusyPath("__health__");
      try {
        const res = await configValidate({ data: {} });
        const list = (res?.issues || []) as Issue[];
        setIssues(list);
        setHealthOk(Boolean(res?.ok));
      } catch (err) {
        if (!handleAuth(err)) {
          toast.error(err instanceof Error ? err.message : "Validate failed");
        }
      } finally {
        setBusyPath(null);
      }
    })();
  }, [sectionId]);

  function draftFor(field: ConfigFieldDef): string {
    if (Object.hasOwn(drafts, field.path)) return drafts[field.path]!;
    return formatFieldDisplay(valueForField(config, field), field.kind);
  }

  function setDraft(path: string, value: string) {
    // Drafts stay in React state only — writeOnly secrets are never mirrored to localStorage.
    setDrafts((d) => ({ ...d, [path]: value }));
  }

  async function saveField(field: ConfigFieldDef) {
    setBusyPath(field.path);
    try {
      let value: unknown;
      if (field.kind === "boolean") {
        const cur = valueForField(config, field);
        const raw = Object.hasOwn(drafts, field.path) ? drafts[field.path]! : String(Boolean(cur));
        value = parseFieldInput("boolean", raw);
      } else if (field.kind === "password") {
        value = drafts[field.path] ?? "";
        if (!String(value).trim()) {
          toast.error("Enter a token before saving");
          return;
        }
      } else {
        value = parseFieldInput(field.kind, draftFor(field));
      }
      const res = await configSet({ data: { path: field.path, value } });
      if (!res?.ok) {
        toast.error((res as { error?: string })?.error || "Set failed");
        return;
      }
      if (res.config) setConfig(res.config as Record<string, unknown>);
      setDrafts((d) => {
        const next = { ...d };
        delete next[field.path];
        return next;
      });
      toast.success(`Set ${field.path}`);
    } catch (err) {
      if (!handleAuth(err)) toast.error(err instanceof Error ? err.message : "Set failed");
    } finally {
      setBusyPath(null);
    }
  }

  async function unsetField(field: ConfigFieldDef) {
    setBusyPath(field.path);
    try {
      const res = await configUnset({ data: { path: field.path } });
      if (!res?.ok) {
        toast.error((res as { error?: string })?.error || "Unset failed");
        return;
      }
      if (res.config) setConfig(res.config as Record<string, unknown>);
      setDrafts((d) => {
        const next = { ...d };
        delete next[field.path];
        return next;
      });
      toast.success(`Unset ${field.path}`);
    } catch (err) {
      if (!handleAuth(err)) toast.error(err instanceof Error ? err.message : "Unset failed");
    } finally {
      setBusyPath(null);
    }
  }

  async function toggleField(field: ConfigFieldDef, checked: boolean) {
    setDraft(field.path, String(checked));
    setBusyPath(field.path);
    try {
      const res = await configSet({ data: { path: field.path, value: checked } });
      if (!res?.ok) {
        toast.error((res as { error?: string })?.error || "Set failed");
        return;
      }
      if (res.config) setConfig(res.config as Record<string, unknown>);
      setDrafts((d) => {
        const next = { ...d };
        delete next[field.path];
        return next;
      });
    } catch (err) {
      if (!handleAuth(err)) toast.error(err instanceof Error ? err.message : "Set failed");
    } finally {
      setBusyPath(null);
    }
  }

  async function runHealth() {
    setBusyPath("__health__");
    try {
      const res = await configValidate({ data: {} });
      const list = (res?.issues || []) as Issue[];
      setIssues(list);
      setHealthOk(Boolean(res?.ok));
      if (res?.ok) toast.success("Config valid");
      else toast.error(`${list.length || 0} issue(s)`);
    } catch (err) {
      if (!handleAuth(err)) toast.error(err instanceof Error ? err.message : "Validate failed");
    } finally {
      setBusyPath(null);
    }
  }

  function go(delta: number) {
    setStepIndex((i) => Math.max(0, Math.min(SETUP_SECTIONS.length - 1, i + delta)));
  }

  function finish() {
    setSetupDismissed(true);
    setView("config");
  }

  const channelKeys = useMemo(() => {
    const ch = config?.channels;
    if (!ch || typeof ch !== "object" || Array.isArray(ch)) return [] as string[];
    return Object.keys(ch as Record<string, unknown>);
  }, [config]);

  const cliTokenSet = Boolean(getByDottedPath(config, "cli.token"));

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
              Guided setup · mirrors paddy configure
            </p>
            <h1 className="mt-1 flex items-center gap-2 font-display text-3xl tracking-tight">
              <Wand2 className="size-7 text-accent" />
              Setup
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted">
              Same section order as the CLI wizard. Writes go through getConfigSchema / configGet /
              configSet / configUnset. writeOnly secrets never echo or land in localStorage. Plugins
              / Daemon omitted (no persist surface yet).
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {schemaStub ? (
                <Badge variant="warn">schema stub</Badge>
              ) : (
                <Badge variant="ok">live schema</Badge>
              )}
              <Badge variant="default">
                step {stepIndex + 1}/{SETUP_SECTIONS.length}
              </Badge>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={loading || busyPath !== null}
            onClick={() => void refresh()}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            Reload
          </Button>
        </header>

        <nav
          aria-label="Setup sections"
          className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-elevated p-2"
        >
          {SETUP_SECTIONS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStepIndex(i)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                i === stepIndex
                  ? "bg-accent text-bg"
                  : i < stepIndex
                    ? "bg-surface text-fg hover:bg-surface/80"
                    : "text-muted hover:bg-surface/60 hover:text-fg",
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="font-display text-xl tracking-tight">{section.label}</h2>
            <p className="text-xs text-muted">{section.hint}</p>
          </div>

          {sectionId === "memory" ? (
            <>
              <p className="rounded-lg border border-border bg-elevated px-3 py-2 font-mono text-[11px] text-muted">
                schema defaults · memoryCharLimit={MEMORY_SCHEMA_DEFAULTS.memoryCharLimit} ·
                userCharLimit={MEMORY_SCHEMA_DEFAULTS.userCharLimit} · recallLimit=
                {MEMORY_SCHEMA_DEFAULTS.recallLimit} · fts={String(MEMORY_SCHEMA_DEFAULTS.fts)}
              </p>
              {memStatus ? (
                <div className="rounded-xl border border-border bg-surface/40 p-3 text-xs">
                  <p className="mb-2 font-medium text-fg">Runtime SoT · memoryStatus</p>
                  <div className="space-y-2 font-mono text-[11px] text-muted">
                    <Meter
                      label="MEMORY.md"
                      chars={memStatus.memoryChars}
                      limit={memStatus.memoryLimit}
                    />
                    <Meter label="USER.md" chars={memStatus.userChars} limit={memStatus.userLimit} />
                    <p>
                      entries={memStatus.entryCount} · fts={String(memStatus.ftsEnabled)} · embed=
                      {memStatus.embeddingMode}
                    </p>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {sectionId === "skills" ? (
            <p className="rounded-lg border border-border bg-elevated px-3 py-2 text-[11px] text-muted">
              Skills paths are form-only until runtime SoT (same as Config UI). Prefer JSON arrays for
              extraDirs / allow.
            </p>
          ) : null}

          {sectionId === "channels" ? (
            <p className="rounded-lg border border-border bg-elevated px-3 py-2 text-[11px] text-muted">
              Path-keyed <span className="font-mono">channels</span> object. Full account wizards live
              under Gateway. Configured:{" "}
              {channelKeys.length ? channelKeys.join(", ") : "(none)"}.
            </p>
          ) : null}

          {sectionId === "health" ? (
            <HealthPanel
              loading={busyPath === "__health__"}
              ok={healthOk}
              issues={issues}
              config={config}
              cliTokenSet={cliTokenSet}
              channelKeys={channelKeys}
              onRefresh={() => void runHealth()}
            />
          ) : null}

          {sectionId === "done" ? (
            <DonePanel
              config={config}
              cliTokenSet={cliTokenSet}
              channelKeys={channelKeys}
              memStatus={memStatus}
              onConfig={() => {
                setSetupDismissed(true);
                setView("config");
              }}
              onMemory={() => {
                setSetupDismissed(true);
                setView("memory");
              }}
              onDismiss={finish}
            />
          ) : null}

          {fields.length > 0 ? (
            <div className="flex flex-col gap-3">
              {fields.map((field) => (
                <ConfigFieldRow
                  key={field.path}
                  field={field}
                  draft={draftFor(field)}
                  disabled={loading || busyPath !== null}
                  busy={busyPath === field.path}
                  onDraft={(v) => setDraft(field.path, v)}
                  onSave={() => void saveField(field)}
                  onUnset={() => void unsetField(field)}
                  onToggle={(checked) => void toggleField(field, checked)}
                />
              ))}
            </div>
          ) : null}
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={stepIndex === 0}
            onClick={() => go(-1)}
          >
            <ArrowLeft className="size-3.5" />
            Back
          </Button>
          <div className="flex gap-2">
            {sectionId !== "done" ? (
              <Button type="button" size="sm" variant="ghost" onClick={finish}>
                Skip to Config
              </Button>
            ) : null}
            {sectionId === "done" ? (
              <Button type="button" size="sm" onClick={finish}>
                <Check className="size-3.5" />
                Done
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => go(1)}>
                Next
                <ArrowRight className="size-3.5" />
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

function Meter({ label, chars, limit }: { label: string; chars: number; limit: number }) {
  const pct = meterPct(chars, limit);
  return (
    <div>
      <div className="mb-1 flex justify-between">
        <span>{label}</span>
        <span>
          {chars}/{limit} ({pct}%)
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-bg">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function HealthPanel({
  loading,
  ok,
  issues,
  config,
  cliTokenSet,
  channelKeys,
  onRefresh,
}: {
  loading: boolean;
  ok: boolean | null;
  issues: Issue[];
  config: Record<string, unknown> | null;
  cliTokenSet: boolean;
  channelKeys: string[];
  onRefresh: () => void;
}) {
  const gateway = (config?.gateway as Record<string, unknown> | undefined) || {};
  const brain = (config?.brain as Record<string, unknown> | undefined) || {};
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={loading} onClick={onRefresh}>
          <Check className={cn("size-3.5", loading && "animate-spin")} />
          Validate
        </Button>
        {ok === true ? <Badge variant="ok">valid</Badge> : null}
        {ok === false ? <Badge variant="warn">issues</Badge> : null}
      </div>
      {issues.length > 0 ? (
        <div className="rounded-xl border border-danger/40 bg-danger/5 p-3 text-sm">
          <p className="mb-2 flex items-center gap-2 font-medium text-danger">
            <ShieldAlert className="size-4" />
            Validation issues
          </p>
          <ul className="space-y-1 font-mono text-xs text-muted">
            {issues.map((i, idx) => (
              <li key={`${i.path}-${idx}`}>
                {i.path ? <span className="text-fg">{i.path}</span> : null}
                {i.path ? ": " : null}
                {i.message}
                {i.severity ? ` (${i.severity})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="rounded-xl border border-border bg-surface/40 p-3 font-mono text-[11px] text-muted">
        <p className="mb-2 font-sans text-xs font-medium text-fg">Doctor-lite (from getConfig + validate)</p>
        <p>
          gateway {String(gateway.host ?? "—")}:{String(gateway.port ?? "—")} · auth token{" "}
          {cliTokenSet ? "set (redacted)" : "missing"}
        </p>
        <p>
          brain preferred={String(brain.preferred ?? "—")} model={String(brain.model ?? "—")}
        </p>
        <p>channels [{channelKeys.join(", ") || "none"}]</p>
      </div>
    </div>
  );
}

function DonePanel({
  config,
  cliTokenSet,
  channelKeys,
  memStatus,
  onConfig,
  onMemory,
  onDismiss,
}: {
  config: Record<string, unknown> | null;
  cliTokenSet: boolean;
  channelKeys: string[];
  memStatus: MemStatus | null;
  onConfig: () => void;
  onMemory: () => void;
  onDismiss: () => void;
}) {
  const gateway = (config?.gateway as Record<string, unknown> | undefined) || {};
  const brain = (config?.brain as Record<string, unknown> | undefined) || {};
  const workspace = getByDottedPath(config, "agents.defaults.workspace");
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-elevated p-4">
      <p className="text-sm text-muted">
        Setup complete. Path-keyed Config and Memory inspector stay available anytime — this wizard
        does not replace them.
      </p>
      <dl className="grid gap-2 font-mono text-[11px] text-muted sm:grid-cols-2">
        <div>
          <dt className="text-fg">workspace</dt>
          <dd>{workspace != null ? String(workspace) : "(unset)"}</dd>
        </div>
        <div>
          <dt className="text-fg">brain</dt>
          <dd>
            {String(brain.preferred ?? "—")}
            {brain.model ? ` / ${String(brain.model)}` : ""}
          </dd>
        </div>
        <div>
          <dt className="text-fg">gateway</dt>
          <dd>
            {String(gateway.host ?? "—")}:{String(gateway.port ?? "—")} · token{" "}
            {cliTokenSet ? "set" : "missing"}
          </dd>
        </div>
        <div>
          <dt className="text-fg">channels</dt>
          <dd>{channelKeys.length ? channelKeys.join(", ") : "(none)"}</dd>
        </div>
        {memStatus ? (
          <div className="sm:col-span-2">
            <dt className="text-fg">memory runtime</dt>
            <dd>
              {memStatus.memoryChars}/{memStatus.memoryLimit} · user {memStatus.userChars}/
              {memStatus.userLimit} · entries {memStatus.entryCount}
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onConfig}>
          <SlidersHorizontal className="size-3.5" />
          Open Config
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onMemory}>
          <BookOpen className="size-3.5" />
          Open Memory
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
