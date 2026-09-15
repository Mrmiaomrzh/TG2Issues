import type { TgUpdate, Feedback } from "./telegram/extract";
import { extractFeedback, isTriggered, messageText } from "./telegram/extract";
import type { Deps } from "./deps";
import { buildBody, buildTitle, pickLabels } from "./github/render";
import { anonymousSenderId, redact, stripInjection } from "./security";
import { rehostMedia } from "./github/assets";
import { notifyAdmin, replyTo } from "./telegram/reply";
import { SUBMIT_COMMANDS, isQueryCommand, isSubmitCommand, parseCommand, runQueryCommand } from "./telegram/commands";
import { errText, safeJson } from "./utils";

export type { Deps } from "./deps";

export interface HandleResult {
  status: "created" | "dry_run" | "skipped" | "rate_limited" | "failed";
  reason?: string;
  title?: string;
  issueNumber?: number;
  issueUrl?: string;
  images?: number;
}

/** 主流程：去重 → 权限 → 命令/触发判定 → 限流 → 抢占 → 提取 → 附件 → 渲染 → 建 Issue → 回执 */
export async function handleUpdate(update: TgUpdate, deps: Deps): Promise<HandleResult> {
  const msg =
    update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
  if (!msg) return { status: "skipped", reason: "非消息类型的 update" };
  if (msg.from?.is_bot) return { status: "skipped", reason: "机器人消息" };

  const { settings, store } = deps;

  if (await store.seenUpdate(update.update_id, msg.chat.id)) {      // FR-13
    return { status: "skipped", reason: "update 已处理过（Webhook 重试）" };
  }
  if (!settings.allowedChatIds.includes(msg.chat.id)) {             // FR-16
    console.log("skip: chat 不在白名单", msg.chat.id);
    return { status: "skipped", reason: "会话不在白名单：" + msg.chat.id };
  }

  // ---- 指令路由（FR-31）----
  const cmd = parseCommand(messageText(msg));
  if (cmd && isQueryCommand(cmd.name)) {
    await runQueryCommand(cmd, msg, deps);
    return { status: "skipped", reason: "已处理查询命令 " + cmd.name };
  }
  const submitCmd = cmd && isSubmitCommand(cmd.name) ? cmd : null;

  if (!submitCmd && !isTriggered(msg, settings)) {                  // FR-2
    return { status: "skipped", reason: "未命中触发规则" };
  }

  // 命令可以绕过话题限制，同时正文里必须剥掉命令前缀
  const commands = Array.from(new Set([...settings.triggerCommands, ...SUBMIT_COMMANDS]));
  const fb: Feedback = extractFeedback(msg, update.update_id, { ...settings, triggerCommands: commands });

  if (fb.text.length === 0 && fb.media.length === 0) {
    if (submitCmd) {
      await replyTo(deps, msg, "用法：<code>" + submitCmd.name + " 你的反馈内容</code>（也可以只发图片）。");
      return { status: "skipped", reason: "命令缺少内容" };
    }
    return { status: "skipped", reason: "没有可提取的内容" };
  }

  if (fb.senderId !== undefined) {                                  // FR-17
    const allowed = await store.rateAllow(fb.senderId, settings.ratePerMin, settings.ratePerDay);
    if (!allowed) {
      await replyTo(deps, msg, "请求过于频繁，请稍后再试。");
      return { status: "rate_limited", reason: "超过限流阈值" };
    }
  }

  if (!(await store.claim(fb, settings.ghRepo))) {                  // FR-12
    return { status: "skipped", reason: "该消息已转成 Issue 或正在处理中" };
  }

  try {
    if (settings.redactEnable) fb.text = redact(fb.text);           // FR-19
    fb.text = stripInjection(fb.text).trim();

    const images: string[] = [];
    const mediaNotes: string[] = [];
    for (let i = 0; i < fb.media.length; i += 1) {                  // FR-6
      const media = fb.media[i];
      if (!media) continue;
      try {
        const url = await rehostMedia(settings, deps.api, deps.gh, fb, media, i);
        if (url) images.push(url);
        else if (media.name) mediaNotes.push("附件未转存（非图片）：" + media.name);
      } catch (error) {
        console.warn("附件转存失败", errText(error));
        mediaNotes.push("附件转存失败：" + (media.name ?? media.kind) + "（" + errText(error) + "）");
      }
    }

    const anonymousId =
      settings.anonymizeSender && fb.senderId !== undefined
        ? await anonymousSenderId(fb.senderId)                      // FR-20
        : undefined;

    const title = buildTitle(fb.text);
    const body = buildBody(fb, {
      images,
      anonymize: settings.anonymizeSender,
      anonymousId,
      timeZone: settings.timeZone,
      mediaNotes,
    });
    const labels = [...new Set([...settings.ghDefaultLabels, ...pickLabels(fb.text, settings.allowedLabels)])];

    if (settings.dryRun) {
      console.log("DRY_RUN", safeJson({ title, labels, images: images.length }));
      await store.release(fb.chatId, fb.messageId);
      await replyTo(deps, msg, "[DRY_RUN] 将创建 Issue：" + title);
      return { status: "dry_run", title, images: images.length };
    }

    const issue = await deps.gh.createIssue(settings.ghRepo, {      // FR-10
      title,
      body,
      labels,
      assignee: settings.ghDefaultAssignee,
    });
    await store.markDone(fb.chatId, fb.messageId, issue.number, issue.html_url, title); // FR-15
    await replyTo(deps, msg, "已创建 Issue <b>#" + issue.number + "</b>\n" + issue.html_url); // FR-11

    return { status: "created", title, issueNumber: issue.number, issueUrl: issue.html_url, images: images.length };
  } catch (error) {
    const message = errText(error);
    await store.markFailed(fb.chatId, fb.messageId);
    await store.deadLetter(safeJson(update), message, 1);           // FR-22
    await notifyAdmin(deps, "创建 Issue 失败：" + message + "\n标题：" + buildTitle(fb.text));
    await replyTo(deps, msg, "创建 Issue 失败，已通知管理员。");
    console.error("处理失败", message);
    return { status: "failed", reason: message, title: buildTitle(fb.text) };
  }
}
