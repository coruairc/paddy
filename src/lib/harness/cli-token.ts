/**
 * In-memory session/dev CLI token for gated createServerFn calls.
 * Paste/dev-only — never write to localStorage or zustand persist.
 */
import { useSyncExternalStore } from "react";

let cliToken = "";
let authNeeded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getCliToken(): string {
  return cliToken;
}

export function setCliToken(token: string): void {
  cliToken = token.trim();
  if (cliToken) authNeeded = false;
  emit();
}

export function clearCliToken(): void {
  cliToken = "";
  emit();
}

export function markCliAuthNeeded(): void {
  authNeeded = true;
  emit();
}

export function clearCliAuthNeeded(): void {
  authNeeded = false;
  emit();
}

export function isCliAuthNeeded(): boolean {
  return authNeeded;
}

export const CLI_AUTH_NEEDED_MESSAGE =
  "Gateway auth required. Paste your PADDY_CLI_TOKEN (from ~/.paddy/config.json after `paddy gateway`).";

/** Detect CliAuthError / 401 without importing server-only modules. */
export function isCliAuthFailure(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    name?: string;
    message?: string;
    status?: number;
    statusCode?: number;
    data?: { status?: number; name?: string; message?: string };
  };
  if (e.name === "CliAuthError" || e.data?.name === "CliAuthError") return true;
  if (e.status === 401 || e.statusCode === 401 || e.data?.status === 401) return true;
  const msg = `${e.message ?? ""} ${e.data?.message ?? ""}`;
  return /CLI chat is locked|CLI token rejected|Authorization Bearer required|PADDY_CLI_TOKEN|Bearer <token>/i.test(
    msg,
  );
}

export function messageForCliAuthFailure(err: unknown): string {
  if (!isCliAuthFailure(err)) {
    return err instanceof Error ? err.message : "Request failed";
  }
  const raw = err instanceof Error ? err.message : CLI_AUTH_NEEDED_MESSAGE;
  if (/Bearer\s+[A-Za-z0-9._-]{8,}/i.test(raw) || /PADDY_CLI_TOKEN\s*=\s*\S+/i.test(raw)) {
    return CLI_AUTH_NEEDED_MESSAGE;
  }
  return raw || CLI_AUTH_NEEDED_MESSAGE;
}

type Snapshot = { authNeeded: boolean; hasToken: boolean };

function getSnapshot(): Snapshot {
  return { authNeeded, hasToken: Boolean(cliToken) };
}

function getServerSnapshot(): Snapshot {
  return { authNeeded: false, hasToken: false };
}

export function useCliTokenSession(): Snapshot {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    getSnapshot,
    getServerSnapshot,
  );
}
