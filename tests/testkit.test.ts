import { describe, expect, it } from "vitest";
import { buildTestUpdate, isTestUpdate } from "../src/testkit";
import type { Settings } from "../src/config";

const base: Settings = {
  botToken: "x",
  webhookSecret: "y",
  ghToken: "z",
  ghWebhookSecret: "s",
  adminToken: "a",
  triggerMode: "command",
  triggerCommands: ["/issue", "/bug", "/suggest"],
  allowedChatIds: [-1001234567890],
  allowedUserIds: [123456789],
  topicIds: [],
  ghRepo: "owner/repo",
  ghApiBase: "https://api.github.com",
  ghDefaultLabels: ["from-telegram"],
  allowedLabels: ["bug"],
  assetRepo: "owner/assets",
  assetBranch: "main",
  assetPrefix: "tg",
  assetMaxBytes: 5 * 1024 * 1024,
  ratePerMin: 3,
  ratePerDay: 20,
  redactEnable: true,
  anonymizeSender: false,
  timeZone: "Asia/Shanghai",
  dryRun: false,
};

describe("buildTestUpdate", () => {
  it("command 模式下自动补上提交指令（否则会被触发判定拦掉）", () => {
    const update = buildTestUpdate(base, { text: "结账页白屏", now: 1700000000000 });
    expect(isTestUpdate(update)).toBe(true);
    if (!isTestUpdate(update)) return;
    expect(update.message?.text).toBe("/issue 结账页白屏");
    expect(update.message?.chat.id).toBe(-1001234567890);
  });

  it("topic 模式下不补指令前缀", () => {
    const update = buildTestUpdate({ ...base, triggerMode: "topic", topicIds: [7] }, { text: "白屏" });
    if (!isTestUpdate(update)) throw new Error("应当生成 update");
    expect(update.message?.text).toBe("白屏");
    expect(update.message?.message_thread_id).toBe(7);
  });

  it("没有可用会话时返回错误而不是抛异常", () => {
    const update = buildTestUpdate({ ...base, allowedChatIds: [] }, { text: "x" });
    expect(isTestUpdate(update)).toBe(false);
    if (isTestUpdate(update)) return;
    expect(update.error).toContain("chat_id");
  });

  it("显式传入 chatId / threadId 时优先使用", () => {
    const update = buildTestUpdate(base, { text: "x", chatId: 123, threadId: 9 });
    if (!isTestUpdate(update)) throw new Error("应当生成 update");
    expect(update.message?.chat.id).toBe(123);
    expect(update.message?.message_thread_id).toBe(9);
  });
});
