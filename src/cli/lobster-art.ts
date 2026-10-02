import { expectDefined } from "@openclaw/normalization-core";
// On roughly one day in sixteen the interactive banner adds a small drawing:
// a four-leaf clover, or a pint. The day still comes from the shared
// lobster-day hash (the sidebar pet uses the same calendar), so every surface
// agrees on the date and tests can pin it.
import { isLobsterDay, lobsterDayHash } from "../shared/lobster-day.js";

const LOBSTER_ARTS: readonly string[] = [
  // Four-leaf clover. The day still comes from the shared calendar hash.
  ["    (@@) (@@)", "   (@@@@@@@@)", "    (@@) (@@)", "       ||"].join("\n"),
  // Pint. Same calendar, the other drawing.
  ["    .~~~~.", "    |    |", "    |    |", "    `----'"].join("\n"),
] as const;

/**
 * Return the clover or pint for `now`'s calendar day, or null on ordinary
 * days and in CI/test environments (banner tests assert exact bytes).
 */
export function pickCliLobsterArt(now: Date, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.CI || env.VITEST) {
    return null;
  }
  if (!isLobsterDay(now)) {
    return null;
  }
  return expectDefined(
    LOBSTER_ARTS[(lobsterDayHash(now) >>> 8) % LOBSTER_ARTS.length],
    "lobster arts entry at (lobster day hash(now) >>> 8) % lobster arts.length",
  );
}
