import { useEffect, useState } from "react";
import {
  Activity,
  BookOpen,
  Cpu,
  Fingerprint,
  History,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Puzzle,
  Radio,
  Trash2,
} from "lucide-react";
import { HelixMark } from "@/components/helix-mark";
import { CheckpointsView } from "@/components/checkpoints-view";
import { ConsoleView } from "@/components/console-view";
import { GatewayView } from "@/components/gateway-view";
import { IdentityView } from "@/components/identity-view";
import { MemoryView } from "@/components/memory-view";
import { ModelsView } from "@/components/models-view";
import { ObservatoryView } from "@/components/observatory-view";
import { SkillsView } from "@/components/skills-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { helixRuntime, runSubagent } from "@/lib/harness/run-turn";
import { useHelix } from "@/lib/harness/store";
import type { ProfileMeta, ViewId } from "@/lib/harness/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const NAV: { id: ViewId; label: string; icon: typeof MessageSquare; primary?: boolean }[] = [
  { id: "console", label: "Console", icon: MessageSquare, primary: true },
  { id: "gateway", label: "Gateway", icon: Radio, primary: true },
  { id: "skills", label: "Skills", icon: Puzzle, primary: true },
  { id: "memory", label: "Memory", icon: BookOpen, primary: true },
  { id: "identity", label: "Identity", icon: Fingerprint },
  { id: "models", label: "Models", icon: Cpu },
  { id: "checkpoints", label: "Checkpoints", icon: History },
  { id: "observatory", label: "Observatory", icon: Activity },
];

export function AppShell() {
  const setHydrated = useHelix((s) => s.setHydrated);
  const view = useHelix((s) => s.view);
  const setView = useHelix((s) => s.setView);
  const moreOpen = useHelix((s) => s.moreOpen);
  const setMoreOpen = useHelix((s) => s.setMoreOpen);
  const profiles = useHelix((s) => s.profiles);
  const activeProfileId = useHelix((s) => s.activeProfileId);
  const setProfile = useHelix((s) => s.setProfile);
  const addAgent = useHelix((s) => s.addAgent);
  const removeAgent = useHelix((s) => s.removeAgent);
  const busy = useHelix((s) => s.busy);
  const pending = useHelix((s) => s.pendingApproval);
  const resolveApproval = useHelix((s) => s.resolveApproval);
  const applySubagent = useHelix((s) => s.applySubagent);
  const setBusy = useHelix((s) => s.setBusy);
  const markSuperGrokLive = useHelix((s) => s.markSuperGrokLive);
  const setEnvFlags = useHelix((s) => s.setEnvFlags);
  const providers = useHelix((s) => s.providers ?? []);
  const [agentsOpen, setAgentsOpen] = useState(false);

  useEffect(() => {
    const done = () => setHydrated();
    try {
      const result = useHelix.persist.rehydrate();
      void Promise.resolve(result).then(done, done);
    } catch {
      done();
    }
    void helixRuntime()
      .then((r) => {
        markSuperGrokLive(Boolean(r?.superGrok));
        if (r?.env) setEnvFlags(r.env);
      })
      .catch(() => markSuperGrokLive(false));
  }, [setHydrated, markSuperGrokLive, setEnvFlags]);

  useEffect(() => {
    const t = window.setInterval(() => {
      const result = useHelix.getState().firePulse();
      if (result.woke) {
        toast("Wake gate opened", { description: result.detail });
      }
    }, 60_000);
    return () => window.clearInterval(t);
  }, []);

  const profile = profiles.find((p) => p.id === activeProfileId);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      <nav className="hidden w-[4.5rem] shrink-0 flex-col items-center border-r border-border py-3 lg:flex xl:w-52 xl:items-stretch xl:px-2">
        <div className="mb-6 flex items-center justify-center gap-2 px-2 xl:justify-start">
          <HelixMark className="size-8 text-accent" />
          <span className="hidden font-display text-xl tracking-tight xl:inline">Paddy</span>
        </div>
        <ul className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setView(item.id)}
                className={cn(
                  "flex w-full items-center justify-center gap-3 rounded-xl px-0 py-2.5 text-sm transition-colors xl:justify-start xl:px-3",
                  view === item.id
                    ? "bg-elevated text-fg"
                    : "text-muted hover:bg-surface hover:text-fg",
                )}
              >
                <item.icon className="size-5 shrink-0" />
                <span className="hidden xl:inline">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <HelixMark spinning={busy} className="size-6 text-accent lg:hidden" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{NAV.find((n) => n.id === view)?.label}</p>
              <p className="hidden truncate text-[11px] text-muted sm:block">{profile?.role}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setView("models")}
              className="flex items-center gap-1.5 text-[11px] text-muted hover:text-fg"
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  providers.some((p) => p.id === "supergrok" && p.status === "live")
                    ? "bg-ok pulse-live"
                    : "bg-subtle",
                )}
              />
              SuperGrok
            </button>
            <button
              type="button"
              onClick={() => setAgentsOpen(true)}
              className="flex h-10 max-w-[16rem] items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm text-fg"
            >
              <span className="truncate">{profile?.name ?? "Paddy Irishman"}</span>
              <Plus className="size-3.5 shrink-0 text-muted" />
            </button>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] lg:pb-0">
          {view === "console" && <ConsoleView />}
          {view === "gateway" && <GatewayView />}
          {view === "identity" && <IdentityView />}
          {view === "skills" && <SkillsView />}
          {view === "memory" && <MemoryView />}
          {view === "checkpoints" && <CheckpointsView />}
          {view === "observatory" && <ObservatoryView />}
          {view === "models" && <ModelsView />}
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="grid grid-cols-5">
          {NAV.filter((n) => n.primary).map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setView(item.id)}
                className={cn(
                  "flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[10px]",
                  view === item.id ? "text-fg" : "text-muted",
                )}
              >
                <item.icon className="size-5" />
                {item.label}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={cn(
                "flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[10px]",
                !NAV.find((n) => n.primary && n.id === view) ? "text-fg" : "text-muted",
              )}
            >
              <MoreHorizontal className="size-5" />
              More
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom">
          <SheetTitle className="mb-3">More</SheetTitle>
          <ul className="grid grid-cols-3 gap-2 pb-2">
            {NAV.filter((n) => !n.primary).map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setView(item.id)}
                  className="flex h-20 w-full flex-col items-center justify-center gap-2 rounded-xl bg-surface text-sm"
                >
                  <item.icon className="size-5 text-accent" />
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>

      <AgentsDialog
        open={agentsOpen}
        onOpenChange={setAgentsOpen}
        profiles={profiles}
        activeProfileId={activeProfileId}
        onSelect={(id) => {
          setProfile(id);
          setAgentsOpen(false);
        }}
        onAdd={(name, role) => addAgent(name, role)}
        onRemove={(id) => removeAgent(id)}
      />

      <Dialog open={Boolean(pending)} onOpenChange={(o) => !o && resolveApproval(false)}>
        <DialogContent>
          <DialogTitle>Approval</DialogTitle>
          <DialogDescription>
            {pending
              ? `${pending.tool} needs a go-ahead. ${pending.reason}`
              : ""}
          </DialogDescription>
          {pending ? (
            <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-3 font-mono text-xs">
              {JSON.stringify(pending.args, null, 2)}
            </pre>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => resolveApproval(false)}>
              Deny
            </Button>
            <Button
              onClick={() => {
                const held = useHelix.getState().pendingApproval;
                resolveApproval(true);
                if (held?.tool !== "spawn_subagent") return;
                setBusy(true);
                void runSubagent({
                  data: {
                    role: held.args.role ?? "specialist",
                    task: held.args.task ?? "",
                    preferredProvider: useHelix.getState().preferredProvider,
                    keys: useHelix.getState().brainKeys,
                  },
                })
                  .then((r) => {
                    if (r.ok) applySubagent(r.text, true);
                    else applySubagent(r.error, false);
                  })
                  .catch((err) => {
                    applySubagent(err instanceof Error ? err.message : "Subagent failed", false);
                  });
              }}
            >
              Allow
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AgentsDialog({
  open,
  onOpenChange,
  profiles,
  activeProfileId,
  onSelect,
  onAdd,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: ProfileMeta[];
  activeProfileId: string;
  onSelect: (id: string) => void;
  onAdd: (name: string, role: string) => { ok: true; id: string } | { ok: false; error: string };
  onRemove: (id: string) => boolean;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");

  function create() {
    const result = onAdd(name, role);
    if (!result.ok) {
      toast(result.error);
      return;
    }
    toast(`${name.trim()} is live`, { description: "Own soul, memory, and skills." });
    setName("");
    setRole("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Agents</DialogTitle>
        <DialogDescription>
          Start with Paddy. Add extra minds when you want a specialist — each
          keeps its own files.
        </DialogDescription>
        <ul className="mt-4 space-y-2">
          {profiles.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-xl bg-bg px-3 py-2"
            >
              <button
                type="button"
                onClick={() => onSelect(p.id)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="truncate text-sm text-fg">{p.name}</p>
                <p className="truncate text-[11px] text-muted">{p.role}</p>
              </button>
              {p.id === activeProfileId ? (
                <span className="shrink-0 font-mono text-[10px] tracking-wide text-accent uppercase">
                  live
                </span>
              ) : null}
              {p.id !== "paddy" ? (
                <button
                  type="button"
                  aria-label={`Remove ${p.name}`}
                  onClick={() => {
                    onRemove(p.id);
                    toast(`${p.name} removed`);
                  }}
                  className="rounded-md p-2 text-muted hover:bg-surface hover:text-danger"
                >
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="mt-4 grid gap-2">
          <Input
            placeholder="Name — a specialist, or your own"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                create();
              }
            }}
            autoComplete="off"
          />
          <Input
            placeholder="Role — optional, e.g. research"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            autoComplete="off"
          />
          <Button onClick={create} disabled={!name.trim()}>
            <Plus className="size-4" />
            Add agent
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
