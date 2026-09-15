import type { Deps } from "../deps";
import type { TgMessage } from "./extract";
import { errText } from "../utils";

export async function replyTo(
  deps: Deps,
  msg: TgMessage,
  text: string,
  parseMode: "HTML" | undefined = "HTML",
): Promise<void> {
  try {
    await deps.api.sendMessage(msg.chat.id, text, {
      message_thread_id: msg.message_thread_id,
      reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true },
      parse_mode: parseMode,
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    console.error("回复 Telegram 失败", errText(error));
  }
}

export async function notifyAdmin(deps: Deps, text: string): Promise<void> {
  const chatId = deps.settings.adminChatId;
  if (!chatId) return;
  try {
    await deps.api.sendMessage(chatId, text, { parse_mode: undefined });
  } catch (error) {
    console.error("通知管理员失败", errText(error));
  }
}
