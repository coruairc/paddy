import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  HUB_CATEGORIES,
  HUB_REGISTRIES,
  HUB_SKILLS,
  scanHubSkill,
  type HubRegistry,
  type HubSkill,
} from "@/lib/harness/hub";
import { useHelix } from "@/lib/harness/store";
import { cn } from "@/lib/utils";

const TRUST: Record<HubSkill["trust"], "ok" | "accent" | "default"> = {
  official: "ok",
  trusted: "accent",
  community: "default",
};

export function HubPanel({ onInstalled }: { onInstalled?: (name: string) => void }) {
  const skills = useHelix((s) => s.workspaces[s.activeProfileId]!.skills);
  const installHubSkill = useHelix((s) => s.installHubSkill);
  const uninstallSkill = useHelix((s) => s.uninstallSkill);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<(typeof HUB_CATEGORIES)[number]>("all");
  const [reg, setReg] = useState<HubRegistry | "all">("all");
  const [open, setOpen] = useState<string | null>(HUB_SKILLS[0]?.slug ?? null);

  const installed = new Set(skills.map((s) => s.name));

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return HUB_SKILLS.filter((s) => {
      if (cat !== "all" && s.category !== cat) return false;
      if (reg !== "all" && s.registry !== reg) return false;
      if (!query) return true;
      return `${s.slug} ${s.name} ${s.description} ${s.author}`.toLowerCase().includes(query);
    });
  }, [q, cat, reg]);

  const selected = list.find((s) => s.slug === open) ?? list[0];
  const scan = selected ? scanHubSkill(selected) : null;

  function install(slug: string) {
    const result = installHubSkill(slug);
    toast(result.ok ? "Live on this mind" : "Hub", { description: result.detail });
    if (result.ok) {
      const found = HUB_SKILLS.find((s) => s.slug === slug);
      if (found) onInstalled?.(found.name);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
          Local catalog
        </p>
        <h2 className="mt-1 font-display text-2xl tracking-tight">Skills hub</h2>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Browse, then install into this profile. Each install is a live playbook
          on this mind — not a download from ClawHub. Talk a trigger, or Run it
          from Installed. Import SKILL.md there to add your own.
        </p>
        <p className="mt-2 font-mono text-xs text-subtle tabular-nums">
          {HUB_SKILLS.length} indexed · {skills.filter((s) => s.origin === "hub").length} from hub
        </p>
      </div>

      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search calendar, k8s, inbox…"
      />

      <div className="flex gap-1 overflow-x-auto pb-1">
        {HUB_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCat(c)}
            className={cn(
              "min-h-10 shrink-0 rounded-full px-3 py-1.5 text-xs capitalize transition-colors",
              cat === c ? "bg-elevated text-fg shadow-[var(--shadow-border)]" : "text-muted hover:text-fg",
            )}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="flex gap-1 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setReg("all")}
          className={cn(
            "min-h-10 shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors",
            reg === "all" ? "bg-elevated text-fg shadow-[var(--shadow-border)]" : "text-muted hover:text-fg",
          )}
        >
          all sources
        </button>
        {HUB_REGISTRIES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReg(r)}
            className={cn(
              "min-h-10 shrink-0 rounded-full px-3 py-1.5 font-mono text-xs transition-colors",
              reg === r ? "bg-elevated text-fg shadow-[var(--shadow-border)]" : "text-muted hover:text-fg",
            )}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <ul className="space-y-2">
          {list.map((s) => (
            <li key={s.slug}>
              <button
                type="button"
                onClick={() => setOpen(s.slug)}
                className={cn(
                  "w-full rounded-xl p-3 text-left transition-colors",
                  open === s.slug ? "bg-elevated shadow-[var(--shadow-border)]" : "hover:bg-surface",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm">{s.name}</span>
                  <Badge variant={TRUST[s.trust]}>{s.trust}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted">{s.description}</p>
                <p className="mt-1 font-mono text-[10px] text-subtle">
                  {s.registry} · v{s.version} · bundled
                  {installed.has(s.name) ? " · installed" : ""}
                </p>
              </button>
            </li>
          ))}
          {!list.length ? (
            <li className="rounded-xl bg-surface p-4 text-sm text-muted">No matches.</li>
          ) : null}
        </ul>

        {selected ? (
          <article className="rounded-2xl bg-elevated p-5 shadow-[var(--shadow-border)]">
            <p className="font-mono text-xs text-subtle">{selected.slug}</p>
            <h3 className="mt-1 font-display text-xl">{selected.name}</h3>
            <p className="mt-2 text-sm text-fg/90">{selected.description}</p>
            <p className="mt-3 text-xs text-muted">
              {selected.author} · {selected.registry} · v{selected.version} · local catalog
            </p>
            {scan ? (
              <p className="mt-2 font-mono text-[11px] text-subtle">
                {scan.verdict} · id {scan.bundle} · {scan.note}
              </p>
            ) : null}
            {selected.triggers.length ? (
              <p className="mt-2 text-xs text-muted">
                Triggers: {selected.triggers.join(" · ")}
              </p>
            ) : null}
            <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-bg p-3 font-mono text-xs leading-relaxed text-fg/85">
              {selected.instructions}
            </pre>
            <div className="mt-4 flex gap-2">
              {installed.has(selected.name) ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    uninstallSkill(selected.name);
                    toast("Removed from this profile");
                  }}
                >
                  Uninstall
                </Button>
              ) : (
                <Button onClick={() => install(selected.slug)}>Install into this profile</Button>
              )}
            </div>
          </article>
        ) : null}
      </div>
    </div>
  );
}
