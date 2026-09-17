import { useEffect, useState } from "react";
import { HelixMark } from "@/components/helix-mark";
import { cn } from "@/lib/utils";

export type PaddyIdleMove = "pint" | "jig" | "gold";

const MOVES: { id: PaddyIdleMove; caption: string }[] = [
  { id: "pint", caption: "Downing a pint. Chat when you're ready." },
  { id: "jig", caption: "Irish dancing. Drop a message to join in." },
  { id: "gold", caption: "Pulling a pot of gold. Ask him anything." },
];

const IDLE_CAPTION = "Standing by. Chat when you're ready.";

function pickMove(): PaddyIdleMove {
  return MOVES[Math.floor(Math.random() * MOVES.length)]!.id;
}

export function PaddyIdle({
  name,
  className,
  move: forced,
}: {
  name: string;
  className?: string;
  /** Override for tests / Storybook; otherwise random after mount. */
  move?: PaddyIdleMove;
}) {
  // Static on SSR / first paint; randomize only after mount to avoid hydration mismatch.
  const [move, setMove] = useState<PaddyIdleMove | null>(forced ?? null);

  useEffect(() => {
    if (forced !== undefined) {
      setMove(forced);
      return;
    }
    setMove(pickMove());
  }, [forced]);

  const caption =
    move === null
      ? IDLE_CAPTION
      : (MOVES.find((m) => m.id === move)?.caption ?? IDLE_CAPTION);

  return (
    <div
      className={cn(
        "mx-auto flex max-w-md flex-col items-center gap-6 pt-8 text-center sm:pt-16",
        className,
      )}
    >
      <div
        className={cn(
          "paddy-idle-stage rise-in",
          move ? `paddy-idle--${move}` : "paddy-idle--idle",
        )}
        aria-hidden
      >
        <div className="paddy-idle-figure">
          <HelixMark className="size-28 text-accent sm:size-36" />
        </div>
        {move === "pint" ? (
          <span className="paddy-idle-prop paddy-idle-pint" aria-hidden>
            🍺
          </span>
        ) : null}
        {move === "gold" ? (
          <>
            <span className="paddy-idle-prop paddy-idle-pot" aria-hidden>
              💰
            </span>
            <span className="paddy-idle-prop paddy-idle-coin paddy-idle-coin-a" aria-hidden>
              🪙
            </span>
            <span className="paddy-idle-prop paddy-idle-coin paddy-idle-coin-b" aria-hidden>
              🪙
            </span>
            <span className="paddy-idle-prop paddy-idle-coin paddy-idle-coin-c" aria-hidden>
              🪙
            </span>
          </>
        ) : null}
        {move === "jig" ? (
          <span className="paddy-idle-prop paddy-idle-notes" aria-hidden>
            ♪
          </span>
        ) : null}
      </div>
      <div className="rise-in stagger-2">
        <h1 className="font-display text-4xl tracking-tight sm:text-5xl">{name}</h1>
        <p className="mt-3 text-sm text-muted">{caption}</p>
      </div>
    </div>
  );
}
