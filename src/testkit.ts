import type { Settings } from "./config";
import type { TgUpdate } from "./telegram/extract";

export interface TestUpdateOptions {
  text: string;
  chatId?: number;
  threadId?: number;
  now?: number;
}

/**
 * 合成一条用于自检的 update（控制台「测试一条反馈」用）。
 * 注意：command 模式下必须带上提交指令，否则会被触发判定拦掉——这正是真实用户在群里干的事。
 */
export function buildTestUpdate(settings: Settings, options: TestUpdateOptions): TgUpdate | { error: string } {
  const chatId = options.chatId ?? settings.allowedChatIds[0];
  if (chatId === undefined) {
    return { error: "没有可用的 chat_id：请先配置 TG_ALLOWED_CHAT_IDS，或在请求里传 chatId" };
  }

  const now = options.now ?? Date.now();
  const prefix = settings.triggerMode === "command" ? "/issue " : "";
  const text = (prefix + options.text).slice(0, 2000);

  return {
    update_id: now,
    message: {
      message_id: now % 1000000000,
      message_thread_id: options.threadId ?? settings.topicIds[0],
      date: Math.floor(now / 1000),
      text,
      from: { id: 0, username: "dashboard", first_name: "Dashboard" },
      chat: { id: chatId, type: "supergroup", title: "控制台测试" },
    },
  };
}

export function isTestUpdate(value: TgUpdate | { error: string }): value is TgUpdate {
  return (value as TgUpdate).update_id !== undefined;
}
