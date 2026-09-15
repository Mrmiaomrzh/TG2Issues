-- 0001_init.sql —— tg2issues 初始表结构

-- 已处理过的 Telegram update（Webhook 重试去重）
CREATE TABLE IF NOT EXISTS processed_updates (
  update_id  INTEGER PRIMARY KEY,
  chat_id    INTEGER,
  created_at TEXT NOT NULL
);

-- TG 消息 与 GitHub Issue 的映射（幂等核心表）
CREATE TABLE IF NOT EXISTS issue_map (
  chat_id      INTEGER NOT NULL,
  message_id   INTEGER NOT NULL,
  repo         TEXT    NOT NULL,
  issue_number INTEGER,
  issue_url    TEXT,
  sender_id    INTEGER,
  thread_id    INTEGER,
  status       TEXT    NOT NULL DEFAULT 'pending', -- pending | done | failed
  created_at   TEXT    NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_issue_map_number ON issue_map (repo, issue_number);
CREATE INDEX IF NOT EXISTS idx_issue_map_status ON issue_map (status, created_at);

-- 失败任务（重试耗尽后落库，人工处理）
CREATE TABLE IF NOT EXISTS dead_letters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  payload    TEXT NOT NULL,
  error      TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- 限流事件（滑动窗口统计）
CREATE TABLE IF NOT EXISTS rate_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ts      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_events_user_ts ON rate_events (user_id, ts);

-- GitHub Webhook 投递去重（X-GitHub-Delivery）
CREATE TABLE IF NOT EXISTS gh_deliveries (
  delivery_id TEXT PRIMARY KEY,
  event       TEXT,
  created_at  TEXT NOT NULL
);
