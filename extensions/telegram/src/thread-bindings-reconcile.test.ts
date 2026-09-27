import { getSessionBindingService } from "openclaw/plugin-sdk/conversation-runtime";
import { createDeferred } from "openclaw/plugin-sdk/extension-shared";
import { describe, expect, it, vi } from "vitest";
import { acpHost, useTelegramThreadBindingsFixture } from "./thread-bindings.test-support.js";

const { getTelegramThreadBindingManager } = await import("./thread-bindings.js");

const readAcpSessionEntryAsyncMock = acpHost.read;

describe("telegram thread binding startup reconciliation", () => {
  const fixture = useTelegramThreadBindingsFixture();
  const { createManager: createTelegramThreadBindingManager, storedBindings } = fixture;

  it.each(["acp", "subagent", "plugin"] as const)(
    "starts with persisted %s bindings without async host metadata reads",
    async (kind) => {
      const params = { accountId: "default", persist: true, enableSweeper: false };
      const manager = await createTelegramThreadBindingManager(params);
      const targetSessionKey =
        kind === "plugin" ? "plugin-binding:owner:retained" : `agent:main:${kind}:retained`;
      await getSessionBindingService().bind({
        targetSessionKey,
        targetKind: kind === "subagent" ? "subagent" : "session",
        conversation: {
          channel: "telegram",
          accountId: "default",
          conversationId: "retained-thread",
        },
      });
      const persisted = await storedBindings();
      expect(persisted).toHaveLength(1);
      await manager.stop();
      acpHost.readerAvailable = false;
      const remove = vi.spyOn(fixture.store, "delete");
      const register = vi.spyOn(fixture.store, "register");

      const reloaded = await createTelegramThreadBindingManager(params);

      expect(getTelegramThreadBindingManager("default")).toBe(reloaded);
      expect(reloaded.getByConversationId("retained-thread")?.targetSessionKey).toBe(
        targetSessionKey,
      );
      expect(await storedBindings()).toEqual(persisted);
      expect(acpHost.read).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
      expect(acpHost.warn).toHaveBeenCalledTimes(kind === "acp" ? 1 : 0);
      if (kind === "acp") {
        expect(acpHost.warn).toHaveBeenCalledWith(
          expect.stringContaining("Upgrade the OpenClaw host"),
        );
      }
    },
  );

  it("cleans up stale ACP bindings before restart routing can reuse them", async () => {
    const manager = await createTelegramThreadBindingManager({
      accountId: "default",
      persist: true,
      enableSweeper: false,
    });

    await getSessionBindingService().bind({
      targetSessionKey: "agent:main:acp:stale-1",
      targetKind: "session",
      conversation: {
        channel: "telegram",
        accountId: "default",
        conversationId: "cleanup-me",
      },
    });

    await manager.stop();
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    readAcpSessionEntryAsyncMock.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return {
        cfg: {} as never,
        storePath: "/tmp/acp-store.json",
        sessionKey: "agent:main:acp:stale-1",
        storeSessionKey: "agent:main:acp:stale-1",
        entry: undefined,
        acp: undefined,
        storeReadFailed: false,
      };
    });

    const pending = createTelegramThreadBindingManager({
      accountId: "default",
      persist: true,
      enableSweeper: false,
    });
    await entered.promise;
    expect(getTelegramThreadBindingManager("default")).toBeNull();
    release.resolve();
    const reloaded = await pending;

    expect(reloaded.getByConversationId("cleanup-me")).toBeUndefined();
    expect((await storedBindings()).map((binding) => binding.conversationId)).not.toContain(
      "cleanup-me",
    );
  });

  it("keeps plugin-owned bindings when ACP cleanup runs on startup", async () => {
    const manager = await createTelegramThreadBindingManager({
      accountId: "default",
      persist: true,
      enableSweeper: false,
    });

    await getSessionBindingService().bind({
      targetSessionKey: "plugin-binding:openclaw-codex-app-server:still-valid",
      targetKind: "session",
      conversation: {
        channel: "telegram",
        accountId: "default",
        conversationId: "plugin-binding-convo",
      },
    });

    await manager.stop();

    const reloaded = await createTelegramThreadBindingManager({
      accountId: "default",
      persist: true,
      enableSweeper: false,
    });

    expect(reloaded.getByConversationId("plugin-binding-convo")?.targetSessionKey).toBe(
      "plugin-binding:openclaw-codex-app-server:still-valid",
    );
    expect(readAcpSessionEntryAsyncMock).not.toHaveBeenCalled();
  });

  it("keeps ACP bindings when the session store cannot be read during startup cleanup", async () => {
    const manager = await createTelegramThreadBindingManager({
      accountId: "default",
      persist: true,
      enableSweeper: false,
    });

    await getSessionBindingService().bind({
      targetSessionKey: "agent:main:acp:read-failed",
      targetKind: "session",
      conversation: {
        channel: "telegram",
        accountId: "default",
        conversationId: "keep-on-read-failure",
      },
    });

    await manager.stop();
    readAcpSessionEntryAsyncMock.mockReturnValue({
      cfg: {} as never,
      storePath: "/tmp/acp-store.json",
      sessionKey: "agent:main:acp:read-failed",
      storeSessionKey: "agent:main:acp:read-failed",
      entry: undefined,
      acp: undefined,
      storeReadFailed: true,
    });

    const reloaded = await createTelegramThreadBindingManager({
      accountId: "default",
      persist: true,
      enableSweeper: false,
    });

    expect(reloaded.getByConversationId("keep-on-read-failure")?.targetSessionKey).toBe(
      "agent:main:acp:read-failed",
    );
  });
});
