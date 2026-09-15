import { sha256Hex } from "./utils";

/** 常见密钥形态，命中即打码（FR-19） */
const SECRET_PATTERNS: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /(?:token|password|passwd|secret|api[_-]?key)\s*[:=]\s*\S{8,}/gi,
];

export function redact(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

/** 定长比较，避免时序侧信道 */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length === 0 || ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i += 1) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

export async function verifyGithubSignature(
  payload: string,
  header: string,
  secret: string,
): Promise<boolean> {
  if (!secret || !header) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const hex = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual("sha256=" + hex, header.trim());
}

/** 剥离用户输入里可能伪造的来源标记与 HTML 注释（防注入/防伪造溯源） */
export function stripInjection(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?(?:details|summary|img|script|iframe)[^>]*>/gi, "");
}

/** 发送者匿名化：同一 TG 用户在同一仓库里得到稳定的短哈希 ID */
export async function anonymousSenderId(userId: number): Promise<string> {
  const hex = await sha256Hex("tg2issues:" + String(userId));
  return "TG 用户 #" + hex.slice(0, 6).toUpperCase();
}
