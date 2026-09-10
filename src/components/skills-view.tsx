import { useState } from "react";
import { HubPanel } from "@/components/hub-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useHelix } from "@/lib/harness/store";
import type { Skill, SkillStatus } from "@/lib/harness/types";
import { cn, formatRelative } from "@/lib/utils";

const STAGES: { id: SkillStatus; label: string; blurb: string }[] = [
  { id: "new", label: "New", blurb: "Created from experience" },
  { id: "active", label: "Active", blurb: "In rotation" },
  { id: "stale", label: "Stale", blurb: "Unused too long" },
  { id: "archived", label: "Archived", blurb: "Curator shelf" },
];

const ORIGIN: Record<Skill["origin"], string> = {
  seeded: "seeded",
  learned: "learned",
  patched: "patched",
  hub: "hub",
};

export function SkillsView() {
  const skills = useHelix((s) => s.workspaces[s.activeProfileId]!.skills);
  const runCurator = useHelix((s) => s.runCurator);
  const [tab, setTab] = useState<"loop" | "hub">("hub");
  const [open, setOpen] = useState<string | null>(skills[0]?.id ?? null);

  const selected = skills.find((s) => s.id === open) ?? skills[0];

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <div className="flex gap-1 self-start rounded-xl bg-elevated p-1 shadow-[var(--shadow-border)]">
          {(["hub", "loop"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "rounded-lg px-4 py-2 text-xs font-medium capitalize",
                tab === t ? "bg-bg text-fg" : "text-muted hover:text-fg",
              )}
            >
              {t === "hub" ? "Hub" : `Installed · ${skills.length}`}
            </button>
          ))}
        </div>

        {tab === "hub" ? (
          <HubPanel />
        ) : (
          <>
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
                  Hermes lineage
                </p>
                <h1 className="mt-1 font-display text-3xl tracking-tight">Learning loop</h1>
                <p className="mt-2 max-w-xl text-sm text-muted">
                  Experience writes a skill. Use patches it. The curator ages it.
                  Memory keeps the lesson.
                </p>
              </div>
              <Button variant="secondary" onClick={runCurator}>
                Run curator
              </Button>
            </header>

            <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {STAGES.map((st, i) => (
                <li key={st.id} className="rounded-2xl bg-elevated p-3 shadow-[var(--shadow-border)]">
                  <p className="font-mono text-[11px] text-subtle">0{i + 1}</p>
                  <p className="mt-1 text-sm font-medium">{st.label}</p>
                  <p className="text-xs text-muted">{st.blurb}</p>
                  <p className="mt-2 font-mono text-lg tabular-nums">
                    {skills.filter((s) => s.status === st.id).length}
                  </p>
                </li>
              ))}
            </ol>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <ul className="space-y-2">
                {skills.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(s.id)}
                      className={cn(
                        "w-full rounded-xl p-3 text-left transition-colors",
                        open === s.id ? "bg-elevated shadow-[var(--shadow-border)]" : "hover:bg-surface",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm text-fg">{s.name}</span>
                        <Badge
                          variant={
                            s.status === "active"
                              ? "ok"
                              : s.status === "new"
                                ? "accent"
                                : s.status === "stale"
                                  ? "warn"
                                  : "default"
                          }
                        >
                          {s.status}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted">{s.description}</p>
                    </button>
                  </li>
                ))}
              </ul>
              {selected ? (
                <article className="rounded-2xl bg-elevated p-5 shadow-[var(--shadow-border)]">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-mono text-sm">{selected.name}</h2>
                    <Badge>{ORIGIN[selected.origin]}</Badge>
                    {selected.version ? (
                      <span className="font-mono text-xs text-subtle">v{selected.version}</span>
                    ) : null}
                    <span className="font-mono text-xs text-subtle tabular-nums">
                      {selected.uses} uses
                      {selected.lastUsedAt ? ` · ${formatRelative(selected.lastUsedAt)}` : ""}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-fg/90">{selected.description}</p>
                  {selected.triggers.length ? (
                    <p className="mt-3 text-xs text-muted">
                      Triggers: {selected.triggers.join(" · ")}
                    </p>
                  ) : null}
                  <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-bg p-3 font-mono text-xs leading-relaxed text-fg/85">
                    {selected.instructions}
                  </pre>
                </article>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
