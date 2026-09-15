import { describe, expect, it } from "vitest";
import {
  QUERY_COMMANDS,
  SUBMIT_COMMANDS,
  helpText,
  isQueryCommand,
  isSubmitCommand,
  parseCommand,
  parseIssuesQuery,
} from "../src/telegram/commands";
import { escapeHtml } from "../src/utils";

describe("parseCommand", () => {
  it("解析命令与参数", () => {
    expect(parseCommand("/issues 10")).toEqual({ name: "/issues", args: "10" });
    expect(parseCommand("/issue 结账页报错 点击白屏")).toEqual({
      name: "/issue",
      args: "结账页报错 点击白屏",
    });
  });

  it("去掉 @botname 后缀并忽略大小写", () => {
    expect(parseCommand("/Issues@My_Bot 3")).toEqual({ name: "/issues", args: "3" });
  });

  it("没有参数时 args 为空串", () => {
    expect(parseCommand("/stats")).toEqual({ name: "/stats", args: "" });
  });

  it("非命令返回 null", () => {
    expect(parseCommand("普通消息")).toBeNull();
    expect(parseCommand("")).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
    expect(parseCommand("/")).toBeNull();
  });
});

describe("命令分类", () => {
  it("查询命令与提交命令互不重叠", () => {
    for (const name of QUERY_COMMANDS) {
      expect(isQueryCommand(name)).toBe(true);
      expect(isSubmitCommand(name)).toBe(false);
    }
    for (const name of SUBMIT_COMMANDS) {
      expect(isSubmitCommand(name)).toBe(true);
      expect(isQueryCommand(name)).toBe(false);
    }
  });

  it("未知命令两边都不命中", () => {
    expect(isQueryCommand("/nope")).toBe(false);
    expect(isSubmitCommand("/nope")).toBe(false);
  });

  it("帮助文本列出全部命令", () => {
    const text = helpText();
    for (const name of [...QUERY_COMMANDS, ...SUBMIT_COMMANDS]) {
      expect(text).toContain(name);
    }
  });
});

describe("escapeHtml", () => {
  it("转义 Telegram HTML 模式的特殊字符", () => {
    expect(escapeHtml("<b>a</b> & \"b\"")).toBe("&lt;b&gt;a&lt;/b&gt; &amp; &quot;b&quot;");
  });
});
describe("parseIssuesQuery", () => {
  it("默认只看本会话、5 条", () => {
    expect(parseIssuesQuery("")).toEqual({ limit: 5, all: false });
  });

  it("识别数量参数并做上限截断", () => {
    expect(parseIssuesQuery("10")).toEqual({ limit: 10, all: false });
    expect(parseIssuesQuery("999")).toEqual({ limit: 20, all: false });
    expect(parseIssuesQuery("abc")).toEqual({ limit: 5, all: false });
  });

  it("识别 all / 全局 关键字，顺序无关", () => {
    expect(parseIssuesQuery("all")).toEqual({ limit: 5, all: true });
    expect(parseIssuesQuery("all 10")).toEqual({ limit: 10, all: true });
    expect(parseIssuesQuery("10 all")).toEqual({ limit: 10, all: true });
    expect(parseIssuesQuery("全局 3")).toEqual({ limit: 3, all: true });
  });
});
