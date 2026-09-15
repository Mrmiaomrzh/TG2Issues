export type TriggerMode = "topic" | "command" | "all";

export interface Env {
  DB: D1Database;
  TG_BOT_TOKEN: string;
  TG_WEBHOOK_SECRET: string;
  GH_TOKEN: string;
  GH_WEBHOOK_SECRET?: string;
  ADMIN_TOKEN?: string;
  TG_TRIGGER_MODE?: string;
  TG_TRIGGER_COMMANDS?: string;
  TG_ALLOWED_CHAT_IDS?: string;
  TG_ALLOWED_USER_IDS?: string;
  TG_TOPIC_IDS?: string;
  TG_ADMIN_CHAT_ID?: string;
  GH_REPO?: string;
  GH_API_BASE?: string;
  GH_DEFAULT_LABELS?: string;
  GH_DEFAULT_ASSIGNEE?: string;
  ALLOWED_LABELS?: string;
  ASSET_REPO?: string;
  ASSET_BRANCH?: string;
  ASSET_PREFIX?: string;
  ASSET_MAX_BYTES?: string;
  RATE_PER_MIN?: string;
  RATE_PER_DAY?: string;
  REDACT_ENABLE?: string;
  ANONYMIZE_SENDER?: string;
  TIME_ZONE?: string;
  DRY_RUN?: string;
}

export interface Settings {
  botToken: string;
  webhookSecret: string;
  ghToken: string;
  ghWebhookSecret: string;
  adminToken: string;
  triggerMode: TriggerMode;
  triggerCommands: string[];
  allowedChatIds: number[];
  allowedUserIds: number[];
  topicIds: number[];
  adminChatId?: number;
  ghRepo: string;
  ghApiBase: string;
  ghDefaultLabels: string[];
  ghDefaultAssignee?: string;
  allowedLabels: string[];
  assetRepo: string;
  assetBranch: string;
  assetPrefix: string;
  assetMaxBytes: number;
  ratePerMin: number;
  ratePerDay: number;
  redactEnable: boolean;
  anonymizeSender: boolean;
  timeZone: string;
  dryRun: boolean;
}

/** 兼容 "owner/repo"、"https://github.com/owner/repo"、"git@github.com:owner/repo.git" 三种写法 */
export function normalizeRepo(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const match = /github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i.exec(raw);
  if (match && match[1] && match[2]) return match[1] + "/" + match[2].replace(/\.git$/i, "");
  return raw.replace(/\.git$/i, "").replace(/^[/\s]+|[/\s]+$/g, "");
}

export function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function idList(value: string | undefined): number[] {
  return csv(value)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

export function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

export function loadSettings(env: Env): Settings {
  const mode = (env.TG_TRIGGER_MODE ?? "topic").trim().toLowerCase();
  const triggerMode: TriggerMode =
    mode === "command" || mode === "all" || mode === "topic" ? mode : "topic";

  return {
    botToken: (env.TG_BOT_TOKEN ?? "").trim(),
    webhookSecret: (env.TG_WEBHOOK_SECRET ?? "").trim(),
    ghToken: (env.GH_TOKEN ?? "").trim(),
    ghWebhookSecret: (env.GH_WEBHOOK_SECRET ?? "").trim(),
    adminToken: (env.ADMIN_TOKEN ?? "").trim(),
    triggerMode,
    triggerCommands: csv(env.TG_TRIGGER_COMMANDS ?? "/issue,/bug,/suggest").map((c) => c.toLowerCase()),
    allowedChatIds: idList(env.TG_ALLOWED_CHAT_IDS),
    allowedUserIds: idList(env.TG_ALLOWED_USER_IDS),
    topicIds: idList(env.TG_TOPIC_IDS),
    adminChatId: idList(env.TG_ADMIN_CHAT_ID)[0],
    ghRepo: normalizeRepo(env.GH_REPO),
    ghApiBase: (env.GH_API_BASE ?? "https://api.github.com").trim().replace(/\/+$/, ""),
    ghDefaultLabels: csv(env.GH_DEFAULT_LABELS ?? "from-telegram"),
    ghDefaultAssignee: (env.GH_DEFAULT_ASSIGNEE ?? "").trim() || undefined,
    allowedLabels: csv(env.ALLOWED_LABELS ?? "bug,suggestion,question,docs,enhancement"),
    assetRepo: normalizeRepo(env.ASSET_REPO) || normalizeRepo(env.GH_REPO),
    assetBranch: (env.ASSET_BRANCH ?? "main").trim() || "main",
    assetPrefix: (env.ASSET_PREFIX ?? "tg").trim().replace(/^\/+|\/+$/g, "") || "tg",
    assetMaxBytes: num(env.ASSET_MAX_BYTES, 5 * 1024 * 1024),
    ratePerMin: num(env.RATE_PER_MIN, 3),
    ratePerDay: num(env.RATE_PER_DAY, 20),
    redactEnable: bool(env.REDACT_ENABLE, true),
    anonymizeSender: bool(env.ANONYMIZE_SENDER, false),
    timeZone: (env.TIME_ZONE ?? "Asia/Shanghai").trim() || "Asia/Shanghai",
    dryRun: bool(env.DRY_RUN, false),
  };
}

/** 启动/自检：返回配置层面的问题列表（空数组 = 健康） */
export function configProblems(s: Settings): string[] {
  const problems: string[] = [];
  if (!s.botToken) problems.push("TG_BOT_TOKEN 未配置");
  if (!s.webhookSecret) problems.push("TG_WEBHOOK_SECRET 未配置（Webhook 路径与请求头都要校验它）");
  if (!s.ghToken) problems.push("GH_TOKEN 未配置");
  if (!s.ghRepo || !s.ghRepo.includes("/")) problems.push("GH_REPO 必须是 owner/repo 形式");
  if (s.allowedChatIds.length === 0) problems.push("TG_ALLOWED_CHAT_IDS 为空：fail-closed，会拒绝所有消息");
  if (s.triggerMode === "topic" && s.topicIds.length === 0) {
    problems.push("TG_TOPIC_IDS 为空：topic 模式下不会转发任何消息（指令仍然可用，且可用 TG_TRIGGER_MODE=command）");
  }
  if (!s.ghWebhookSecret) problems.push("GH_WEBHOOK_SECRET 未配置：Issue 评论/关闭不会回流到 Telegram");
  if (!s.adminToken) problems.push("ADMIN_TOKEN 未配置：控制台页面与 /api/* 接口将被拒绝");
  return problems;
}
