import { Markdown } from "@/components/markdown";
import type { CanvasCard } from "@/lib/harness/types";
import { formatRelative } from "@/lib/utils";

export function CanvasStack({ cards }: { cards: CanvasCard[] }) {
  if (!cards.length) {
    return (
      <div className="flex h-full min-h-40 flex-col justify-end rounded-xl bg-bg p-4">
        <p className="font-display text-lg text-fg">Canvas is quiet</p>
        <p className="mt-1 text-sm text-muted">
          Structured output lands here — stats, diagrams, briefs. Ask Paddy Irishman to
          draw the loop.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {cards.map((card) => (
        <article
          key={card.id}
          className="rounded-xl bg-bg p-4 shadow-[var(--shadow-border)]"
        >
          <header className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="font-display text-lg tracking-tight">{card.title}</h3>
            <span className="text-[11px] text-subtle tabular-nums">
              {formatRelative(card.at)}
            </span>
          </header>
          {card.kind === "stats" && card.stats?.length ? (
            <dl className="grid grid-cols-2 gap-2">
              {card.stats.map((s) => (
                <div key={s.label} className="rounded-lg bg-elevated px-3 py-2">
                  <dt className="text-[11px] text-muted">{s.label}</dt>
                  <dd className="mt-0.5 font-mono text-sm tabular-nums text-fg">
                    {s.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {card.kind === "diagram" && card.nodes?.length ? (
            <Diagram nodes={card.nodes} edges={card.edges ?? []} />
          ) : null}
          {card.kind === "timeline" ? (
            <ol className="space-y-2">
              {(card.body || "")
                .split("\n")
                .filter(Boolean)
                .map((line, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-accent" />
                    <span className="text-fg/90">{line.replace(/^\d+\.\s*/, "")}</span>
                  </li>
                ))}
            </ol>
          ) : null}
          {card.body && card.kind !== "timeline" ? (
            <Markdown text={card.body} className="mt-2" />
          ) : null}
        </article>
      ))}
    </div>
  );
}

function Diagram({
  nodes,
  edges,
}: {
  nodes: { id: string; label: string }[];
  edges: { from: string; to: string }[];
}) {
  const label = (id: string) => nodes.find((n) => n.id === id)?.label ?? id;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {nodes.map((n) => (
          <span
            key={n.id}
            className="rounded-md bg-elevated px-2.5 py-1 font-mono text-xs text-accent shadow-[var(--shadow-border)]"
          >
            {n.label}
          </span>
        ))}
      </div>
      {edges.length ? (
        <ul className="space-y-1 font-mono text-xs text-muted">
          {edges.map((e, i) => (
            <li key={i}>
              {label(e.from)}
              <span className="mx-2 text-subtle">→</span>
              {label(e.to)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
