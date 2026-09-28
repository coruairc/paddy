import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { curateTurn } from "./src/curator.js";
import { hermesDbPath } from "./src/paths.js";
import { safeRecall } from "./src/recall.js";
import { scopeKey, type ScopeInput } from "./src/scope.js";
import { HermesStore } from "./src/store.js";

function userTextFrom(messages: unknown, fallback: string): string {
  if (!Array.isArray(messages)) {
    return fallback;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || typeof message !== "object") {
      continue;
    }
    const record = message as { role?: string; content?: unknown };
    if (record.role && record.role !== "user") {
      continue;
    }
    if (typeof record.content === "string" && record.content.trim()) {
      return record.content;
    }
  }
  return fallback;
}

function open(): HermesStore | null {
  try {
    return new HermesStore(hermesDbPath());
  } catch (err) {
    process.stderr.write(
      `memory-hermes: store unavailable: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return null;
  }
}

function scopeFromTurn(input: ScopeInput): string {
  return scopeKey(input);
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export default definePluginEntry({
  id: "memory-hermes",
  name: "Hermes Memory",
  description: "Scoped SQLite recall, curator proposals, and human promotion",
  kind: "memory",
  register(api) {
    api.registerMemoryCapability({
      deterministicRecallToolName: "memory_search",
      promptBuilder: () => [
        "Hermes memory is on. Approved memories for this identity are injected when relevant. New facts stay proposals until `openclaw memory approve`.",
      ],
    });

    api.registerTool(
      (ctx) => ({
        name: "memory_search",
        label: "Memory search",
        description: "Search approved Hermes memories visible to this identity.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
        execute: async (_toolCallId: string, params: unknown) => {
          const db = open();
          if (!db) {
            return textResult("");
          }
          try {
            const query =
              params && typeof params === "object" && "query" in params ? String(params.query ?? "") : "";
            const text = safeRecall(
              db,
              scopeFromTurn({
                senderId: ctx.requesterSenderId,
                channel: ctx.messageChannel,
                sessionKey: ctx.sessionKey,
                agentId: ctx.agentId,
              }),
              query,
            );
            return textResult(text);
          } finally {
            db.close();
          }
        },
      }),
      { names: ["memory_search"] },
    );

    api.registerTool(
      (ctx) => ({
        name: "memory_get",
        label: "Memory get",
        description: "Read one approved Hermes memory if it belongs to this identity.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string" },
          },
          required: ["id"],
        },
        execute: async (_toolCallId: string, params: unknown) => {
          const db = open();
          if (!db) {
            return textResult("");
          }
          try {
            const id =
              params && typeof params === "object" && "id" in params && params.id != null
                ? String(params.id)
                : "";
            const scope = scopeFromTurn({
              senderId: ctx.requesterSenderId,
              channel: ctx.messageChannel,
              sessionKey: ctx.sessionKey,
              agentId: ctx.agentId,
            });
            const row = id ? db.get(id) : undefined;
            if (!row || row.status !== "approved" || (row.scope !== scope && row.scope !== "global")) {
              return textResult("");
            }
            return textResult(row.text);
          } catch (err) {
            db.logError("recall", err instanceof Error ? err.message : String(err));
            return textResult("");
          } finally {
            db.close();
          }
        },
      }),
      { names: ["memory_get"] },
    );

    api.on("before_prompt_build", (event, ctx) => {
      const db = open();
      if (!db) {
        return undefined;
      }
      try {
        const scope = scopeFromTurn({
          senderId: ctx.senderId,
          channel: ctx.channel,
          sessionKey: ctx.sessionKey,
          agentId: ctx.agentId,
        });
        const block = safeRecall(db, scope, event.prompt || event.currentUserMessage || "");
        return block ? { prependContext: block } : undefined;
      } catch (err) {
        db.logError("recall", err instanceof Error ? err.message : String(err));
        return undefined;
      } finally {
        db.close();
      }
    });

    api.on("agent_end", (event, ctx) => {
      if (!event.success) {
        return;
      }
      const db = open();
      if (!db) {
        return;
      }
      try {
        const scope = scopeFromTurn({
          senderId: ctx.senderId,
          channel: ctx.channel,
          sessionKey: ctx.sessionKey,
          agentId: ctx.agentId,
        });
        if (!scope) {
          return;
        }
        curateTurn(db, {
          scope,
          success: true,
          userText: userTextFrom(event.messages, ""),
          source: "curator",
        });
      } catch (err) {
        db.logError("curator", err instanceof Error ? err.message : String(err));
      } finally {
        db.close();
      }
    });

    api.registerCli(
      async ({ program }) => {
        const { registerMemoryCli } = await import("./src/cli.js");
        registerMemoryCli(program);
      },
      {
        descriptors: [
          {
            name: "memory",
            description: "Inspect, approve, reject, and roll back Hermes memories",
            hasSubcommands: true,
          },
        ],
      },
    );
  },
});
