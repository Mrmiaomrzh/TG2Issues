import type { Api } from "grammy";
import type { Settings } from "../config";
import type { Feedback, MediaRef } from "../telegram/extract";
import type { GithubClient } from "./client";
import { extFromPath, toBase64 } from "../utils";
import { downloadFile } from "../telegram/api";

export function assetPath(prefix: string, fb: Feedback, index: number, ext: string): string {
  const when = new Date((fb.date ?? Math.floor(Date.now() / 1000)) * 1000);
  const year = when.getUTCFullYear();
  const month = String(when.getUTCMonth() + 1).padStart(2, "0");
  return [prefix, String(year), month, fb.chatId + "_" + fb.messageId + "_" + index + "." + ext].join("/");
}

/**
 * 把图片/文件转存到 assets 仓库（GitHub 没有公开的 Issue 附件上传 API，只能转存后引用链接）。
 * 返回可引用的 URL；非图片文件返回 null，由调用方决定是否只记文件名。
 */
export async function rehostMedia(
  settings: Settings,
  api: Api,
  gh: GithubClient,
  fb: Feedback,
  media: MediaRef,
  index: number,
): Promise<string | null> {
  if (media.kind === "document" && media.mimeType && !/^image\//.test(media.mimeType)) {
    return null;
  }
  const downloaded = await downloadFile(api, media.fileId, settings.assetMaxBytes);
  const ext = extFromPath(downloaded.filePath, media.kind === "photo" ? "jpg" : "bin");
  const path = assetPath(settings.assetPrefix, fb, index, ext);
  return await gh.uploadAsset(
    settings.assetRepo,
    path,
    toBase64(downloaded.bytes),
    settings.assetBranch,
    "tg2issues: " + fb.chatId + "/" + fb.messageId,
  );
}
