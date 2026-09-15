import { sha256Hex } from "./utils";

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

export function stripInjection(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?(?:details|summary|img|script|iframe)[^>]*>/gi, "");
}

export async function anonymousSenderId(userId: number): Promise<string> {
  const hex = await sha256Hex("tg2issues:" + String(userId));
  return "TG 用户 #" + hex.slice(0, 6).toUpperCase();
}
