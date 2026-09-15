import { Api } from "grammy";

export function createApi(token: string): Api {
  return new Api(token);
}

export interface DownloadedFile {
  bytes: Uint8Array;
  filePath: string;
}

/**
 * 下载 Telegram 文件。
 * 注意：Bot API 单文件上限 20MB，超过需要自建 Local Bot API Server。
 * 生成的下载 URL 含有 Bot Token，禁止写日志。
 */
export async function downloadFile(api: Api, fileId: string, maxBytes: number): Promise<DownloadedFile> {
  const file = await api.getFile(fileId);
  if (!file.file_path) throw new Error("telegram getFile 未返回 file_path");
  if ((file.file_size ?? 0) > maxBytes) {
    throw new Error("文件超过上限 " + maxBytes + " 字节（实际 " + (file.file_size ?? 0) + "）");
  }
  const url = "https://api.telegram.org/file/bot" + api.token + "/" + file.file_path;
  const res = await fetch(url);
  if (!res.ok) throw new Error("下载 Telegram 文件失败：HTTP " + res.status);
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new Error("下载后文件超过上限：" + buffer.byteLength + " 字节");
  }
  return { bytes: new Uint8Array(buffer), filePath: file.file_path };
}
