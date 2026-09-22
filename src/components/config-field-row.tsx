import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ConfigFieldDef } from "@/lib/harness/config-panel";

/** Shared path-keyed field renderer for Config panel + Guided Setup. */
export function ConfigFieldRow({
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
