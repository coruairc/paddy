import { useState } from "react";
import { toast } from "sonner";
import { HubPanel } from "@/components/hub-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { sendTurn } from "@/lib/harness/send";
import { useHelix } from "@/lib/harness/store";
import { toSkillMd } from "@/lib/harness/mutate";
import type { Skill, SkillStatus } from "@/lib/harness/types";
import { cn, formatRelative } from "@/lib/utils";

const STAGES: { id: SkillStatus; label: string; blurb: string }[] = [
  { id: "new", label: "New", blurb: "Created from experience" },
  { id: "active", label: "Active", blurb: "In rotation" },
  { id: "stale", label: "Stale", blurb: "Unused too long" },
  { id: "archived", label: "Archived", blurb: "Shelf" },
];

const ORIGIN: Record<Skill["origin"], string> = {
  seeded: "seeded",
  learned: "learned",
  patched: "patched",
  hub: "hub",
};

const IMPORT_PLACEHOLDER = `---
name: morning-brief
description: Compress overnight notes into a 6-line brief.
triggers: [morning brief, overnight]
---

1. search_memory for open threads.
2. canvas_render kind=markdown title="Morning brief" with six lines: shipped, next, blockers.
3. Offer write_daily with one sentence.
`;

export function SkillsView() {
  const skills = useHelix((s) => s.workspaces[s.activeProfileId]!.skills);
  const runCurator = useHelix((s) => s.runCurator);
  const createSkill = useHelix((s) => s.createSkill);
  const importSkillMd = useHelix((s) => s.importSkillMd);
  const patchSkill = useHelix((s) => s.patchSkill);
  const setSkillStatus = useHelix((s) => s.setSkillStatus);
  const uninstallSkill = useHelix((s) => s.uninstallSkill);
  const setView = useHelix((s) => s.setView);
  const busy = useHelix((s) => s.busy);
  const [tab, setTab] = useState<"loop" | "hub">("hub");
  const [open, setOpen] = useState<string | null>(skills[0]?.id ?? null);
  const [drafting, setDrafting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftTriggers, setDraftTriggers] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [editTriggers, setEditTriggers] = useState("");

  const selected = skills.find((s) => s.id === open) ?? skills[0];
  const live = skills.filter((s) => s.status !== "archived").length;

  function pick(id: string) {
    setOpen(id);
    setEditing(false);
  }

  function saveDraft() {
    const triggers = draftTriggers
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const result = createSkill({
      name: draftName,
      description: draftDesc,
      instructions: draftBody,
      triggers,
    });
    if (!result.ok) {
      toast(result.error);
      return;
    }
    toast("Skill is live", { description: "This mind will follow it when the trigger matches." });
    setDrafting(false);
    setDraftName("");
    setDraftDesc("");
    setDraftTriggers("");
    setDraftBody("");
    setTab("loop");
  }

  function saveImport() {
    const result = importSkillMd(importText);
    if (!result.ok) {
      toast(result.error);
      return;
    }
    toast(result.updated ? "Playbook updated" : "Skill is live", { description: result.detail });
    setImporting(false);
    setImportText("");
    setTab("loop");
    const hit = useHelix.getState().ws().skills.find((s) => s.name === result.name);
    if (hit) setOpen(hit.id);
  }

  function saveEdit(s: Skill) {
    const triggers = editTriggers
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    patchSkill(s.name, { instructions: editBody, triggers: triggers.length ? triggers : s.triggers });
    setEditing(false);
    toast("Playbook updated");
  }

  async function runSkill(s: Skill) {
    const line = s.triggers[0]
      ? `Use the ${s.name} skill. ${s.triggers[0]}.`
      : `Follow the ${s.name} skill now.`;
    setView("console");
    await sendTurn(line, "web", undefined, { skill: s.name });
  }

  async function copySkill(s: Skill) {
    const md = toSkillMd(s);
    try {
      await navigator.clipboard.writeText(md);
      toast("SKILL.md copied", { description: "Paste it into another mind or an OpenClaw skills folder." });
    } catch {
      toast("Copy failed");
    }
  }

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
                "min-h-11 rounded-lg px-4 py-2 text-xs font-medium capitalize",
                tab === t ? "bg-bg text-fg" : "text-muted hover:text-fg",
              )}
            >
              {t === "hub" ? "Hub" : `Installed · ${live}`}
            </button>
          ))}
        </div>

        {tab === "hub" ? (
          <HubPanel
            onInstalled={(name) => {
              setTab("loop");
              const hit = useHelix.getState().ws().skills.find((s) => s.name === name);
              if (hit) setOpen(hit.id);
            }}
          />
        ) : (
          <>
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
                  Hermes lineage
                </p>
                <h1 className="mt-1 font-display text-3xl tracking-tight">Capabilities</h1>
                <p className="mt-2 max-w-xl text-sm text-muted">
                  Installed playbooks run on this mind. Talk a trigger, press Run,
                  import a SKILL.md, or write your own. Experience can add more.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={runCurator}>
                  Run curator
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setImporting((v) => !v);
                    setDrafting(false);
                  }}
                >
                  {importing ? "Cancel" : "Import SKILL.md"}
                </Button>
                <Button
                  onClick={() => {
                    setDrafting((v) => !v);
                    setImporting(false);
                  }}
                >
                  {drafting ? "Cancel" : "New skill"}
                </Button>
              </div>
            </header>

            {importing ? (
              <form
                className="grid gap-3 rounded-2xl bg-elevated p-5 shadow-[var(--shadow-border)]"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveImport();
                }}
              >
                <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
                  Import SKILL.md
                </p>
                <p className="text-xs text-muted">
                  OpenClaw / Hermes / agentskills.io frontmatter. Same name updates the playbook.
                </p>
                <Textarea
                  placeholder={IMPORT_PLACEHOLDER}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  className="min-h-48 font-mono text-xs"
                />
                <div className="flex justify-end">
                  <Button type="submit" disabled={!importText.trim()}>
                    Add to this mind
                  </Button>
                </div>
              </form>
            ) : null}

            {drafting ? (
              <form
                className="grid gap-3 rounded-2xl bg-elevated p-5 shadow-[var(--shadow-border)]"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveDraft();
                }}
              >
                <p className="text-[11px] font-medium tracking-wide text-muted uppercase">
                  New playbook
                </p>
                <Input
                  placeholder="Name — kebab-case, e.g. morning-brief"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  autoComplete="off"
                />
                <Input
                  placeholder="What it does, in one line"
                  value={draftDesc}
                  onChange={(e) => setDraftDesc(e.target.value)}
                  autoComplete="off"
                />
                <Input
                  placeholder="Triggers — comma separated, e.g. morning brief, standup"
                  value={draftTriggers}
                  onChange={(e) => setDraftTriggers(e.target.value)}
                  autoComplete="off"
                />
                <Textarea
                  placeholder="Instructions. Imperative. Name tools: canvas_render, create_ticket, write_memory…"
                  value={draftBody}
                  onChange={(e) => setDraftBody(e.target.value)}
                  className="min-h-32 font-mono text-xs"
                />
                <div className="flex justify-end">
                  <Button type="submit" disabled={!draftName.trim() || !draftBody.trim()}>
                    Add to this mind
                  </Button>
                </div>
              </form>
            ) : null}

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
                      onClick={() => pick(s.id)}
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
                  {editing ? (
                    <div className="mt-4 grid gap-2">
                      <Input
                        value={editTriggers}
                        onChange={(e) => setEditTriggers(e.target.value)}
                        placeholder="Triggers, comma separated"
                        autoComplete="off"
                      />
                      <Textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        className="min-h-40 font-mono text-xs"
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" onClick={() => setEditing(false)}>
                          Cancel
                        </Button>
                        <Button onClick={() => saveEdit(selected)}>Save playbook</Button>
                      </div>
                    </div>
                  ) : (
                    <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-bg p-3 font-mono text-xs leading-relaxed text-fg/85">
                      {selected.instructions}
                    </pre>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      disabled={busy || selected.status === "archived"}
                      onClick={() => void runSkill(selected)}
                    >
                      Run
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setEditBody(selected.instructions);
                        setEditTriggers(selected.triggers.join(", "));
                        setEditing(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button variant="outline" onClick={() => void copySkill(selected)}>
                      Copy SKILL.md
                    </Button>
                    {selected.status === "archived" ? (
                      <Button
                        variant="outline"
                        onClick={() => setSkillStatus(selected.name, "active")}
                      >
                        Restore
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => setSkillStatus(selected.name, "archived")}
                      >
                        Archive
                      </Button>
                    )}
                    {selected.origin === "hub" || selected.origin === "learned" || selected.origin === "patched" ? (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          uninstallSkill(selected.name);
                          toast("Removed from this mind");
                        }}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </article>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
