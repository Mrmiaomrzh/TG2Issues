import type { Deps } from "../deps";
import type { IssueMapRow } from "../store";
import { redact } from "../security";
import { errText } from "../utils";

export interface GhEventPayload {
  action?: string;
  issue?: {
    number: number;
    html_url: string;
    title: string;
    state: string;
    user?: { login: string };
    pull_request?: unknown;
  };
  comment?: {
    html_url: string;
    body?: string;
    user?: { login: string };
  };
  repository?: { full_name: string };
  sender?: { login: string };
}

const MAX_COMMENT_CHARS = 600;

function issueTarget(row: IssueMapRow) {
  return {
    chatId: row.chat_id,
    threadId: row.thread_id ?? undefined,
    messageId: row.message_id,
  };
}

export async function handleGithubEvent(event: string, payload: GhEventPayload, deps: Deps): Promise<void> {
  const repo = payload.repository?.full_name;
  const issue = payload.issue;
  if (!repo || !issue) return;
  if (issue.pull_request) return;

  const row = await deps.store.findIssue(repo, issue.number);
  if (!row) return;

  let text: string | null = null;

  if (event === "issues" && payload.action === "closed") {
    text = "Issue #" + issue.number + " 已关闭：" + issue.title + "\n" + issue.html_url;
  } else if (event === "issues" && payload.action === "reopened") {
    text = "Issue #" + issue.number + " 已重新打开：" + issue.title + "\n" + issue.html_url;
  } else if (event === "issue_comment" && payload.action === "created") {
    const author = payload.comment?.user?.login ?? "unknown";
    const raw = (payload.comment?.body ?? "").trim();
    const body = deps.settings.redactEnable ? redact(raw) : raw;
    const clipped =
      body.length > MAX_COMMENT_CHARS ? body.slice(0, MAX_COMMENT_CHARS) + "…（已截断）" : body;
    text = "@" + author + " 在 Issue #" + issue.number + " 评论：\n\n" + clipped + "\n\n" + (payload.comment?.html_url ?? issue.html_url);
  }

  if (!text) return;

  const target = issueTarget(row);
  try {
    await deps.api.sendMessage(target.chatId, text, {
      message_thread_id: target.threadId,
      link_preview_options: { is_disabled: true },
    });
  } catch (error) {
    console.error("回流 Telegram 失败", errText(error));
  }
}
