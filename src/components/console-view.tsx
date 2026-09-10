import { useEffect, useRef, useState } from "react";
import { ArrowUp, LoaderCircle, Sparkles } from "lucide-react";
import { CanvasStack } from "@/components/canvas-panel";
import { HelixMark } from "@/components/helix-mark";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { SUGGESTIONS } from "@/lib/harness/defaults";
import { sendTurn } from "@/lib/harness/send";
import { useHelix } from "@/lib/harness/store";
import type { TraceEvent, TraceKind } from "@/lib/harness/types";
import { cn, formatTime } from "@/lib/utils";

const KIND_LABEL: Record<TraceKind, string> = {
  model: "model",
  tool: "tool",
  memory: "memory",
  skill: "skill",
  compress: "compress",
  wake: "wake",
  checkpoint: "checkpoint",
  permission: "policy",
  gateway: "gateway",
  subagent: "subagent",
};

export function ConsoleView() {
  const ws = useHelix((s) => s.workspaces[s.activeProfileId]!);
  const busy = useHelix((s) => s.busy);
  const inspector = useHelix((s) => s.inspector);
  const setInspector = useHelix((s) => s.setInspector);
  const profile = useHelix((s) => s.profiles.find((p) => p.id === s.activeProfileId));
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [ws.messages.length, busy]);

  async function submit(text?: string) {
    const value = (text ?? draft).trim();
    if (!value || busy) return;
    setDraft("");
    await sendTurn(value);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          {ws.messages.length === 0 ? (
            <EmptyState onPick={submit} busy={busy} name={profile?.name ?? "Paddy"} />
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-6">
              {ws.messages.map((m) => (
                <article key={m.id} className="rise-in">
                  {m.role === "user" ? (
                    <div className="flex justify-end">
                      <div className="max-w-[min(100%,36rem)] rounded-2xl rounded-br-md bg-elevated px-4 py-3 shadow-[var(--shadow-border)]">
                        <p className="text-sm leading-relaxed text-fg">{m.content}</p>
                        <p className="mt-1.5 text-right text-[11px] text-subtle tabular-nums">
                          {m.channelId && m.channelId !== "web" ? `${m.channelId} · ` : ""}
                          {formatTime(m.at)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <HelixMark className="mt-1 size-7 shrink-0 text-accent" />
                      <div className="min-w-0 flex-1">
                        <p className="mb-1 text-[11px] font-medium tracking-wide text-muted uppercase">
                          {profile?.name ?? "Paddy"}
                        </p>
                        <Markdown text={m.content} />
                      </div>
                    </div>
                  )}
                </article>
              ))}
              {busy ? (
                <div className="flex items-center gap-3 text-muted">
                  <HelixMark spinning className="size-6 text-accent" />
                  <span className="shimmer-text text-sm">Running the loop</span>
                </div>
              ) : null}
              <div ref={endRef} />
            </div>
          )}
        </div>
        {ws.traces[0] ? (
          <p className="truncate border-t border-border px-4 py-1.5 text-[11px] text-muted lg:hidden">
            {ws.traces[0].title}
            {ws.traces[0].detail ? ` · ${ws.traces[0].detail}` : ""}
          </p>
        ) : null}
        <form
          className="border-t border-border px-3 py-3 sm:px-6"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl bg-elevated p-2 shadow-[var(--shadow-border)]">
            <textarea
              ref={boxRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={1}
              placeholder="Message Paddy"
              className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm text-fg placeholder:text-subtle focus:outline-none"
            />
            <Button
              type="submit"
              size="icon"
              disabled={busy || !draft.trim()}
              aria-label="Send"
            >
              {busy ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <ArrowUp />
              )}
            </Button>
          </div>
          <p className="mx-auto mt-2 max-w-2xl px-2 text-[11px] text-subtle">
            Enter to send · Shift+Enter for a line · tools write to this workspace
          </p>
        </form>
      </section>

      <aside className="hidden min-h-0 w-[22rem] shrink-0 flex-col border-l border-border bg-surface lg:flex">
        <div className="flex gap-1 border-b border-border p-2">
          {(["loop", "canvas", "context"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setInspector(tab)}
              className={cn(
                "flex-1 rounded-lg py-2 text-xs font-medium capitalize transition-colors",
                inspector === tab ? "bg-elevated text-fg" : "text-muted hover:text-fg",
              )}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
          {inspector === "loop" ? (
            <TraceList traces={ws.traces} />
          ) : inspector === "canvas" ? (
            <CanvasStack cards={ws.canvas} />
          ) : (
            <ContextPane
              soul={ws.files.soul}
              user={ws.files.user}
              skillCount={ws.skills.length}
              memCount={ws.memories.length}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

function EmptyState({
  onPick,
  busy,
  name,
}: {
  onPick: (text: string) => void;
  busy: boolean;
  name: string;
}) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 pt-4 sm:pt-10">
      <div className="rise-in">
        <HelixMark className="size-20 text-accent" />
        <h1 className="mt-5 font-display text-4xl tracking-tight sm:text-5xl">{name}</h1>
        <p className="mt-2 text-sm text-muted">Irish roots. One gateway. Many minds.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rise-in stagger-1 rounded-2xl bg-elevated p-4 shadow-[var(--shadow-border)]">
          <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
            Presence
          </p>
          <p className="mt-2 text-sm leading-relaxed text-fg/90">
            Gateway, channels, heartbeat, live canvas, identity files.
          </p>
        </div>
        <div className="rise-in stagger-2 rounded-2xl bg-elevated p-4 shadow-[var(--shadow-border)]">
          <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
            Discipline
          </p>
          <p className="mt-2 text-sm leading-relaxed text-fg/90">
            Learning loop, curator, checkpoints, gated wake, profiles.
          </p>
        </div>
        <div className="rise-in stagger-3 rounded-2xl bg-elevated p-4 shadow-[var(--shadow-border)] sm:col-span-2">
          <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
            Skills × models
          </p>
          <p className="mt-2 text-sm leading-relaxed text-fg/90">
            Browse the local catalog. Sign in with ChatGPT or paste a Claude
            setup-token in Models — or download Paddy and run it at home.
          </p>
        </div>
      </div>
      <div className="rise-in stagger-4 flex flex-col gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => onPick(s)}
            className="flex items-start gap-3 rounded-xl bg-surface px-4 py-3 text-left text-sm text-fg/90 shadow-[var(--shadow-border)] transition-colors hover:bg-elevated"
          >
            <Sparkles className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>{s}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TraceList({ traces }: { traces: TraceEvent[] }) {
  if (!traces.length) {
    return <p className="p-2 text-sm text-muted">The loop is idle.</p>;
  }
  return (
    <ol className="space-y-2">
      {traces.map((t) => (
        <li key={t.id} className="rounded-lg bg-bg px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] tracking-wide text-accent uppercase">
              {KIND_LABEL[t.kind]}
            </span>
            <span
              className={cn(
                "size-1.5 rounded-full",
                t.status === "ok" && "bg-ok",
                t.status === "warn" && "bg-warn",
                t.status === "error" && "bg-danger",
                t.status === "pending" && "bg-accent pulse-live",
              )}
            />
          </div>
          <p className="mt-1 text-sm text-fg">{t.title}</p>
          {t.detail ? <p className="mt-0.5 text-xs text-muted leading-relaxed">{t.detail}</p> : null}
        </li>
      ))}
    </ol>
  );
}

function ContextPane({
  soul,
  user,
  skillCount,
  memCount,
}: {
  soul: string;
  user: string;
  skillCount: number;
  memCount: number;
}) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-bg px-3 py-2">
          <dt className="text-[11px] text-muted">Skills</dt>
          <dd className="font-mono text-sm tabular-nums">{skillCount}</dd>
        </div>
        <div className="rounded-lg bg-bg px-3 py-2">
          <dt className="text-[11px] text-muted">Memories</dt>
          <dd className="font-mono text-sm tabular-nums">{memCount}</dd>
        </div>
      </dl>
      <section>
        <h3 className="mb-1 text-[11px] font-medium tracking-wide text-muted uppercase">Soul</h3>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-3 font-mono text-[11px] leading-relaxed text-fg/80">
          {soul}
        </pre>
      </section>
      <section>
        <h3 className="mb-1 text-[11px] font-medium tracking-wide text-muted uppercase">User</h3>
        <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-3 font-mono text-[11px] leading-relaxed text-fg/80">
          {user}
        </pre>
      </section>
    </div>
  );
}
