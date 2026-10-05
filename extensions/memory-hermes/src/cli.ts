import { hermesDbPath } from "./paths.js";
import { GLOBAL_SCOPE } from "./scope.js";
import { HermesStore, isMemoryStatus } from "./store.js";

type CommandChain = {
  command(name: string): CommandChain;
  description(text: string): CommandChain;
  argument(name: string, description?: string): CommandChain;
  option(flags: string, description?: string): CommandChain;
  // Commander passes positional arguments, then the parsed options; handlers narrow them below.
  action(fn: (...args: unknown[]) => void): CommandChain;
};

type ScopeOpts = { scope?: string; global?: boolean };

function optionsFrom(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}

function scopeOptsFrom(value: unknown): ScopeOpts {
  const opts = optionsFrom(value);
  return {
    scope: typeof opts.scope === "string" ? opts.scope : undefined,
    global: opts.global === true,
  };
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function withStore(fn: (db: HermesStore) => void): void {
  const db = new HermesStore(hermesDbPath());
  try {
    fn(db);
  } finally {
    db.close();
  }
}

/** Explicit only. No shared fallback identity. */
function resolveCliScope(opts: ScopeOpts): string | null {
  if (opts.global) {
    return GLOBAL_SCOPE;
  }
  const scope = opts.scope?.trim();
  return scope || null;
}

export function registerMemoryCli(program: { command(name: string): CommandChain }): void {
  const memory = program.command("memory").description("Hermes memory (scoped SQLite)");

  memory
    .command("status")
    .description("Usage, caps, and recent fail-open errors")
    .option("--scope <scope>", "Scope key")
    .option("--global", "Instance-wide namespace")
    .action((rawOpts) => {
      withStore((db) => {
        const scope = resolveCliScope(scopeOptsFrom(rawOpts));
        process.stdout.write(
          `${JSON.stringify(
            {
              scope,
              usage: scope ? db.usage(scope) : null,
              errors: db.recentErrors(),
              ...(scope ? {} : { hint: "pass --scope or --global for usage" }),
            },
            null,
            2,
          )}\n`,
        );
      });
    });

  memory
    .command("list")
    .description("List memories in one explicit scope")
    .option("--scope <scope>", "Scope key")
    .option("--global", "Instance-wide namespace")
    .option("--status <status>", "proposed | approved | rejected")
    .action((rawOpts) => {
      const scope = resolveCliScope(scopeOptsFrom(rawOpts));
      if (!scope) {
        process.stderr.write("memory list needs --scope or --global\n");
        process.exitCode = 1;
        return;
      }
      const rawStatus = optionsFrom(rawOpts).status;
      if (rawStatus !== undefined && !isMemoryStatus(rawStatus)) {
        process.stderr.write("memory list --status must be proposed, approved, or rejected\n");
        process.exitCode = 1;
        return;
      }
      withStore((db) => {
        process.stdout.write(`${JSON.stringify(db.list(scope, rawStatus), null, 2)}\n`);
      });
    });

  for (const name of ["approve", "reject", "rollback"] as const) {
    memory
      .command(name)
      .description(`${name} one memory entry`)
      .argument("<id>", "Memory id")
      .action((rawId) => {
        const id = stringArg(rawId);
        withStore((db) => {
          const result =
            name === "approve"
              ? db.approve(id)
              : name === "reject"
                ? db.reject(id)
                : db.rollback(id);
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          if (!result.ok) {
            process.exitCode = 1;
          }
        });
      });
  }

  memory
    .command("add")
    .description("Propose a memory. Still needs approve. Global only with --global.")
    .argument("<text>", "Fact to propose")
    .option("--global", "Instance-wide namespace. Never implied.")
    .option("--scope <scope>", "Explicit scope")
    .action((rawText, rawOpts) => {
      const text = stringArg(rawText);
      const scope = resolveCliScope(scopeOptsFrom(rawOpts));
      if (!scope) {
        process.stderr.write("memory add needs --scope or --global\n");
        process.exitCode = 1;
        return;
      }
      withStore((db) => {
        const result = db.propose({ scope, kind: "memory", text, source: "cli" });
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (!result.ok) {
          process.exitCode = 1;
        }
      });
    });
}
