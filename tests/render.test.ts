import { describe, expect, it } from "vitest";
import { buildBody, buildTitle, pickLabels, tgMessageLink } from "../src/github/render";
import type { Feedback } from "../src/telegram/extract";

const fb: Feedback = {
  chatId: -1001234567890,
  messageId: 4242,
  updateId: 987,
  text: "结账页报错\n点击下单后白屏",
  media: [],
  senderId: 12345,
  senderName: "@alice",
  threadId: 7,
  chatTitle: "测试群",
  date: 1735700000,
};

describe("buildTitle", () => {
  it("取正文首行并去掉引用/井号前缀", () => {
    expect(buildTitle("# 结账页报错\n第二行")).toBe("结账页报错");
  });

  it("首行过短时改用全文压缩", () => {
    expect(buildTitle("啊\n结账页点击下单后白屏")).toBe("啊 结账页点击下单后白屏");
  });

  it("超长标题按 80 字符截断", () => {
    const title = buildTitle("x".repeat(200));
    expect(title.length).toBe(83);
    expect(title.endsWith("...")).toBe(true);
  });

  it("去掉标题里的 Markdown 标记", () => {
    expect(buildTitle("添加**评论区自由复制**")).toBe("添加评论区自由复制");
    expect(buildTitle("~~旧方案~~ 请用 `新接口`")).toBe("旧方案 请用 新接口");
  });

  it("空文本使用兜底标题", () => {
    expect(buildTitle("   ")).toBe("来自 Telegram 的反馈");
  });
});

describe("pickLabels", () => {
  const allowed = ["bug", "suggestion", "建议"];

  it("只保留白名单内的标签", () => {
    expect(pickLabels("这里有 #bug 和 #random", allowed)).toEqual(["bug"]);
  });

  it("支持中文标签且忽略链接里的井号", () => {
    expect(pickLabels("见 https://t.me/x#bug 另 #建议", allowed)).toEqual(["建议"]);
  });

  it("没有标签时返回空数组", () => {
    expect(pickLabels("没有标签", allowed)).toEqual([]);
  });
});

describe("tgMessageLink", () => {
  it("超级群去掉 -100 前缀", () => {
    expect(tgMessageLink(-1001234567890, 42)).toBe("https://t.me/c/1234567890/42");
  });

  it("普通群去掉负号", () => {
    expect(tgMessageLink(-987654, 7)).toBe("https://t.me/c/987654/7");
  });
});

describe("buildBody", () => {
  it("包含幂等标记、图片与来源链接", () => {
    const body = buildBody(fb, { images: ["https://example.com/a.jpg"], anonymize: false });
    expect(body).toContain("<!-- tg2issues: chat=-1001234567890 msg=4242 -->");
    expect(body).toContain("![image 1](https://example.com/a.jpg)");
    expect(body).toContain("https://t.me/c/1234567890/4242");
    expect(body).toContain("@alice");
  });

  it("匿名化时不泄露用户名与 TG ID", () => {
    const body = buildBody(fb, { images: [], anonymize: true, anonymousId: "TG 用户 #AB12CD" });
    expect(body).not.toContain("@alice");
    expect(body).not.toContain("TG ID 12345");
    expect(body).toContain("TG 用户 #AB12CD");
  });

  it("合并被回复消息（FR-3）", () => {
    const replyFb = { ...fb, replyText: "原问题" };
    const body = buildBody(replyFb, { images: [], anonymize: false });
    expect(body).toContain("> 原问题");
  });
});
