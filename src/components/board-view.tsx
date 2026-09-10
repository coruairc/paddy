import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHelix } from "@/lib/harness/store";
import type { Ticket, TicketStatus } from "@/lib/harness/types";
import { cn, formatRelative } from "@/lib/utils";

const COLS: { id: TicketStatus; label: string; hint: string }[] = [
  { id: "backlog", label: "Backlog", hint: "Queued" },
  { id: "doing", label: "Doing", hint: "In flight" },
  { id: "done", label: "Done", hint: "Landed" },
];

export function BoardView() {
  const profile = useHelix((s) => s.profiles.find((p) => p.id === s.activeProfileId));
  const tickets = useHelix((s) => s.workspaces[s.activeProfileId]!.tickets ?? []);
  const addTicket = useHelix((s) => s.addTicket);
  const moveTicket = useHelix((s) => s.moveTicket);
  const removeTicket = useHelix((s) => s.removeTicket);
  const [title, setTitle] = useState("");

  function submit() {
    if (!title.trim()) return;
    addTicket(title);
    setTitle("");
  }

  const name = profile?.id === "paddy" ? "Paddy" : (profile?.name ?? "Paddy");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border px-4 py-4 sm:px-6">
        <p className="text-xs font-medium tracking-wide text-accent uppercase">Kanban</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">{name}’s board</h1>
        <p className="mt-1 text-sm text-muted">
          This mind’s tickets. Ask in Console to create or move them — or add one here.
        </p>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New ticket"
            autoComplete="off"
            className="max-w-sm"
          />
          <Button type="submit" disabled={!title.trim()}>
            <Plus className="size-4" />
            Add
          </Button>
        </form>
      </header>
      <div className="scrollbar-thin flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 py-4 sm:px-6">
        {COLS.map((col) => {
          const cards = tickets.filter((t) => t.status === col.id);
          return (
            <section
              key={col.id}
              className="flex w-72 shrink-0 flex-col rounded-2xl bg-surface p-3 shadow-[var(--shadow-border)]"
            >
              <div className="mb-3 flex items-baseline justify-between px-1">
                <h2 className="text-sm font-medium text-fg">{col.label}</h2>
                <p className="font-mono text-xs tabular-nums text-muted">{cards.length}</p>
              </div>
              <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                {cards.length === 0 ? (
                  <li className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-xs text-subtle">
                    {col.hint}
                  </li>
                ) : (
                  cards.map((t) => (
                    <TicketCard
                      key={t.id}
                      ticket={t}
                      onMove={(status) => moveTicket(t.id, status)}
                      onRemove={() => removeTicket(t.id)}
                    />
                  ))
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TicketCard({
  ticket,
  onMove,
  onRemove,
}: {
  ticket: Ticket;
  onMove: (status: TicketStatus) => void;
  onRemove: () => void;
}) {
  return (
    <li className="rounded-xl bg-elevated p-3 shadow-[var(--shadow-border)]">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm text-fg">{ticket.title}</p>
        <button
          type="button"
          aria-label="Remove ticket"
          onClick={onRemove}
          className="rounded-md p-1 text-subtle hover:bg-surface hover:text-danger"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {ticket.body ? (
        <p className="mt-1 text-xs leading-relaxed text-muted">{ticket.body}</p>
      ) : null}
      <p className="mt-2 text-[11px] text-subtle">{formatRelative(ticket.updatedAt)}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {COLS.filter((c) => c.id !== ticket.status).map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onMove(c.id)}
            className={cn(
              "rounded-md px-2 py-1 text-[11px] text-muted hover:bg-surface hover:text-fg",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
    </li>
  );
}
