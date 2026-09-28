import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCliScope } from "./cli.js";
import { curateTurn, extractProposal } from "./curator.js";
import { resolveHermesStateDir } from "./paths.js";
import { safeRecall } from "./recall.js";
import { GLOBAL_SCOPE, scopeKey } from "./scope.js";
import { findSecret } from "./secret-filter.js";
import { HermesStore, type MemoryRow } from "./store.js";

function tempDb(): { dir: string; store: HermesStore } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-"));
  return { dir, store: new HermesStore(path.join(dir, "memory.sqlite")) };
}

function approveText(store: HermesStore, scope: string, text: string, kind: "memory" | "user" = "memory") {
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
      expect(extractProposal("we talked about tea")).toBeNull();
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
    expect(resolveCliScope({})).toBeNull();
    expect(resolveCliScope({ global: true })).toBe(GLOBAL_SCOPE);
    expect(resolveCliScope({ scope: "user:telegram:ada" })).toBe("user:telegram:ada");
  });

  it("stores under ~/.paddy unless OPENCLAW_STATE_DIR is set", () => {
    expect(resolveHermesStateDir({})).toBe(path.join(os.homedir(), ".paddy"));
    expect(resolveHermesStateDir({ OPENCLAW_STATE_DIR: "/tmp/paddy-state" })).toBe(
      "/tmp/paddy-state",
    );
    expect(resolveHermesStateDir({ PADDY_STATE_DIR: "/tmp/ignored" } as NodeJS.ProcessEnv)).toBe(
      path.join(os.homedir(), ".paddy"),
    );
  });
});
