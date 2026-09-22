import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Eraser, RefreshCw, Save, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  configGet,
  configSet,
  configUnset,
  configValidate,
  getConfig,
  getConfigSchema,
} from "@/lib/harness/config-api";
import {
  buildConfigFields,
  formatFieldDisplay,
  MEMORY_SCHEMA_DEFAULTS,
  parseFieldInput,
  valueForField,
  type ConfigFieldDef,
  type SchemaNode,
} from "@/lib/harness/config-panel";
import {
  isCliAuthFailure,
  markCliAuthNeeded,
  messageForCliAuthFailure,
} from "@/lib/harness/cli-token";
import { cn } from "@/lib/utils";

type Issue = { path?: string; message: string; severity?: string };

const SECTIONS: { id: ConfigFieldDef["section"]; title: string; blurb: string }[] = [
  {
    id: "gateway",
    title: "Gateway",
    blurb: "Bind host/port and token auth. gateway.auth.token aliases cli.token — never stored in localStorage.",
  },
  {
    id: "brain",
    title: "Brain",
    blurb: "Preferred provider and optional model override.",
  },
  {
    id: "memory",
    title: "Memory limits",
    blurb: "Hermes-shaped caps (agents.defaults.memory). Read by resolveMemoryLimits at runtime.",
  },
];

function handleAuth(err: unknown): boolean {
  if (!isCliAuthFailure(err)) return false;
  markCliAuthNeeded();
  toast.error(messageForCliAuthFailure(err));
  return true;
}

export function ConfigView() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [schema, setSchema] = useState<SchemaNode | null>(null);
  const [schemaStub, setSchemaStub] = useState(false);
  const [schemaVersion, setSchemaVersion] = useState<number | null>(null);
  const [configPath, setConfigPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pathDraft, setPathDraft] = useState("gateway.port");
  const [pathValueDraft, setPathValueDraft] = useState("");
  const [pathResult, setPathResult] = useState<string>("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [mapping, setMapping] = useState<Record<string, string> | null>(null);

  const fields = useMemo(() => buildConfigFields(schema), [schema]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, sch] = await Promise.all([getConfig(), getConfigSchema()]);
      if (cfg?.ok && cfg.config) {
        setConfig(cfg.config as Record<string, unknown>);
        setConfigPath(String(cfg.path || ""));
        setSchemaVersion(typeof cfg.schemaVersion === "number" ? cfg.schemaVersion : null);
      }
      if (sch?.ok && sch.schema) {
        setSchema(sch.schema as SchemaNode);
        setSchemaStub(Boolean((sch as { stub?: boolean }).stub));
        setMapping(
          sch.mapping && typeof sch.mapping === "object"
            ? (sch.mapping as Record<string, string>)
            : null,
        );
        if (typeof sch.schemaVersion === "number") setSchemaVersion(sch.schemaVersion);
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

  function draftFor(field: ConfigFieldDef): string {
    if (Object.hasOwn(drafts, field.path)) return drafts[field.path]!;
    return formatFieldDisplay(valueForField(config, field), field.kind);
  }

  function setDraft(path: string, value: string) {
    setDrafts((d) => ({ ...d, [path]: value }));
  }

  async function saveField(field: ConfigFieldDef) {
    setBusyPath(field.path);
    try {
      let value: unknown;
      if (field.kind === "boolean") {
        const cur = valueForField(config, field);
        // Switch commits immediately via onCheckedChange — draft may be "true"/"false"
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

  async function runValidate() {
    setBusyPath("__validate__");
    try {
      const res = await configValidate({ data: {} });
      const list = (res?.issues || []) as Issue[];
      setIssues(list);
      if (res?.ok) toast.success("Config valid");
      else toast.error(`${list.length || (res?.errors as string[] | undefined)?.length || 0} issue(s)`);
    } catch (err) {
      if (!handleAuth(err)) toast.error(err instanceof Error ? err.message : "Validate failed");
    } finally {
      setBusyPath(null);
    }
  }

  async function runPathGet() {
    const path = pathDraft.trim();
    if (!path) return;
    setBusyPath("__path__");
    try {
      const res = await configGet({ data: { path } });
      if (!res?.ok) {
        setPathResult((res as { error?: string })?.error || "not found");
        return;
      }
      const aliased = (res as { aliasedTo?: string }).aliasedTo;
      setPathResult(
        JSON.stringify(
          { path: res.path, value: res.value, ...(aliased ? { aliasedTo: aliased } : {}) },
          null,
          2,
        ),
      );
    } catch (err) {
      if (!handleAuth(err)) {
        setPathResult(err instanceof Error ? err.message : "get failed");
      }
    } finally {
      setBusyPath(null);
    }
  }

  async function runPathSet() {
    const path = pathDraft.trim();
    if (!path) return;
    setBusyPath("__path__");
    try {
      let value: unknown = pathValueDraft;
      const trimmed = pathValueDraft.trim();
      if (trimmed === "true" || trimmed === "false") value = trimmed === "true";
      else if (/^-?\d+(\.\d+)?$/.test(trimmed)) value = Number(trimmed);
      else if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
      ) {
        value = JSON.parse(trimmed);
      }
      const res = await configSet({ data: { path, value } });
      if (!res?.ok) {
        toast.error((res as { error?: string })?.error || "Set failed");
        return;
      }
      if (res.config) setConfig(res.config as Record<string, unknown>);
      setPathResult(JSON.stringify({ path: res.path, ok: true }, null, 2));
      // Never keep writeOnly token drafts around
      if (path === "gateway.auth.token" || path === "cli.token") setPathValueDraft("");
      toast.success(`Set ${path}`);
    } catch (err) {
      if (!handleAuth(err)) toast.error(err instanceof Error ? err.message : "Set failed");
    } finally {
      setBusyPath(null);
    }
  }

  async function runPathUnset() {
    const path = pathDraft.trim();
    if (!path) return;
    setBusyPath("__path__");
    try {
      const res = await configUnset({ data: { path } });
      if (!res?.ok) {
        toast.error((res as { error?: string })?.error || "Unset failed");
        return;
      }
      if (res.config) setConfig(res.config as Record<string, unknown>);
      setPathResult(JSON.stringify({ path: res.path, ok: true, unset: true }, null, 2));
      toast.success(`Unset ${path}`);
    } catch (err) {
      if (!handleAuth(err)) toast.error(err instanceof Error ? err.message : "Unset failed");
    } finally {
      setBusyPath(null);
    }
  }

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
              Path-keyed · schema v{schemaVersion ?? "…"}
            </p>
            <h1 className="mt-1 font-display text-3xl tracking-tight">Config</h1>
            <p className="mt-2 max-w-xl text-sm text-muted">
              OpenClaw-style get/set/unset over ~/.paddy/config.json. Secrets stay writeOnly — never
              localStorage. Memory caps are runtime SoT; skills nested keys remain form-only.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant="default">{configPath || "~/.paddy/config.json"}</Badge>
              {schemaStub ? <Badge variant="warn">schema stub</Badge> : <Badge variant="ok">live schema</Badge>}
              {mapping?.["gateway.auth.token"] ? (
                <Badge variant="accent">auth → {mapping["gateway.auth.token"]}</Badge>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
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
            <Button
              type="button"
              size="sm"
              disabled={loading || busyPath !== null}
              onClick={() => void runValidate()}
            >
              <Check className="size-3.5" />
              Validate
            </Button>
          </div>
        </header>

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

        {SECTIONS.map((section) => {
          const sectionFields = fields.filter((f) => f.section === section.id);
          if (!sectionFields.length) return null;
          return (
            <section key={section.id} className="flex flex-col gap-3">
              <div>
                <h2 className="font-display text-xl tracking-tight">{section.title}</h2>
                <p className="text-xs text-muted">{section.blurb}</p>
              </div>
              {section.id === "memory" ? (
                <p className="rounded-lg border border-border bg-elevated px-3 py-2 font-mono text-[11px] text-muted">
                  defaults · memoryCharLimit={MEMORY_SCHEMA_DEFAULTS.memoryCharLimit} · userCharLimit=
                  {MEMORY_SCHEMA_DEFAULTS.userCharLimit} · recallLimit={MEMORY_SCHEMA_DEFAULTS.recallLimit} ·
                  fts={String(MEMORY_SCHEMA_DEFAULTS.fts)}
                </p>
              ) : null}
              <div className="flex flex-col gap-3">
                {sectionFields.map((field) => (
                  <FieldRow
                    key={field.path}
                    field={field}
                    draft={draftFor(field)}
                    disabled={loading || busyPath !== null}
                    busy={busyPath === field.path}
                    onDraft={(v) => setDraft(field.path, v)}
                    onSave={() => void saveField(field)}
                    onUnset={() => void unsetField(field)}
                    onToggle={(checked) => {
                      setDraft(field.path, String(checked));
                      void (async () => {
                        setBusyPath(field.path);
                        try {
                          const res = await configSet({
                            data: { path: field.path, value: checked },
                          });
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
                          if (!handleAuth(err)) {
                            toast.error(err instanceof Error ? err.message : "Set failed");
                          }
                        } finally {
                          setBusyPath(null);
                        }
                      })();
                    }}
                  />
                ))}
              </div>
            </section>
          );
        })}

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="size-4 text-accent" />
            <div>
              <h2 className="font-display text-xl tracking-tight">Path console</h2>
              <p className="text-xs text-muted">
                Raw get / set / unset — same serverFns as <span className="font-mono">paddy config</span>.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-elevated p-3">
            <label className="text-[11px] font-medium tracking-wide text-muted uppercase">
              Dotted path
            </label>
            <Input
              value={pathDraft}
              onChange={(e) => setPathDraft(e.target.value)}
              placeholder="agents.defaults.memory.memoryCharLimit"
              className="font-mono text-xs"
              spellCheck={false}
              autoComplete="off"
            />
            <label className="text-[11px] font-medium tracking-wide text-muted uppercase">
              Value (for set)
            </label>
            <Input
              type={
                pathDraft.trim() === "gateway.auth.token" || pathDraft.trim() === "cli.token"
                  ? "password"
                  : "text"
              }
              value={pathValueDraft}
              onChange={(e) => setPathValueDraft(e.target.value)}
              placeholder='2200 | true | "supergrok" | {"enabled":true}'
              className="font-mono text-xs"
              spellCheck={false}
              autoComplete="off"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busyPath !== null}
                onClick={() => void runPathGet()}
              >
                Get
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busyPath !== null}
                onClick={() => void runPathSet()}
              >
                <Save className="size-3.5" />
                Set
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busyPath !== null}
                onClick={() => void runPathUnset()}
              >
                <Eraser className="size-3.5" />
                Unset
              </Button>
            </div>
            {pathResult ? (
              <pre className="scrollbar-thin max-h-48 overflow-auto rounded-lg bg-bg p-3 font-mono text-[11px] text-muted">
                {pathResult}
              </pre>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function FieldRow({
  field,
  draft,
  disabled,
  busy,
  onDraft,
  onSave,
  onUnset,
  onToggle,
}: {
  field: ConfigFieldDef;
  draft: string;
  disabled: boolean;
  busy: boolean;
  onDraft: (v: string) => void;
  onSave: () => void;
  onUnset: () => void;
  onToggle: (checked: boolean) => void;
}) {
  const checked = draft === "true";

  return (
    <div className="rounded-xl border border-border bg-surface/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-xs text-fg">{field.path}</p>
          {field.description || field.notRuntimeSot ? (
            <p className="mt-0.5 text-[11px] text-muted">
              {field.description}
              {field.notRuntimeSot ? (field.description ? " · " : "") + "not runtime SoT yet" : ""}
            </p>
          ) : null}
        </div>
        <div className="flex gap-1">
          {field.kind !== "boolean" && field.path !== "gateway.auth.mode" ? (
            <Button type="button" size="sm" disabled={disabled || busy} onClick={onSave}>
              <Save className="size-3.5" />
              Set
            </Button>
          ) : null}
          {!field.writeOnly && field.path !== "gateway.auth.mode" ? (
            <Button type="button" size="sm" variant="ghost" disabled={disabled || busy} onClick={onUnset}>
              Unset
            </Button>
          ) : null}
        </div>
      </div>
      {field.kind === "boolean" ? (
        <div className="flex items-center gap-3">
          <Switch
            checked={checked}
            disabled={disabled || busy}
            onCheckedChange={onToggle}
            aria-label={field.path}
          />
          <span className="text-xs text-muted">{checked ? "true" : "false"}</span>
        </div>
      ) : field.path === "gateway.auth.mode" ? (
        <Input value="token" readOnly disabled className="font-mono text-xs" />
      ) : field.kind === "password" ? (
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          placeholder="writeOnly — paste to set, never shown back"
          disabled={disabled || busy}
          onChange={(e) => onDraft(e.target.value)}
          className="font-mono text-xs"
          aria-label={field.path}
        />
      ) : field.kind === "json" ? (
        <Textarea
          value={draft}
          disabled={disabled || busy}
          onChange={(e) => onDraft(e.target.value)}
          className="min-h-24 font-mono text-xs"
          spellCheck={false}
        />
      ) : (
        <Input
          type={field.kind === "number" ? "number" : "text"}
          value={draft}
          disabled={disabled || busy}
          onChange={(e) => onDraft(e.target.value)}
          className="font-mono text-xs"
          spellCheck={false}
          autoComplete="off"
          aria-label={field.path}
        />
      )}
    </div>
  );
}
