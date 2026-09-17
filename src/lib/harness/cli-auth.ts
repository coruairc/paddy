/**
 * Pure gateway control-plane auth helpers (safe for node:test).
 * Server middleware lives in cli-auth.server.ts.
 */
import { timingSafeEqual } from "node:crypto";

export class CliAuthError extends Error {
  readonly status = 401;
  constructor(message: string) {
    super(message);
    this.name = "CliAuthError";
  }
}

export function expectedCliToken(): string {
  return (process.env.PADDY_CLI_TOKEN ?? "").trim();
}

export function gatewayBindIsLoopback(): boolean {
  const bind = (process.env.PADDY_BIND || "127.0.0.1").trim().toLowerCase();
  return bind === "127.0.0.1" || bind === "localhost" || bind === "::1";
}

export function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function bearerFromHeaders(headers: Headers): string {
  const header = headers.get("authorization") ?? "";
  if (header.length >= 7 && header.slice(0, 7).toLowerCase() === "bearer ") {
    return header.slice(7).trim();
  }
  return "";
}

/**
 * Authorize a gateway caller from a Request.
 * - Matching Bearer always wins.
 * - Missing Bearer allowed only when the process binds loopback.
 * - Query-string tokens are never accepted.
 */
export function assertGatewayCallerAuthorized(request: Request): void {
  const want = expectedCliToken();
  if (!want) {
    throw new CliAuthError(
      "CLI chat is locked. Run `paddy gateway` so PADDY_CLI_TOKEN is set, or pass Authorization: Bearer <token>.",
    );
  }
  const got = bearerFromHeaders(request.headers);
  if (got && tokensEqual(got, want)) return;
  if (!got && gatewayBindIsLoopback()) return;
  if (got) {
    throw new CliAuthError(
      "CLI token rejected. Use Authorization: Bearer <token> from ~/.paddy/config.json (paddy gateway sets it).",
    );
  }
  throw new CliAuthError(
    "Authorization Bearer required when the gateway is bound off loopback (PADDY_BIND).",
  );
}

export function cliAuthorized(request: Request): boolean {
  try {
    assertGatewayCallerAuthorized(request);
    return true;
  } catch {
    return false;
  }
}
