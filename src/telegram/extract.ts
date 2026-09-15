import type { Settings } from "../config";

export interface TgUser {
  id: number;
  is_bot?: boolean;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TgChat {
  id: number;
  type?: string;
  title?: string;
  username?: string;
}

export interface TgPhotoSize {
  file_id: string;
  width?: number;
  height?: number;
  file_size?: number;
}

export interface TgDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TgMessage {
  message_id: number;
  message_thread_id?: number;
  is_topic_message?: boolean;
  from?: TgUser;
  chat: TgChat;
  date?: number;
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  document?: TgDocument;
  reply_to_message?: TgMessage;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
  edited_channel_post?: TgMessage;
}

export interface MediaRef {
  fileId: string;
  kind: "photo" | "document";
  name?: string;
  size?: number;
  mimeType?: string;
}

export interface Feedback {
  chatId: number;
  messageId: number;
  updateId: number;
  text: string;
  media: MediaRef[];
  senderId?: number;
  senderName?: string;
  threadId?: number;
  chatTitle?: string;
  date?: number;
  replyText?: string;
}

export const MAX_MEDIA_PER_MESSAGE = 4;

export function messageText(msg: TgMessage): string {
  return (msg.text ?? msg.caption ?? "").trim();
}

/** FR-2：三种触发模式 */
export function isTriggered(msg: TgMessage, settings: Settings): boolean {
  if (settings.triggerMode === "all") return true;
  if (settings.triggerMode === "topic") {
    return msg.message_thread_id !== undefined && settings.topicIds.includes(msg.message_thread_id);
  }
  const text = messageText(msg);
  if (!text) return false;
  const first = text.split(/\s+/)[0]?.split("@")[0]?.toLowerCase() ?? "";
  return settings.triggerCommands.includes(first);
}

/** 去掉命令前缀与 @botname 后缀，保留用户正文 */
export function stripCommand(text: string, commands: string[]): string {
  const trimmed = text.trim();
  const first = trimmed.split(/\s+/)[0] ?? "";
  const bare = first.split("@")[0]?.toLowerCase() ?? "";
  if (commands.includes(bare)) {
    return trimmed.slice(first.length).trim();
  }
  return trimmed;
}

export function largestPhoto(msg: TgMessage): MediaRef | null {
  const photos = msg.photo ?? [];
  if (photos.length === 0) return null;
  const best = photos.reduce((a, b) => ((b.file_size ?? 0) > (a.file_size ?? 0) ? b : a));
  return { fileId: best.file_id, kind: "photo", size: best.file_size };
}

export function extractFeedback(msg: TgMessage, updateId: number, settings: Settings): Feedback {
  const media: MediaRef[] = [];
  const photo = largestPhoto(msg);
  if (photo) media.push(photo);
  if (msg.document) {
    media.push({
      fileId: msg.document.file_id,
      kind: "document",
      name: msg.document.file_name,
      size: msg.document.file_size,
      mimeType: msg.document.mime_type,
    });
  }

  const sender = msg.from;
  const displayName =
    sender?.username ? "@" + sender.username : [sender?.first_name, sender?.last_name].filter(Boolean).join(" ");

  return {
    chatId: msg.chat.id,
    messageId: msg.message_id,
    updateId,
    text: stripCommand(messageText(msg), settings.triggerCommands),
    media: media.slice(0, MAX_MEDIA_PER_MESSAGE),
    senderId: sender?.id,
    senderName: displayName || undefined,
    threadId: msg.message_thread_id,
    chatTitle: msg.chat.title ?? msg.chat.username,
    date: msg.date,
    replyText: msg.reply_to_message ? messageText(msg.reply_to_message).slice(0, 500) : undefined,
  };
}

/** 判断「被回复的消息 + 当前消息」的合并文本（FR-3） */
export function composeText(fb: Feedback): string {
  if (!fb.replyText) return fb.text;
  return "> " + fb.replyText.replace(/\n/g, "\n> ") + "\n\n" + fb.text;
}
