import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useHelix } from "@/lib/harness/store";
import { formatRelative } from "@/lib/utils";

export function CheckpointsView() {
  const checkpoints = useHelix((s) => s.workspaces[s.activeProfileId]!.checkpoints);
  const rollback = useHelix((s) => s.rollback);
  const manualCheckpoint = useHelix((s) => s.manualCheckpoint);

  return (
    <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium tracking-wide text-accent uppercase">
              Hermes lineage
            </p>
            <h1 className="mt-1 font-display text-3xl tracking-tight">Checkpoints</h1>
            <p className="mt-2 text-sm text-muted">
              Snapshot the mind before a risky edit. Roll back files, skills,
              and memory — not the gateway.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              manualCheckpoint(`Manual ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
              toast("Checkpoint saved");
            }}
          >
            Snapshot now
          </Button>
        </header>
        <ol className="space-y-2">
          {checkpoints.map((ck, i) => (
            <li
              key={ck.id}
              className="flex items-center justify-between gap-3 rounded-2xl bg-elevated p-4 shadow-[var(--shadow-border)]"
            >
              <div>
                <p className="text-sm font-medium">{ck.label}</p>
                <p className="text-xs text-muted tabular-nums">
                  {formatRelative(ck.at)}
                  {i === 0 ? " · latest" : ""}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  rollback(ck.id);
                  toast(`Rolled back to ${ck.label}`);
                }}
              >
                Restore
              </Button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
