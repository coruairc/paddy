import { useState } from "react";
import { KeyRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  clearCliAuthNeeded,
  clearCliToken,
  setCliToken,
  useCliTokenSession,
} from "@/lib/harness/cli-token";

/** Paste/dev-only CLI token bar. Token stays in memory for this tab session. */
export function CliTokenBar() {
  const { authNeeded, hasToken } = useCliTokenSession();
  const [draft, setDraft] = useState("");

  if (!authNeeded && !hasToken) return null;

  return (
    <div className="border-b border-border bg-elevated px-3 py-2 sm:px-4">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2">
        <KeyRound className="size-4 shrink-0 text-accent" aria-hidden />
        <p className="min-w-0 flex-1 text-xs text-muted sm:text-sm">
          {hasToken
            ? "CLI token set for this session (not saved to disk)."
            : "Gateway needs Authorization Bearer — paste PADDY_CLI_TOKEN from ~/.paddy/config.json."}
        </p>
        {hasToken ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              clearCliToken();
              setDraft("");
            }}
          >
            Clear
          </Button>
        ) : (
          <>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="PADDY_CLI_TOKEN"
              className="h-8 max-w-[14rem] font-mono text-xs"
              aria-label="CLI token"
            />
            <Button
              type="button"
              size="sm"
              disabled={!draft.trim()}
              onClick={() => {
                setCliToken(draft);
                setDraft("");
                clearCliAuthNeeded();
              }}
            >
              Use token
            </Button>
          </>
        )}
        {authNeeded ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Dismiss"
            onClick={() => clearCliAuthNeeded()}
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
