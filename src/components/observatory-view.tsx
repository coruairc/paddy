import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TOOL_CATALOG } from "@/lib/harness/tools";
import { useHelix } from "@/lib/harness/store";
import { formatRelative } from "@/lib/utils";

export function ObservatoryView() {
  const traces = useHelix((s) => s.workspaces[s.activeProfileId]!.traces);
  const policy = useHelix((s) => s.policy);
  const setPolicy = useHelix((s) => s.setPolicy);
  const resetWorkspace = useHelix((s) => s.resetWorkspace);
  const ws = useHelix((s) => s.workspaces[s.activeProfileId]!);
  const channels = useHelix((s) => s.channels);

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <header>
          <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
            Control plane
          </p>
          <h1 className="mt-1 font-display text-3xl tracking-tight">Observatory</h1>
          <p className="mt-2 text-sm text-muted">
            The loop, the policy, the architecture. Trusted gateway, untrusted
            tools, deterministic permission.
          </p>
        </header>

        <section className="rounded-2xl bg-elevated p-5 shadow-[var(--shadow-border)]">
          <h2 className="font-display text-xl">The fused loop</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {[
              ["Channels", "OpenClaw presence"],
              ["Gateway + policy", "Trusted control plane"],
              ["Engine", "Model → tools → repeat"],
              ["Learning loop", "Skill · memory · curator"],
              ["Heartbeat", "Timer with a gated wake"],
              ["Checkpoints", "Rollback the mind"],
            ].map(([title, blurb]) => (
              <div key={title} className="rounded-xl bg-bg px-3 py-3">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted">{blurb}</p>
              </div>
            ))}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Mini label="Skills" value={ws.skills.length} />
            <Mini label="Memories" value={ws.memories.length} />
            <Mini label="Turns" value={ws.messages.filter((m) => m.role === "user").length} />
            <Mini label="Channels" value={channels.length} />
          </dl>
        </section>

        <section>
          <h2 className="mb-3 font-display text-xl">Tool policy</h2>
          <ul className="divide-y divide-border rounded-2xl bg-elevated shadow-[var(--shadow-border)]">
            {TOOL_CATALOG.map((t) => {
              const require = policy.requireApproval.includes(t.name);
              return (
                <li key={t.name} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-fg">{t.name}</p>
                    <p className="truncate text-[11px] text-muted">{t.description}</p>
                  </div>
                  <label className="flex shrink-0 items-center gap-2 text-[11px] text-muted">
                    Approve
                    <Switch
                      checked={require}
                      onCheckedChange={(v) => setPolicy(t.name, v)}
                      aria-label={`Require approval for ${t.name}`}
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h2 className="mb-3 font-display text-xl">Trace</h2>
          <ol className="space-y-2">
            {traces.slice(0, 24).map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 rounded-xl bg-surface px-3 py-2">
                <div>
                  <p className="text-sm">{t.title}</p>
                  {t.detail ? <p className="text-xs text-muted">{t.detail}</p> : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge
                    variant={
                      t.status === "ok" ? "ok" : t.status === "warn" ? "warn" : t.status === "error" ? "danger" : "accent"
                    }
                  >
                    {t.kind}
                  </Badge>
                  <span className="text-[10px] text-subtle tabular-nums">{formatRelative(t.at)}</span>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-2xl bg-elevated p-5 shadow-[var(--shadow-border)]">
          <h2 className="font-display text-xl">Lineage</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Paddy is an independent harness for Irish roots. Ideas from
            OpenClaw (MIT, OpenClaw Foundation) and Hermes Agent (MIT, Nous
            Research) — gateway presence, learning loop, files as identity.
            Not affiliated with, sponsored by, or endorsed by either project.
            No upstream code was copied; names are used to describe lineage
            and pairing, not to ship their software.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            SuperGrok, ChatGPT, Claude, Gemini, OpenRouter, DeepSeek, WhatsApp, Telegram, Slack,
            Discord, and Signal name products we pair with or simulate as
            channels. Keys you paste stay in this browser and are sent only to
            that provider on each turn. Guinness, the harp device, and Paddy Irish Whiskey are
            unrelated marks — the mascot is an original cartoon, not a
            drinks brand. Fonts: IBM Plex and Instrument Serif (SIL OFL).
          </p>
        </section>

        <Button
          variant="outline"
          onClick={() => {
            if (confirm("Reset this browser’s Paddy workspace?")) resetWorkspace();
          }}
        >
          Reset workspace
        </Button>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-bg px-3 py-2">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}
