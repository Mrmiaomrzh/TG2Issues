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
