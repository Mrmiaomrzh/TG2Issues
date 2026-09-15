import type { Feedback } from "../telegram/extract";
import { composeText } from "../telegram/extract";
import { formatTime } from "../utils";

export function tgMessageLink(chatId: number, messageId: number): string {
  const raw = String(chatId);
  const inner = raw.startsWith("-100") ? raw.slice(4) : raw.replace(/^-/, "");
  return "https://t.me/c/" + inner + "/" + messageId;
}

export function issueMarker(fb: Feedback): string {
  return "<!-- tg2issues: chat=" + fb.chatId + " msg=" + fb.messageId + " -->";
}

export function buildTitle(text: string, maxLen = 80): string {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/^[#>*\-\s]+/, "").trim())
    .filter((line) => line.length > 0);

  let title = lines[0] ?? "";

  if (title.length < 4 && lines.length > 1) {
    title = lines.join(" ");
  }

  title = title
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (title.length === 0) title = "来自 Telegram 的反馈";
  return title.length > maxLen ? title.slice(0, maxLen) + "..." : title;
}

const TAG_RE = /(?<![\w/])#([A-Za-z0-9_\-\u4e00-\u9fa5]{1,24})/g;

export function pickLabels(text: string, allowed: string[]): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(TAG_RE)) {
    if (m[1]) found.add(m[1].toLowerCase());
  }
  return allowed.filter((label) => found.has(label.toLowerCase()));
}

export function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? "> " + line : ">"))
    .join("\n");
}

export interface BodyOptions {
  images: string[];
  anonymize: boolean;
  anonymousId?: string;
  timeZone?: string;
  mediaNotes?: string[];
}

export function buildBody(fb: Feedback, options: BodyOptions): string {
  const sender = options.anonymize
    ? (options.anonymousId ?? "匿名用户")
    : (fb.senderName ?? "未知") + (fb.senderId ? "（TG ID " + fb.senderId + "）" : "");

  const parts: string[] = [];
  parts.push(issueMarker(fb));
  parts.push("**反馈内容**");
  parts.push("");
  parts.push(quote(composeText(fb)));

  if (options.images.length > 0) {
    parts.push("");
    parts.push(options.images.map((url, i) => "![image " + (i + 1) + "](" + url + ")").join("\n"));
  }
  if (options.mediaNotes && options.mediaNotes.length > 0) {
    parts.push("");
    parts.push(options.mediaNotes.map((n) => "- " + n).join("\n"));
  }

  parts.push("");
  parts.push("<details><summary>来源信息</summary>");
  parts.push("");
  parts.push("- 来源：Telegram" + (fb.chatTitle ? "「" + fb.chatTitle + "」" : " 会话 " + fb.chatId));
  parts.push("- 发送者：" + sender);
  parts.push("- 原始消息：[查看](" + tgMessageLink(fb.chatId, fb.messageId) + ")");
  parts.push("- 接收时间：" + formatTime((fb.date ?? Math.floor(Date.now() / 1000)) * 1000, options.timeZone));
  parts.push("- 消息 ID：" + fb.messageId + " · update_id " + fb.updateId);
  parts.push("");
  parts.push("</details>");
  parts.push("");

  return parts.join("\n");
}
