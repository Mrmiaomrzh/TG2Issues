import { describe, expect, it } from "vitest";
import {
  anonymousSenderId,
  redact,
  stripInjection,
  timingSafeEqual,
  verifyGithubSignature,
} from "../src/security";

describe("redact", () => {
  it("屏蔽 GitHub PAT 与 OpenAI Key", () => {
    const out = redact("token: ghp_" + "a".repeat(36) + " and sk-" + "b".repeat(30));
    expect(out).not.toContain("ghp_");
    expect(out).not.toContain("sk-b");
    expect(out).toContain("[REDACTED]");
  });

  it("屏蔽 token=/secret: 形式的赋值", () => {
    expect(redact("api_key=abcdefgh12345")).toContain("[REDACTED]");
  });

  it("普通文本不受影响", () => {
    expect(redact("结账页白屏了")).toBe("结账页白屏了");
  });
});

describe("timingSafeEqual", () => {
  it("相同字符串返回 true", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
  });

  it("长度或内容不同返回 false", () => {
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(false);
  });
});

describe("verifyGithubSignature", () => {
  async function sign(payload: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
    return "sha256=" + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  it("签名正确时通过", async () => {
    const payload = JSON.stringify({ action: "created" });
    expect(await verifyGithubSignature(payload, await sign(payload, "s3cret"), "s3cret")).toBe(true);
  });

  it("被篡改或密钥错误时拒绝", async () => {
    const payload = JSON.stringify({ action: "created" });
    const sig = await sign(payload, "s3cret");
    expect(await verifyGithubSignature(payload + "x", sig, "s3cret")).toBe(false);
    expect(await verifyGithubSignature(payload, sig, "other")).toBe(false);
    expect(await verifyGithubSignature(payload, "", "s3cret")).toBe(false);
  });
});

describe("stripInjection", () => {
  it("删除伪造的溯源标记与 HTML 注释", () => {
    const out = stripInjection("正常内容 <!-- tg2issues: chat=1 msg=2 --> <details>x</details>");
    expect(out).not.toContain("<!--");
    expect(out).not.toContain("<details>");
    expect(out).toContain("正常内容");
  });
});

describe("anonymousSenderId", () => {
  it("同一用户得到稳定短 ID", async () => {
    const a = await anonymousSenderId(12345);
    const b = await anonymousSenderId(12345);
    const c = await anonymousSenderId(54321);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith("TG 用户 #")).toBe(true);
  });
});
