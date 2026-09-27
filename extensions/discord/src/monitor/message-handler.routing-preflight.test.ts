import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import {
  registerSessionBindingAdapter,
  unregisterSessionBindingAdapter,
  type SessionBindingAdapter,
  type SessionBindingRecord,
} from "openclaw/plugin-sdk/conversation-runtime";
import { expect, it, onTestFinished } from "vitest";
import {
  createDiscordMessage,
  createDiscordPreflightArgs,
  createGuildEvent,
  createGuildTextClient,
} from "./message-handler.preflight.test-helpers.js";
import { resolveDiscordPreflightRoute } from "./message-handler.routing-preflight.js";

it.each([false, true])(
  "honors the conversation binding with ambiguous routing=%s",
  async (ambiguous) => {
    const channelId = "channel-bound";
    const binding: SessionBindingRecord = {
      bindingId: "default:channel-bound",
      targetSessionKey: "agent:second:acp:bound-session",
      targetKind: "session",
      conversation: { channel: "discord", accountId: "default", conversationId: channelId },
      status: "active",
      boundAt: 1,
    };
    const adapter: SessionBindingAdapter = {
      channel: "discord",
      accountId: "default",
      listBySession: () => [binding],
      resolveByConversation: (ref) => (ref.conversationId === channelId ? binding : null),
    };
    registerSessionBindingAdapter(adapter);
    onTestFinished(() =>
      unregisterSessionBindingAdapter({ channel: "discord", accountId: "default", adapter }),
    );
    const cfg: OpenClawConfig = ambiguous
      ? { agents: { ownership: "explicit", entries: { first: {}, second: {} } } }
      : {};
    const message = createDiscordMessage({
      id: "message-bound",
      channelId,
      content: "continue",
      author: { id: "user-1", bot: false },
    });
    const result = await resolveDiscordPreflightRoute({
      preflight: createDiscordPreflightArgs({
        cfg,
        discordConfig: {},
        data: createGuildEvent({ channelId, guildId: "guild-1", author: message.author, message }),
        client: createGuildTextClient(channelId),
      }),
      author: message.author,
      isDirectMessage: false,
      isGroupDm: false,
      messageChannelId: channelId,
      memberRoleIds: [],
    });
    expect(result.effectiveRoute.agentId).toBe("second");
    expect(result.baseSessionKey).toBe(binding.targetSessionKey);
    expect(result.threadBinding).toEqual(binding);
  },
);
