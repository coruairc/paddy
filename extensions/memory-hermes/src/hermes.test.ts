import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { registerMemoryCli } from "./cli.js";
import { curateTurn } from "./curator.js";
import { hermesDbPath } from "./paths.js";
import { safeRecall } from "./recall.js";
import { GLOBAL_SCOPE, scopeKey } from "./scope.js";
import { findSecret } from "./secret-filter.js";
import { HermesStore, type MemoryRow } from "./store.js";

function tempDb(): { dir: string; store: HermesStore } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-"));
  return { dir, store: new HermesStore(path.join(dir, "memory.sqlite")) };
}

type CliAction = (...args: unknown[]) => void;
type FakeCommand = {
  command(name: string): FakeCommand;
  description(): FakeCommand;
  argument(): FakeCommand;
  option(): FakeCommand;
  action(fn: CliAction): FakeCommand;
};

// Minimal Commander stand-in: records each subcommand's action handler by name.
function captureCliActions(): Map<string, CliAction> {
  const actions = new Map<string, CliAction>();
  const chain = (name: string): FakeCommand => {
    const node: FakeCommand = {
      command: (child: string) => chain(child),
      description: () => node,
      argument: () => node,
      option: () => node,
      action: (fn: CliAction) => {
        actions.set(name, fn);
        return node;
      },
    };
    return node;
  };
  registerMemoryCli({ command: (name: string) => chain(name) });
  return actions;
}

function approveText(
  store: HermesStore,
  scope: string,
  text: string,
  kind: "memory" | "user" = "memory",
) {
  const proposed = store.propose({ scope, kind, text, source: "test" });
  expect(proposed.ok).toBe(true);
  if (!proposed.ok || !proposed.id) {
    throw new Error("propose failed");
  }
  const approved = store.approve(proposed.id);
  expect(approved.ok).toBe(true);
  return proposed.id;
}

describe("hermes scope", () => {
  it("keeps identities apart and never invents global", () => {
    expect(scopeKey({ channel: "telegram", senderId: "ada" })).toBe("user:telegram:ada");
    expect(scopeKey({ channel: "telegram", senderId: "bob" })).toBe("user:telegram:bob");
    expect(scopeKey({ sessionKey: "sess-1" })).toBe("session:sess-1");
    expect(scopeKey({})).toBe("");
    expect(scopeKey({ senderId: "ada" })).not.toBe(GLOBAL_SCOPE);
  });

  it("does not recall another identity's memory", () => {
    const { store } = tempDb();
    try {
      approveText(store, "user:telegram:ada", "Ada prefers oat milk in tea");
      approveText(store, "user:telegram:bob", "Bob prefers oat milk in coffee");
      const ada = safeRecall(store, "user:telegram:ada", "who prefers oat milk");
      expect(ada).toContain("Ada prefers oat milk");
      expect(ada).not.toContain("Bob");
      expect(safeRecall(store, "", "oat milk")).toBe("");
    } finally {
      store.close();
    }
  });

  it("recalls explicit global memories without promoting a turn into global", () => {
    const { store } = tempDb();
    try {
      approveText(store, GLOBAL_SCOPE, "The office kettle is in the back room");
      approveText(store, "user:slack:ada", "Ada keeps notes in the kettle channel");
      const bob = safeRecall(store, "user:slack:bob", "where is the kettle");
      expect(bob).toContain("back room");
      expect(bob).not.toContain("Ada keeps notes");
    } finally {
      store.close();
    }
  });
});

describe("hermes secrets", () => {
  it("blocks credential-shaped text before it is stored", () => {
    const { store } = tempDb();
    try {
      const secret = "sk-abcdefghijklmnopqrstuvwxyz1234";
      expect(findSecret(`remember ${secret}`)).toBeTruthy();
      const stored = store.propose({
        scope: "user:direct:ada",
        kind: "memory",
        text: `the key is ${secret}`,
        source: "test",
      });
      expect(stored).toEqual({ ok: false, error: "secret" });
      expect(store.list("user:direct:ada")).toEqual([]);
      const curated = curateTurn(store, {
        scope: "user:direct:ada",
        success: true,
        userText: `remember that the key is ${secret}`,
      });
      expect(curated).toEqual({ ok: false, error: "secret" });
      expect(store.list("user:direct:ada")).toEqual([]);
    } finally {
      store.close();
    }
  });
});

describe("hermes promotion", () => {
  it("proposes only explicit remember requests and stays unapproved", () => {
    const { store } = tempDb();
    try {
      const skipped = curateTurn(store, {
        scope: "user:direct:ada",
        success: true,
        userText: "we talked about tea",
      });
      expect(skipped).toEqual({ ok: false, error: "skipped" });
      const proposed = curateTurn(store, {
        scope: "user:direct:ada",
        success: true,
        userText: "remember that the kettle is in the back room",
      });
      expect(proposed.ok).toBe(true);
      const rows = store.list("user:direct:ada");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("proposed");
      expect(safeRecall(store, "user:direct:ada", "where is the kettle")).toBe("");
    } finally {
      store.close();
    }
  });

  it("rolls back one entry without touching another", () => {
    const { store } = tempDb();
    try {
      const tea = approveText(store, "user:direct:ada", "Ada drinks tea");
      const coffee = approveText(store, "user:direct:ada", "Ada drinks coffee");
      const rolled = store.rollback(tea);
      expect(rolled.ok).toBe(true);
      expect(rolled.ok && rolled.row?.status).not.toBe("approved");
      const kept = store.get(coffee);
      expect(kept?.status).toBe("approved");
      expect(kept?.text).toBe("Ada drinks coffee");
      const recall = safeRecall(store, "user:direct:ada", "what does Ada drink");
      expect(recall).toContain("coffee");
      expect(recall).not.toContain("tea");
    } finally {
      store.close();
    }
  });

  it("does not let a recall failure abort the caller", () => {
    const { store } = tempDb();
    try {
      const broken = {
        approvedForRecall(): MemoryRow[] {
          throw new Error("disk");
        },
        logError(op: string, message: string) {
          store.logError(op, message);
        },
      } as unknown as HermesStore;
      expect(safeRecall(broken, "user:direct:ada", "kettle")).toBe("");
      expect(store.recentErrors()[0]?.op).toBe("recall");
    } finally {
      store.close();
    }
  });
});

describe("hermes cli scope and paths", () => {
  it("requires an explicit scope", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-cli-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    const priorExitCode = process.exitCode;
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const actions = captureCliActions();
      const add = actions.get("add");
      if (!add) {
        throw new Error("memory add not registered");
      }

      add("drink more tea", {});
      expect(stderr).toHaveBeenCalledWith("memory add needs --scope or --global\n");
      expect(process.exitCode).toBe(1);
      expect(stdout).not.toHaveBeenCalled();
      process.exitCode = priorExitCode;

      add("drink more tea", { global: true });
      add("drink more coffee", { scope: " user:telegram:ada " });
      const scopes = stdout.mock.calls.map(([chunk]) => {
        const parsed: unknown = JSON.parse(String(chunk));
        return parsed && typeof parsed === "object" && "row" in parsed ? parsed.row : undefined;
      });
      expect(scopes).toEqual([
        expect.objectContaining({ scope: GLOBAL_SCOPE, status: "proposed" }),
        expect.objectContaining({ scope: "user:telegram:ada", status: "proposed" }),
      ]);
    } finally {
      process.exitCode = priorExitCode;
      stdout.mockRestore();
      stderr.mockRestore();
      vi.unstubAllEnvs();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("stores under ~/.paddy unless OPENCLAW_STATE_DIR is set", () => {
    const file = path.join("hermes", "memory.sqlite");
    expect(hermesDbPath({})).toBe(path.join(os.homedir(), ".paddy", file));
    expect(hermesDbPath({ OPENCLAW_STATE_DIR: "/tmp/paddy-state" })).toBe(
      path.join("/tmp/paddy-state", file),
    );
    expect(hermesDbPath({ PADDY_STATE_DIR: "/tmp/ignored" } as NodeJS.ProcessEnv)).toBe(
      path.join(os.homedir(), ".paddy", file),
    );
  });
});
