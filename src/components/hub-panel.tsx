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

const SCAN_STEPS = ["Quarantine", "Hash bundle", "Security scan", "Write SKILL.md"] as const;

export function HubPanel() {
  const skills = useHelix((s) => s.workspaces[s.activeProfileId]!.skills);
  const installHubSkill = useHelix((s) => s.installHubSkill);
  const uninstallSkill = useHelix((s) => s.uninstallSkill);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<(typeof HUB_CATEGORIES)[number]>("all");
  const [reg, setReg] = useState<HubRegistry | "all">("all");
  const [open, setOpen] = useState<string | null>(HUB_SKILLS[0]?.slug ?? null);
  const [scanning, setScanning] = useState<string | null>(null);
  const [scanStep, setScanStep] = useState(0);

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

  async function install(slug: string) {
    setScanning(slug);
    setScanStep(0);
    for (let i = 0; i < SCAN_STEPS.length; i++) {
      setScanStep(i);
      await new Promise((r) => setTimeout(r, 220));
    }
    const result = installHubSkill(slug);
    setScanning(null);
    toast(result.ok ? "Installed" : "Hub", { description: result.detail });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
          Local catalog
        </p>
        <h2 className="mt-1 font-display text-2xl tracking-tight">Skills hub</h2>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Browse, scan, install. Inspired by ClawHub and Hermes — this index
          lives in Paddy, not on their registries. Bundles are quarantined,
          hashed, then written into this profile.
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
                  {s.registry} · v{s.version} · {s.installs}
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
              {selected.author} · {selected.registry} · v{selected.version} · {selected.installs}{" "}
              installs
            </p>
            {scan ? (
              <p className="mt-2 font-mono text-[11px] text-subtle">
                scan {scan.verdict} · bundle {scan.bundle}
              </p>
            ) : null}
            {selected.triggers.length ? (
              <p className="mt-2 text-xs text-muted">
                Triggers: {selected.triggers.join(" · ")}
              </p>
            ) : null}
            <p className="mt-3 font-mono text-[11px] text-subtle">
              paddy hub install {selected.slug}
            </p>
            <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-bg p-3 font-mono text-xs leading-relaxed text-fg/85">
              {selected.instructions}
            </pre>
            {scanning === selected.slug ? (
              <ol className="mt-4 space-y-1.5">
                {SCAN_STEPS.map((label, i) => (
                  <li
                    key={label}
                    className={cn(
                      "font-mono text-xs",
                      i < scanStep ? "text-ok" : i === scanStep ? "text-accent" : "text-subtle",
                    )}
                  >
                    {i < scanStep ? "done" : i === scanStep ? "run " : "idle"} · {label}
                  </li>
                ))}
              </ol>
            ) : null}
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
                <Button
                  disabled={scanning === selected.slug}
                  onClick={() => void install(selected.slug)}
                >
                  {scanning === selected.slug ? "Scanning…" : "Install"}
                </Button>
              )}
            </div>
          </article>
        ) : null}
      </div>
    </div>
  );
}
