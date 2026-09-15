import { Hono } from "hono";
import type { Env } from "./config";
import { configProblems } from "./config";
import type { Deps } from "./deps";
import { adminAllowed, buildDeps, maskWebhookUrl } from "./deps";
import { handleUpdate } from "./pipeline";
import type { HandleResult } from "./pipeline";
import type { TgUpdate } from "./telegram/extract";
import { buildTestUpdate, isTestUpdate } from "./testkit";
import { errText, withTimeout } from "./utils";

export const api = new Hono<{ Bindings: Env }>();

/** 面板接口统一鉴权：Authorization: Bearer <ADMIN_TOKEN> 或 ?token= */
api.use("*", async (c, next) => {
  const deps = buildDeps(c.env);
  if (!adminAllowed(c, deps.settings.adminToken)) {
    return c.json({ ok: false, error: "unauthorized" }, 401);
  }
  await next();
});

function publicConfig(deps: Deps): Record<string, unknown> {
  const s = deps.settings;
  return {
    triggerMode: s.triggerMode,
    triggerCommands: s.triggerCommands,
    allowedChatIds: s.allowedChatIds,
    topicIds: s.topicIds,
    adminChatId: s.adminChatId ?? null,
    ghRepo: s.ghRepo,
    ghApiBase: s.ghApiBase,
    defaultLabels: s.ghDefaultLabels,
    allowedLabels: s.allowedLabels,
    defaultAssignee: s.ghDefaultAssignee ?? null,
    assetRepo: s.assetRepo,
    assetBranch: s.assetBranch,
    assetPrefix: s.assetPrefix,
    assetMaxBytes: s.assetMaxBytes,
    ratePerMin: s.ratePerMin,
    ratePerDay: s.ratePerDay,
    redactEnable: s.redactEnable,
    anonymizeSender: s.anonymizeSender,
    timeZone: s.timeZone,
    dryRun: s.dryRun,
  };
}

/** 概览：统计 + 最近记录 + 配置体检（默认不调用外部 API，live=1 时附带 Telegram/GitHub 探测） */
api.get("/overview", async (c) => {
  const deps = buildDeps(c.env);
  const problems = configProblems(deps.settings);

  const stats = await deps.store.stats();
  const last24h = await deps.store.last24hCount();
  const recent = await deps.store.listIssues({ limit: 8, offset: 0 });
  const topChats = await deps.store.topChats(5);
  const deadLetters = await deps.store.listDeadLetters(1, 0);

  const result: Record<string, unknown> = {
    ok: true,
    stats,
    last24h,
    recent: recent.items,
    topChats,
    deadLetterCount: deadLetters.total,
    config: publicConfig(deps),
    problems,
    env: {
      worker: "cloudflare",
      dryRun: deps.settings.dryRun,
      now: new Date().toISOString(),
    },
  };

  if (c.req.query("live") === "1") {
    // 三个外部探测并行执行，并且各自带超时：慢网络不会拖住首屏
    const [webhook, bot, repo] = await Promise.all([
      withTimeout(deps.api.getWebhookInfo(), 6000, "getWebhookInfo")
        .then((info) => ({
          url: maskWebhookUrl(info.url),
          pending: info.pending_update_count ?? 0,
          lastError: info.last_error_message ?? null,
          lastErrorAt: info.last_error_date ?? null,
        }))
        .catch((error: unknown) => ({ error: errText(error) })),
      withTimeout(deps.api.getMe(), 6000, "getMe")
        .then((me) => ({ id: me.id, username: me.username }))
        .catch((error: unknown) => ({ error: errText(error) })),
      deps.settings.ghRepo
        ? withTimeout(deps.gh.getRepo(deps.settings.ghRepo), 6000, "getRepo")
            .then((r) => ({ fullName: r.full_name, private: r.private, hasIssues: r.has_issues }))
            .catch((error: unknown) => ({ error: errText(error) }))
        : Promise.resolve(null),
    ]);

    result.webhook = webhook;
    result.bot = bot;
    if (repo) result.repo = repo;
  }

  return c.json(result);
});

/** 最近 N 天活动（用于概览页柱状图） */
api.get("/activity", async (c) => {
  const deps = buildDeps(c.env);
  const days = Math.min(Math.max(Number(c.req.query("days") ?? "14") || 14, 3), 60);
  const [rows, last24h] = await Promise.all([deps.store.dailyCounts(days), deps.store.last24hCount()]);

  const map = new Map(rows.map((r) => [r.day, r.c]));
  const series: Array<{ day: string; count: number }> = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    series.push({ day, count: map.get(day) ?? 0 });
  }

  return c.json({
    ok: true,
    days,
    last24h,
    total: series.reduce((sum, item) => sum + item.count, 0),
    series,
  });
});

/** 反馈记录分页查询 */
api.get("/issues", async (c) => {
  const deps = buildDeps(c.env);
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? "20") || 20, 1), 100);
  const offset = Math.max(Number(c.req.query("offset") ?? "0") || 0, 0);
  const status = (c.req.query("status") ?? "").trim();
  const q = (c.req.query("q") ?? "").trim();

  const { items, total } = await deps.store.listIssues({
    limit,
    offset,
    status: status && status !== "all" ? status : undefined,
    q: q || undefined,
  });
  return c.json({ ok: true, total, limit, offset, items });
});

/** 死信队列 */
api.get("/dead-letters", async (c) => {
  const deps = buildDeps(c.env);
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? "20") || 20, 1), 100);
  const offset = Math.max(Number(c.req.query("offset") ?? "0") || 0, 0);
  const { items, total } = await deps.store.listDeadLetters(limit, offset);
  return c.json({ ok: true, total, limit, offset, items });
});

api.get("/dead-letters/:id", async (c) => {
  const deps = buildDeps(c.env);
  const row = await deps.store.getDeadLetter(Number(c.req.param("id")));
  if (!row) return c.json({ ok: false, error: "not found" }, 404);
  return c.json({ ok: true, item: row });
});

/** 重试死信：清掉去重记录与占用后重跑整条流程 */
api.post("/dead-letters/:id/retry", async (c) => {
  const deps = buildDeps(c.env);
  const id = Number(c.req.param("id"));
  const row = await deps.store.getDeadLetter(id);
  if (!row || !row.payload) return c.json({ ok: false, error: "not found" }, 404);

  let update: TgUpdate;
  try {
    update = JSON.parse(row.payload) as TgUpdate;
  } catch {
    return c.json({ ok: false, error: "payload 不是合法 JSON，无法重试" }, 400);
  }

  const msg = update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
  await deps.store.forgetUpdate(update.update_id);
  if (msg) await deps.store.dropClaim(msg.chat.id, msg.message_id);

  // 先删旧记录：handleUpdate 失败时会写入新的死信，避免重复堆积
  await deps.store.deleteDeadLetter(id);

  const result: HandleResult = await handleUpdate(update, deps);
  if (result.status === "failed") {
    await deps.store.bumpNewestDeadLetter(row.attempts + 1);
  }
  return c.json({ ok: result.status === "created" || result.status === "dry_run", result });
});

api.delete("/dead-letters/:id", async (c) => {
  const deps = buildDeps(c.env);
  await deps.store.deleteDeadLetter(Number(c.req.param("id")));
  return c.json({ ok: true });
});

/** 把 Telegram Webhook 指到当前 Worker */
api.post("/actions/set-webhook", async (c) => {
  const deps = buildDeps(c.env);
  const url = new URL(c.req.url).origin + "/tg/webhook/" + deps.settings.webhookSecret;
  await deps.api.setWebhook(url, {
    secret_token: deps.settings.webhookSecret,
    allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post"],
  });
  const info = await deps.api.getWebhookInfo();
  return c.json({ ok: true, url: maskWebhookUrl(info.url), pending: info.pending_update_count ?? 0 });
});

api.post("/actions/delete-webhook", async (c) => {
  const deps = buildDeps(c.env);
  await deps.api.deleteWebhook({ drop_pending_updates: false });
  return c.json({ ok: true });
});

/** 面板上的「测试一条反馈」：合成 update 跑一遍完整流程（尊重 DRY_RUN） */
api.post("/actions/test-issue", async (c) => {
  const deps = buildDeps(c.env);
  const body = (await c.req.json().catch(() => ({}))) as { text?: string; chatId?: number; threadId?: number };
  const update = buildTestUpdate(deps.settings, {
    text: (body.text ?? "来自控制台的测试反馈：结账页点击下单后白屏").trim(),
    chatId: body.chatId,
    threadId: body.threadId,
  });
  if (!isTestUpdate(update)) return c.json({ ok: false, error: update.error }, 400);

  const result = await handleUpdate(update, deps);
  return c.json({ ok: true, result });
});

/** 自检：配置问题 + getMe + 仓库可达性 */
api.get("/selfcheck", async (c) => {
  const deps = buildDeps(c.env);
  const problems = configProblems(deps.settings);
  const result: Record<string, unknown> = {};

  try {
    const me = await withTimeout(deps.api.getMe(), 6000, "getMe");
    result.bot = { id: me.id, username: me.username };
  } catch (error) {
    problems.push("getMe 失败：" + errText(error));
  }

  if (deps.settings.ghRepo) {
    try {
      const repo = await withTimeout(deps.gh.getRepo(deps.settings.ghRepo), 6000, "getRepo");
      result.repo = { fullName: repo.full_name, private: repo.private, hasIssues: repo.has_issues };
    } catch (error) {
      problems.push("访问仓库失败：" + errText(error));
    }
  }

  return c.json({ ok: problems.length === 0, problems, ...result });
});
