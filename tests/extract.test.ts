import { describe, expect, it } from "vitest";
import { extractFeedback, isTriggered, largestPhoto, stripCommand } from "../src/telegram/extract";
import type { Settings } from "../src/config";
import type { TgMessage } from "../src/telegram/extract";

const base: Settings = {
  botToken: "x",
  webhookSecret: "y",
  ghToken: "z",
  ghWebhookSecret: "s",
  adminToken: "a",
  triggerMode: "topic",
  triggerCommands: ["/issue", "/bug", "/suggest"],
  allowedChatIds: [-1001234567890],
  allowedUserIds: [999],
  topicIds: [7],
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

function msg(partial: Partial<TgMessage>): TgMessage {
  return { message_id: 1, chat: { id: -1001234567890, type: "supergroup", title: "群" }, ...partial };
}

describe("isTriggered", () => {
  it("topic 模式只接受白名单话题内的消息", () => {
    expect(isTriggered(msg({ message_thread_id: 7, text: "随便说" }), base)).toBe(true);
    expect(isTriggered(msg({ message_thread_id: 8, text: "随便说" }), base)).toBe(false);
    expect(isTriggered(msg({ text: "没有话题" }), base)).toBe(false);
  });

  it("command 模式识别命令与 @botname 后缀", () => {
    const s: Settings = { ...base, triggerMode: "command" };
    expect(isTriggered(msg({ text: "/issue 白屏" }), s)).toBe(true);
    expect(isTriggered(msg({ text: "/issue@my_bot 白屏" }), s)).toBe(true);
    expect(isTriggered(msg({ text: "issue 白屏" }), s)).toBe(false);
  });

  it("all 模式放行白名单会话内所有消息", () => {
    expect(isTriggered(msg({ text: "随便" }), { ...base, triggerMode: "all" })).toBe(true);
  });
});

describe("stripCommand", () => {
  it("去掉命令前缀但保留正文", () => {
    expect(stripCommand("/issue 结账页报错", ["/issue"])).toBe("结账页报错");
    expect(stripCommand("/issue@my_bot 结账页报错", ["/issue"])).toBe("结账页报错");
    expect(stripCommand("普通消息", ["/issue"])).toBe("普通消息");
  });
});

describe("largestPhoto", () => {
  it("取分辨率/体积最大的那张", () => {
    const ref = largestPhoto(
      msg({
        photo: [
          { file_id: "small", file_size: 100 },
          { file_id: "big", file_size: 900 },
        ],
      }),
    );
    expect(ref?.fileId).toBe("big");
  });

  it("没有图片时返回 null", () => {
    expect(largestPhoto(msg({ text: "纯文本" }))).toBeNull();
  });
});

describe("extractFeedback", () => {
  it("提取文本、话题、发送者与附件", () => {
    const fb = extractFeedback(
      msg({
        message_id: 4242,
        message_thread_id: 7,
        text: "/issue 结账页报错",
        photo: [{ file_id: "p1", file_size: 500 }],
        document: { file_id: "d1", file_name: "log.txt", mime_type: "text/plain", file_size: 2048 },
        from: { id: 999, username: "alice" },
        date: 1735700000,
      }),
      1,
      base,
    );
    expect(fb.text).toBe("结账页报错");
    expect(fb.threadId).toBe(7);
    expect(fb.senderName).toBe("@alice");
    expect(fb.media.map((m) => m.kind)).toEqual(["photo", "document"]);
  });
});
