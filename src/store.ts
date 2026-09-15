import { nowIso } from "./utils";
import type { Feedback } from "./telegram/extract";

export interface IssueMapRow {
  chat_id: number;
  message_id: number;
  repo: string;
  issue_number: number | null;
  issue_url: string | null;
  title?: string | null;
  sender_id: number | null;
  thread_id: number | null;
  status: string;
  created_at: string;
}

export interface DeadLetterRow {
  id: number;
  payload?: string;
  payload_preview?: string;
  error: string;
  attempts: number;
  created_at: string;
}

export class Store {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  /** true = 这条 update 之前处理过（Webhook 重试） */
  async seenUpdate(updateId: number, chatId?: number): Promise<boolean> {
    const res = await this.db
      .prepare("INSERT OR IGNORE INTO processed_updates (update_id, chat_id, created_at) VALUES (?, ?, ?)")
      .bind(updateId, chatId ?? null, nowIso())
      .run();
    return (res.meta?.changes ?? 0) === 0;
  }

  /** 抢占一条消息的处理权；true = 抢到（首次处理），false = 已有记录 */
  async claim(fb: Feedback, repo: string): Promise<boolean> {
    const res = await this.db
      .prepare(
        "INSERT OR IGNORE INTO issue_map (chat_id, message_id, repo, sender_id, thread_id, status, created_at) " +
          "VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      )
      .bind(fb.chatId, fb.messageId, repo, fb.senderId ?? null, fb.threadId ?? null, nowIso())
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  async release(chatId: number, messageId: number): Promise<void> {
    await this.db
      .prepare("DELETE FROM issue_map WHERE chat_id = ? AND message_id = ? AND status = 'pending'")
      .bind(chatId, messageId)
      .run();
  }

  async markDone(
    chatId: number,
    messageId: number,
    issueNumber: number,
    issueUrl: string,
    title: string,
  ): Promise<void> {
    await this.db
      .prepare(
        "UPDATE issue_map SET issue_number = ?, issue_url = ?, title = ?, status = 'done' " +
          "WHERE chat_id = ? AND message_id = ?",
      )
      .bind(issueNumber, issueUrl, title.slice(0, 300), chatId, messageId)
      .run();
  }

  /** 按消息定位 Issue（/link 指令用） */
  async findByMessage(chatId: number, messageId: number): Promise<IssueMapRow | null> {
    return await this.db
      .prepare("SELECT * FROM issue_map WHERE chat_id = ? AND message_id = ? LIMIT 1")
      .bind(chatId, messageId)
      .first<IssueMapRow>();
  }

  async markFailed(chatId: number, messageId: number): Promise<void> {
    await this.db
      .prepare("UPDATE issue_map SET status = 'failed' WHERE chat_id = ? AND message_id = ?")
      .bind(chatId, messageId)
      .run();
  }

  async hasIssue(chatId: number, messageId: number): Promise<boolean> {
    const row = await this.db
      .prepare("SELECT chat_id FROM issue_map WHERE chat_id = ? AND message_id = ? LIMIT 1")
      .bind(chatId, messageId)
      .first<{ chat_id: number }>();
    return row !== null;
  }

  /** Issue -> 原 TG 消息定位（双向同步用） */
  async findIssue(repo: string, issueNumber: number): Promise<IssueMapRow | null> {
    return await this.db
      .prepare("SELECT * FROM issue_map WHERE repo = ? AND issue_number = ? LIMIT 1")
      .bind(repo, issueNumber)
      .first<IssueMapRow>();
  }

  /** 滑动窗口限流；true = 放行 */
  async rateAllow(userId: number, perMin: number, perDay: number): Promise<boolean> {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    const day = await this.db
      .prepare("SELECT COUNT(*) AS c FROM rate_events WHERE user_id = ? AND ts > ?")
      .bind(userId, dayAgo)
      .first<{ c: number }>();
    const minute = await this.db
      .prepare("SELECT COUNT(*) AS c FROM rate_events WHERE user_id = ? AND ts > ?")
      .bind(userId, now - 60_000)
      .first<{ c: number }>();

    if ((day?.c ?? 0) >= perDay || (minute?.c ?? 0) >= perMin) return false;

    await this.db.prepare("INSERT INTO rate_events (user_id, ts) VALUES (?, ?)").bind(userId, now).run();

    if (Math.random() < 0.05) {
      await this.db.prepare("DELETE FROM rate_events WHERE ts < ?").bind(now - 7 * 24 * 60 * 60 * 1000).run();
    }
    return true;
  }

  async deadLetter(payload: string, error: string, attempts: number): Promise<void> {
    await this.db
      .prepare("INSERT INTO dead_letters (payload, error, attempts, created_at) VALUES (?, ?, ?, ?)")
      .bind(payload.slice(0, 8000), error.slice(0, 1000), attempts, nowIso())
      .run();
  }

  /** true = 该 delivery 之前已处理过 */
  async seenDelivery(deliveryId: string, event: string): Promise<boolean> {
    const res = await this.db
      .prepare("INSERT OR IGNORE INTO gh_deliveries (delivery_id, event, created_at) VALUES (?, ?, ?)")
      .bind(deliveryId, event, nowIso())
      .run();
    return (res.meta?.changes ?? 0) === 0;
  }

  /** 清除某条 update 的去重记录（死信重试用） */
  async forgetUpdate(updateId: number): Promise<void> {
    await this.db.prepare("DELETE FROM processed_updates WHERE update_id = ?").bind(updateId).run();
  }

  /** 释放某条消息的占用（死信重试用） */
  async dropClaim(chatId: number, messageId: number): Promise<void> {
    await this.db.prepare("DELETE FROM issue_map WHERE chat_id = ? AND message_id = ?").bind(chatId, messageId).run();
  }

  /** 面板：反馈记录分页查询 */
  async listIssues(options: {
    limit: number;
    offset: number;
    status?: string;
    q?: string;
    chatId?: number;
  }): Promise<{ items: IssueMapRow[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (options.chatId !== undefined) {
      where.push("chat_id = ?");
      params.push(options.chatId);
    }
    if (options.status) {
      where.push("status = ?");
      params.push(options.status);
    }
    if (options.q) {
      const like = "%" + options.q + "%";
      where.push(
        "(CAST(chat_id AS TEXT) LIKE ? OR CAST(message_id AS TEXT) LIKE ? " +
          "OR IFNULL(CAST(issue_number AS TEXT), '') LIKE ? OR IFNULL(issue_url, '') LIKE ?)",
      );
      params.push(like, like, like, like);
    }

    const whereSql = where.length > 0 ? " WHERE " + where.join(" AND ") : "";

    const total = await this.db
      .prepare("SELECT COUNT(*) AS c FROM issue_map" + whereSql)
      .bind(...params)
      .first<{ c: number }>();

    const rows = await this.db
      .prepare("SELECT * FROM issue_map" + whereSql + " ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .bind(...params, options.limit, options.offset)
      .all<IssueMapRow>();

    return { items: rows.results ?? [], total: total?.c ?? 0 };
  }

  /** 面板：最近 N 天每天的建 Issue 数（含 0 的日期由调用方补齐） */
  async dailyCounts(days: number): Promise<Array<{ day: string; c: number }>> {
    const since = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const rows = await this.db
      .prepare(
        "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS c FROM issue_map " +
          "WHERE substr(created_at, 1, 10) >= ? GROUP BY day ORDER BY day",
      )
      .bind(since)
      .all<{ day: string; c: number }>();
    return rows.results ?? [];
  }

  /** 面板：最近 24 小时建 Issue 数 */
  async last24hCount(): Promise<number> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const row = await this.db
      .prepare("SELECT COUNT(*) AS c FROM issue_map WHERE created_at >= ?")
      .bind(since)
      .first<{ c: number }>();
    return row?.c ?? 0;
  }

  /** 面板：每个会话的反馈量 Top N */
  async topChats(limit = 5): Promise<Array<{ chat_id: number; thread_id: number | null; c: number }>> {
    const rows = await this.db
      .prepare("SELECT chat_id, thread_id, COUNT(*) AS c FROM issue_map GROUP BY chat_id, thread_id ORDER BY c DESC LIMIT ?")
      .bind(limit)
      .all<{ chat_id: number; thread_id: number | null; c: number }>();
    return rows.results ?? [];
  }

  /** 面板：死信队列 */
  async listDeadLetters(limit = 50, offset = 0): Promise<{ items: DeadLetterRow[]; total: number }> {
    const total = await this.db.prepare("SELECT COUNT(*) AS c FROM dead_letters").first<{ c: number }>();
    const rows = await this.db
      .prepare("SELECT id, error, attempts, created_at, substr(payload, 1, 240) AS payload_preview FROM dead_letters ORDER BY id DESC LIMIT ? OFFSET ?")
      .bind(limit, offset)
      .all<DeadLetterRow>();
    return { items: rows.results ?? [], total: total?.c ?? 0 };
  }

  async getDeadLetter(id: number): Promise<DeadLetterRow | null> {
    return await this.db.prepare("SELECT * FROM dead_letters WHERE id = ?").bind(id).first<DeadLetterRow>();
  }

  /** 死信重试失败后累加尝试次数 */
  async bumpNewestDeadLetter(attempts: number): Promise<void> {
    await this.db
      .prepare("UPDATE dead_letters SET attempts = ? WHERE id = (SELECT MAX(id) FROM dead_letters)")
      .bind(attempts)
      .run();
  }

  async deleteDeadLetter(id: number): Promise<void> {
    await this.db.prepare("DELETE FROM dead_letters WHERE id = ?").bind(id).run();
  }

  async stats(): Promise<Record<string, number>> {
    const row = await this.db
      .prepare(
        "SELECT " +
          "(SELECT COUNT(*) FROM issue_map WHERE status = 'done') AS issues, " +
          "(SELECT COUNT(*) FROM issue_map WHERE status = 'pending') AS pending, " +
          "(SELECT COUNT(*) FROM dead_letters) AS dead_letters, " +
          "(SELECT COUNT(*) FROM processed_updates) AS updates",
      )
      .first<{ issues: number; pending: number; dead_letters: number; updates: number }>();
    return {
      issues: row?.issues ?? 0,
      pending: row?.pending ?? 0,
      deadLetters: row?.dead_letters ?? 0,
      updates: row?.updates ?? 0,
    };
  }
}
