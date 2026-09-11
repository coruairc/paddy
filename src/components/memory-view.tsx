import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useHelix } from "@/lib/harness/store";
import { relatedForMemory } from "@/lib/harness/related";
import type { MemoryKind } from "@/lib/harness/types";
import { formatRelative } from "@/lib/utils";

const KIND: Record<MemoryKind, "ok" | "accent" | "warn" | "default"> = {
  fact: "default",
  preference: "accent",
  lesson: "ok",
  episode: "warn",
};

export function MemoryView() {
  const memories = useHelix((s) => s.workspaces[s.activeProfileId]!.memories);
  const files = useHelix((s) => s.workspaces[s.activeProfileId]!.files);
  const messages = useHelix((s) => s.workspaces[s.activeProfileId]!.messages);
  const ws = useHelix((s) => s.workspaces[s.activeProfileId]!);
  const [q, setQ] = useState("");

  const hits = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return memories;
    return memories.filter(
      (m) =>
        m.text.toLowerCase().includes(query) || m.kind.includes(query) || m.source.includes(query),
    );
  }, [q, memories]);

  const turns = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    return messages.filter((m) => m.content.toLowerCase().includes(query)).slice(0, 8);
  }, [q, messages]);

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header>
          <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
            Pluggable local provider
          </p>
          <h1 className="mt-1 font-display text-3xl tracking-tight">Memory</h1>
          <p className="mt-2 text-sm text-muted">
            Hermes search over OpenClaw files. Prefetch on turn, sync on write,
            never invent the operator.
          </p>
        </header>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search memory and transcript"
            className="pl-10"
          />
        </div>
        <ul className="space-y-2">
          {hits.map((m) => (
            <li key={m.id} className="rounded-2xl bg-elevated p-4 shadow-[var(--shadow-border)]">
              <div className="flex items-center justify-between gap-2">
                <Badge variant={KIND[m.kind]}>{m.kind}</Badge>
                <span className="text-[11px] text-subtle tabular-nums">
                  {formatRelative(m.at)} · {m.source}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-fg/90">{m.text}</p>
              {relatedForMemory(ws, m).length ? (
                <p className="mt-2 text-[11px] text-muted">
                  Related:{" "}
                  {relatedForMemory(ws, m)
                    .map((r) => `${r.kind === "skill" ? "skill" : "memory"} · ${r.label.slice(0, 48)}`)
                    .join(" · ")}
                </p>
              ) : null}
            </li>
          ))}
          {!hits.length ? (
            <li className="rounded-2xl bg-surface p-6 text-sm text-muted">No matches.</li>
          ) : null}
        </ul>
        {turns.length ? (
          <section>
            <h2 className="mb-2 font-display text-xl">Transcript</h2>
            <ul className="space-y-2">
              {turns.map((m) => (
                <li key={m.id} className="rounded-2xl bg-elevated p-4 shadow-[var(--shadow-border)]">
                  <p className="text-[11px] tracking-wide text-muted uppercase">{m.role}</p>
                  <p className="mt-1 line-clamp-3 text-sm text-fg/90">{m.content}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section>
          <h2 className="mb-2 font-display text-xl">MEMORY.md</h2>
          <pre className="whitespace-pre-wrap rounded-2xl bg-elevated p-4 font-mono text-xs leading-relaxed text-fg/85 shadow-[var(--shadow-border)]">
            {files.memory}
          </pre>
        </section>
      </div>
    </div>
  );
}
