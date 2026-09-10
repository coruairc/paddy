import { Copy, Radio, Send, Terminal } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { INSTALL_PS1_CMD, INSTALL_SH } from "@/lib/harness/install";
import { sendTurn } from "@/lib/harness/send";
import { useHelix } from "@/lib/harness/store";
import type { ChannelStatus } from "@/lib/harness/types";
import { formatRelative } from "@/lib/utils";

const STATUS: Record<ChannelStatus, { label: string; variant: "ok" | "warn" | "danger" | "default" }> = {
  connected: { label: "connected", variant: "ok" },
  idle: { label: "idle", variant: "default" },
  pairing: { label: "pairing", variant: "warn" },
  offline: { label: "offline", variant: "danger" },
};

const CLI_COMMANDS = [
  { cmd: INSTALL_SH, blurb: "macOS / Linux / WSL — clone, npm install, put paddy on PATH." },
  { cmd: INSTALL_PS1_CMD, blurb: "Windows PowerShell — same install." },
  { cmd: "paddy gateway", blurb: "Run the control plane in the foreground." },
  { cmd: "paddy gateway start", blurb: "Background it. stop · restart · status." },
  { cmd: "paddy chat \"remember I prefer terse replies\"", blurb: "One-shot turn against the running gateway." },
];

export function GatewayView() {
  const channels = useHelix((s) => s.channels);
  const lastPulseAt = useHelix((s) => s.lastPulseAt);
  const wakes = useHelix((s) => s.workspaces[s.activeProfileId]!.wakes);
  const firePulse = useHelix((s) => s.firePulse);
  const admitChannel = useHelix((s) => s.admitChannel);
  const admitWake = useHelix((s) => s.admitWake);
  const approvePair = useHelix((s) => s.approvePair);
  const denyPair = useHelix((s) => s.denyPair);
  const busy = useHelix((s) => s.busy);

  async function admit(id: string) {
    const text = admitChannel(id);
    if (!text) return;
    await sendTurn(text, id);
  }

  function pulse() {
    const result = firePulse();
    toast(result.woke ? "Wake gate opened" : "Heartbeat · gate closed", {
      description: result.detail,
    });
  }

  async function wake(id: string) {
    const text = admitWake(id);
    if (!text) return;
    await sendTurn(text);
  }

  const connected = channels.filter((c) => c.status === "connected").length;
  const pending = wakes.filter((w) => !w.fired);

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <header>
          <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
            OpenClaw lineage
          </p>
          <h1 className="mt-1 font-display text-3xl tracking-tight">Gateway</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            One control plane. Unknown senders wait on a pairing code. Heartbeat
            ticks on its own — the timer is not a license to spend.
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          <Stat label="Channels live" value={`${connected}/${channels.length}`} />
          <Stat label="Last pulse" value={formatRelative(lastPulseAt)} />
          <Stat label="Gated wakes" value={String(pending.length)} />
        </section>

        <section className="rounded-2xl bg-elevated p-5 shadow-[var(--shadow-border)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
                CLI
              </p>
              <h2 className="mt-1 font-display text-xl">paddy gateway</h2>
              <p className="mt-1 max-w-md text-sm text-muted">
                One curl (or one PowerShell line) puts Paddy on your machine.
                This preview has no shell — copy a command and run it locally.
              </p>
            </div>
            <Terminal className="size-5 shrink-0 text-accent" />
          </div>
          <ul className="mt-4 space-y-2">
            {CLI_COMMANDS.map((row) => (
              <li
                key={row.cmd}
                className="flex items-start justify-between gap-3 rounded-xl bg-bg px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="font-mono text-sm break-all text-fg">{row.cmd}</p>
                  <p className="mt-0.5 text-xs text-muted">{row.blurb}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => {
                    void navigator.clipboard.writeText(row.cmd);
                    toast("Copied");
                  }}
                >
                  <Copy className="size-3.5" />
                  Copy
                </Button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl bg-elevated p-5 shadow-[var(--shadow-border)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-xl">Heartbeat</h2>
              <p className="mt-1 max-w-md text-sm text-muted">
                Hermes discipline on an OpenClaw timer. Fire a pulse — the model
                wakes only if a watch matches.
              </p>
            </div>
            <Button onClick={pulse} variant="secondary" className="shrink-0">
              <Radio className="size-4" />
              Fire pulse
            </Button>
          </div>
          {pending.length ? (
            <ul className="mt-4 space-y-2">
              {pending.map((w) => (
                <li
                  key={w.id}
                  className="flex flex-col gap-2 rounded-xl bg-bg p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm text-fg">{w.reason}</p>
                    <p className="text-xs text-muted">Due {formatRelative(w.at)}</p>
                  </div>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void wake(w.id)}
                  >
                    Admit wake
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-subtle">No queued wakes. Silence is valid.</p>
          )}
        </section>

        <section>
          <h2 className="mb-3 font-display text-xl">Channels</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {channels.map((ch) => {
              const st = STATUS[ch.status];
              return (
                <li
                  key={ch.id}
                  className="flex flex-col gap-3 rounded-2xl bg-elevated p-4 shadow-[var(--shadow-border)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-medium">{ch.name}</h3>
                      <p className="mt-0.5 text-xs text-muted">{ch.blurb}</p>
                    </div>
                    <Badge variant={st.variant}>{st.label}</Badge>
                  </div>
                  {ch.pendingPair ? (
                    <div className="rounded-xl bg-bg p-3">
                      <p className="text-[11px] tracking-wide text-muted uppercase">
                        Pairing code
                      </p>
                      <p className="mt-1 font-mono text-lg tracking-[0.18em]">{ch.pendingPair.code}</p>
                      <p className="mt-1 text-xs text-muted">
                        {ch.pendingPair.from} is unknown. Approve before anything
                        reaches the model.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="ghost" onClick={() => denyPair(ch.id)}>
                          Deny
                        </Button>
                        <Button size="sm" onClick={() => approvePair(ch.id)}>
                          Approve pair
                        </Button>
                      </div>
                    </div>
                  ) : ch.lastMessage ? (
                    <p className="line-clamp-2 text-sm text-fg/85">
                      <span className="text-muted">{ch.lastMessage.from}: </span>
                      {ch.lastMessage.text}
                    </p>
                  ) : (
                    <p className="text-sm text-subtle">No traffic yet.</p>
                  )}
                  <div className="mt-auto flex items-center justify-between">
                    <span className="text-[11px] text-subtle tabular-nums">
                      {ch.lastMessage ? formatRelative(ch.lastMessage.at) : "—"}
                      {ch.unread ? ` · ${ch.unread} unread` : ""}
                    </span>
                    {ch.lastMessage && ch.id !== "web" && !ch.pendingPair ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void admit(ch.id)}
                      >
                        <Send className="size-3.5" />
                        Admit
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-1 font-mono text-lg tabular-nums text-fg">{value}</p>
    </div>
  );
}
