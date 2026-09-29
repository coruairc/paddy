// Formats CLI command examples with active container/profile hints when they apply.
import { CLI_NAME } from "./cli-name.js";
import { normalizeProfileName } from "./profile-utils.js";

// Matches both the current binary and the retained `openclaw` alias. Accepting
// both keeps this working during the rebrand and for anyone still typing the
// upstream name.
const CLI_PREFIX_RE = /^(?:pnpm|npm|bunx|npx)\s+(?:paddy|openclaw)\b|^(?:paddy|openclaw)\b/;
const CONTAINER_FLAG_RE = /(?:^|\s)--container(?:\s|=|$)/;
const PROFILE_FLAG_RE = /(?:^|\s)--profile(?:\s|=|$)/;
const DEV_FLAG_RE = /(?:^|\s)--dev(?:\s|$)/;
const UPDATE_RE = /^(?:\s+--(?:dev|no-color|(?:profile|log-level)[=\s]+\S+))*\s+update(?:\s|$)/;
const CONTAINER_HINT_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

/** Rewrite an aliased command prefix to the current product name. */
function brandCliPrefix(command: string): string {
  return command.replace(CLI_PREFIX_RE, (match) =>
    match.replace(/\b(?:paddy|openclaw)\b/, CLI_NAME),
  );
}

/** Add active root options to a displayed command without duplicating explicit flags. */
export function formatCliCommand(
  command: string,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string {
  const branded = brandCliPrefix(command);
  const rawContainer = env.OPENCLAW_CONTAINER_HINT?.trim();
  const container = rawContainer && CONTAINER_HINT_RE.test(rawContainer) ? rawContainer : undefined;
  const profile = normalizeProfileName(env.OPENCLAW_PROFILE);
  if (!container && !profile) {
    return branded;
  }
  if (!CLI_PREFIX_RE.test(branded)) {
    return branded;
  }
  const additions: string[] = [];
  if (
    container &&
    !CONTAINER_FLAG_RE.test(branded) &&
    !UPDATE_RE.test(branded.replace(CLI_PREFIX_RE, ""))
  ) {
    additions.push(`--container ${container}`);
  }
  if (!container && profile && !PROFILE_FLAG_RE.test(branded) && !DEV_FLAG_RE.test(branded)) {
    additions.push(`--profile ${profile}`);
  }
  if (additions.length === 0) {
    return branded;
  }
  return branded.replace(CLI_PREFIX_RE, (match) => `${match} ${additions.join(" ")}`);
}
