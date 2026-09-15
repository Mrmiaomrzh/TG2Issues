import type { Deps } from "../deps";
import type { TgMessage } from "./extract";
import { replyTo } from "./reply";
import { escapeHtml } from "../utils";

/** 提交型命令：把命令后面的内容当成一条反馈 */
export const SUBMIT_COMMANDS = ["/issue", "/bug", "/suggest"];

/** 查询型命令：只回复信息，不建 Issue */
export const QUERY_COMMANDS = ["/help", "/start", "/issues", "/stats", "/status", "/link"];

export const ALL_COMMANDS = [...QUERY_COMMANDS, ...SUBMIT_COMMANDS];

export interface ParsedCommand {
  name: string;
  args: string;
}

/** 解析 "/issues@my_bot 5" 这类命令；不是命令则返回 null */
export function parseCommand(text: string | undefined): ParsedCommand | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const first = trimmed.split(/\s+/)[0] ?? "";
  const name = "/" + (first.slice(1).split("@")[0] ?? "").toLowerCase();
  if (name === "/") return null;
  return { name, args: trimmed.slice(first.length).trim() };
}

export function isQueryCommand(name: string): boolean {
  return QUERY_COMMANDS.includes(name);
}

export function isSubmitCommand(name: string): boolean {
  return SUBMIT_COMMANDS.includes(name);
}

export function helpText(): string {
  return [
    "<b>TG2Issues 指令</b>",
    "",
    "<code>/issue 内容</code> — 提交一条反馈，自动创建 GitHub Issue",
    "（同义命令：<code>/bug</code>、<code>/suggest</code>，也可以只发图片）",
    "<code>/issues [数量]</code> — 查看<b>本群</b>最近提交的反馈（默认 5 条，最多 20 条）",
    "<code>/issues all [数量]</code> — 跨会话查看全部反馈（需管理员）",
    "<code>/link</code> — 回复某条消息时使用，查询它对应的 Issue",
    "<code>/stats</code> — 统计信息",
    "<code>/status</code> — 服务运行状态",
    "<code>/help</code>、<code>/start</code> — 显示本帮助",
    "",
    "提示：在话题里直接发言也会自动转发（由 TG_TRIGGER_MODE / TG_TOPIC_IDS 决定）。",
  ].join("\n");
}

export interface IssuesQuery {
  limit: number;
  all: boolean;
}

/** 解析 "/issues 10" / "/issues all" / "/issues all 10"，默认只看当前会话 */
export function parseIssuesQuery(args: string, fallbackLimit = 5): IssuesQuery {
  const parts = args.split(/\s+/).filter((p) => p.length > 0);
  const all = parts.some((p) => p.toLowerCase() === "all" || p === "全局");
  const numeric = parts.find((p) => /\d/.test(p));
  const value = numeric ? Number(numeric.replace(/[^0-9]/g, "")) : NaN;
  const limit = Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 20) : fallbackLimit;
  return { limit, all };
}

async function listIssues(args: string, msg: TgMessage, deps: Deps): Promise<void> {
  const { limit, all } = parseIssuesQuery(args);
  const isAdmin = msg.from?.id !== undefined && deps.settings.allowedUserIds.includes(msg.from.id);

  if (all && !isAdmin) {
    await replyTo(
      deps,
      msg,
      "跨会话查询需要管理员权限：请把你的 TG 用户 ID 加进 <code>TG_ALLOWED_USER_IDS</code>。",
    );
    return;
  }

  const { items, total } = await deps.store.listIssues({
    limit,
    offset: 0,
    status: "done",
    chatId: all ? undefined : msg.chat.id,
  });

  if (items.length === 0) {
    await replyTo(
      deps,
      msg,
      all
        ? "还没有任何已创建的 Issue。可用 <code>/issue 内容</code> 提交第一条反馈。"
        : "本群还没有反馈记录。直接用 <code>/bug 你遇到的问题</code> 提交一条吧。",
    );
    return;
  }

  const lines = items.map((item) => {
    const title = escapeHtml(item.title ?? "(无标题)");
    return "• <b>#" + item.issue_number + "</b> <a href=\"" + item.issue_url + "\">" + title + "</a>";
  });

  const head = all
    ? "<b>全局最近 " + items.length + " 条反馈</b>（共 " + total + " 条）"
    : "<b>本群最近 " + items.length + " 条反馈</b>（本群共 " + total + " 条，全部用 <code>/issues all</code>）";

  await replyTo(deps, msg, head + "\n\n" + lines.join("\n"));
}

async function stats(msg: TgMessage, deps: Deps): Promise<void> {
  const [stats, last24h] = await Promise.all([deps.store.stats(), deps.store.last24hCount()]);
  await replyTo(
    deps,
    msg,
    [
      "<b>统计</b>",
      "",
      "已创建 Issue：<b>" + stats.issues + "</b>（最近 24 小时 " + last24h + "）",
      "处理中：" + stats.pending,
      "死信：" + stats.deadLetters,
      "已收到更新：" + stats.updates,
    ].join("\n"),
  );
}

async function status(msg: TgMessage, deps: Deps): Promise<void> {
  const s = deps.settings;
  const lines = [
    "<b>运行状态</b>",
    "",
    "触发模式：<code>" + s.triggerMode + "</code>",
    "目标仓库：<code>" + escapeHtml(s.ghRepo || "(未配置)") + "</code>",
    "图片转存仓库：<code>" + escapeHtml(s.assetRepo || "(未配置)") + "</code>",
    "限流：每分钟 " + s.ratePerMin + " 条 / 每天 " + s.ratePerDay + " 条",
    "脱敏：" + (s.redactEnable ? "开" : "关") + " · 匿名化：" + (s.anonymizeSender ? "开" : "关"),
    "演练模式：" + (s.dryRun ? "开（不会真的建 Issue）" : "关"),
  ];
  try {
    const info = await deps.api.getWebhookInfo();
    lines.push("Webhook 待处理更新：" + (info.pending_update_count ?? 0));
    if (info.last_error_message) lines.push("最近错误：" + escapeHtml(info.last_error_message).slice(0, 120));
  } catch (error) {
    lines.push("Webhook 状态：查询失败（" + escapeHtml(String(error)).slice(0, 80) + "）");
  }
  await replyTo(deps, msg, lines.join("\n"));
}

async function link(msg: TgMessage, deps: Deps): Promise<void> {
  const targetId = msg.reply_to_message?.message_id;
  if (targetId === undefined) {
    await replyTo(deps, msg, "用法：回复某条反馈消息后发送 <code>/link</code>，即可查询它对应的 Issue。");
    return;
  }
  const row = await deps.store.findByMessage(msg.chat.id, targetId);
  if (!row || !row.issue_url) {
    await replyTo(deps, msg, "这条消息还没有对应的 Issue（可能尚未处理或未命中触发规则）。");
    return;
  }
  await replyTo(
    deps,
    msg,
    "该消息对应的 Issue：<b>#" + row.issue_number + "</b>\n" + row.issue_url,
  );
}

/** 处理查询型命令；返回 true 表示已消费该消息 */
export async function runQueryCommand(cmd: ParsedCommand, msg: TgMessage, deps: Deps): Promise<boolean> {
  switch (cmd.name) {
    case "/help":
    case "/start":
      await replyTo(deps, msg, helpText());
      return true;
    case "/issues":
      await listIssues(cmd.args, msg, deps);
      return true;
    case "/stats":
      await stats(msg, deps);
      return true;
    case "/status":
      await status(msg, deps);
      return true;
    case "/link":
      await link(msg, deps);
      return true;
    default:
      return false;
  }
}
