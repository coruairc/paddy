import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useHelix } from "@/lib/harness/store";
import type { WorkspaceFiles } from "@/lib/harness/types";
import { cn } from "@/lib/utils";

const FILES: { key: keyof WorkspaceFiles; label: string; hint: string }[] = [
  { key: "soul", label: "SOUL.md", hint: "Who it is, how it talks" },
  { key: "identity", label: "IDENTITY.md", hint: "Name, stance, model" },
  { key: "user", label: "USER.md", hint: "Small model of you" },
  { key: "memory", label: "MEMORY.md", hint: "Durable facts" },
  { key: "agents", label: "AGENTS.md", hint: "Wake protocol" },
  { key: "heartbeat", label: "HEARTBEAT.md", hint: "Standing watch" },
];

export function IdentityView() {
  const files = useHelix((s) => s.workspaces[s.activeProfileId]!.files);
  const notes = useHelix((s) => s.workspaces[s.activeProfileId]!.dailyNotes);
  const updateFiles = useHelix((s) => s.updateFiles);
  const [active, setActive] = useState<keyof WorkspaceFiles>("soul");
  const [draft, setDraft] = useState(files[active]);
  const [dirty, setDirty] = useState(false);

  function select(key: keyof WorkspaceFiles) {
    setActive(key);
    setDraft(files[key]);
    setDirty(false);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <aside className="shrink-0 border-b border-border p-3 lg:w-56 lg:border-r lg:border-b-0">
        <p className="px-2 pb-2 text-[11px] font-medium tracking-wide text-accent uppercase">
          Identity files
        </p>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col">
          {FILES.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => select(f.key)}
              className={cn(
                "rounded-lg px-3 py-2 text-left transition-colors",
                active === f.key ? "bg-elevated text-fg" : "text-muted hover:text-fg",
              )}
            >
              <span className="block font-mono text-xs">{f.label}</span>
              <span className="hidden text-[11px] text-subtle lg:block">{f.hint}</span>
            </button>
          ))}
        </nav>
      </aside>
      <section className="flex min-h-0 flex-1 flex-col p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl tracking-tight">
              {FILES.find((f) => f.key === active)?.label}
            </h1>
            <p className="text-xs text-muted">
              OpenClaw structured workspace. Hermes keeps USER.md small on purpose.
            </p>
          </div>
          <Button
            size="sm"
            disabled={!dirty}
            onClick={() => {
              updateFiles({ [active]: draft });
              setDirty(false);
            }}
          >
            Save
          </Button>
        </div>
        <Textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
          }}
          className="min-h-0 flex-1 font-mono text-xs leading-relaxed"
        />
        {active === "memory" ? (
          <div className="mt-3 space-y-1">
            <p className="text-[11px] font-medium tracking-wide text-muted uppercase">Daily notes</p>
            {notes.length ? (
              notes.slice(0, 7).map((n) => (
                <p key={n.date} className="font-mono text-[11px] text-subtle">
                  {n.date} — {n.content}
                </p>
              ))
            ) : (
              <p className="text-[11px] text-subtle">None yet. The agent can write_daily.</p>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
