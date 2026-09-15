import { errText, sleep } from "../utils";

export interface CreateIssueOptions {
  title: string;
  body: string;
  labels?: string[];
  assignee?: string;
}

export interface CreatedIssue {
  number: number;
  html_url: string;
}

export class GithubClient {
  private token: string;
  private apiBase: string;

  constructor(token: string, apiBase = "https://api.github.com") {
    this.token = token;
    this.apiBase = apiBase.replace(/\/+$/, "");
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: "Bearer " + this.token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "tg2issues",
    };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  async request<T = unknown>(method: string, path: string, body?: unknown, attempts = 3): Promise<T> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const res = await fetch(this.apiBase + path, {
        method,
        headers: this.headers(body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (res.ok) {
        if (res.status === 204) return null as T;
        return (await res.json()) as T;
      }

      const text = (await res.text()).slice(0, 400);
      const retriable = res.status === 403 || res.status === 429 || res.status >= 500;
      lastError = new Error("GitHub " + res.status + " " + path + " -> " + text);
      if (!retriable) throw lastError;

      const retryAfter = Number(res.headers.get("retry-after") ?? "0");
      const waitMs = Math.min(retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt, 5000);
      console.warn("github retry", res.status, "in", waitMs, "ms");
      await sleep(waitMs);
    }
    throw lastError ?? new Error("GitHub 请求失败");
  }

  async createIssue(repo: string, options: CreateIssueOptions): Promise<CreatedIssue> {
    const payload: Record<string, unknown> = { title: options.title, body: options.body };
    if (options.labels && options.labels.length > 0) payload.labels = options.labels;
    if (options.assignee) payload.assignees = [options.assignee];

    try {
      return await this.request<CreatedIssue>("POST", "/repos/" + repo + "/issues", payload);
    } catch (error) {

      if (payload.labels && errText(error).includes(" 422 ")) {
        console.warn("create issue with labels failed, retry without labels");
        delete payload.labels;
        return await this.request<CreatedIssue>("POST", "/repos/" + repo + "/issues", payload);
      }
      throw error;
    }
  }

  async uploadAsset(repo: string, path: string, base64Content: string, branch: string, message: string): Promise<string> {
    const payload: Record<string, unknown> = { message, content: base64Content };
    if (branch) payload.branch = branch;

    const send = async (): Promise<string> => {
      const result = await this.request<{ content?: { download_url?: string; html_url?: string } }>(
        "PUT",
        "/repos/" + repo + "/contents/" + path,
        payload,
      );
      const url = result.content?.download_url ?? result.content?.html_url;
      if (!url) throw new Error("上传附件成功但未返回下载链接");
      return url;
    };

    try {
      return await send();
    } catch (error) {

      const text = errText(error);
      if (payload.branch && / (404|409|422) /.test(text)) {
        console.warn("指定分支上传失败，改为默认分支重试：" + text.slice(0, 120));
        delete payload.branch;
        return await send();
      }
      throw error;
    }
  }

  async getRepo(repo: string): Promise<{ full_name: string; private: boolean; has_issues: boolean }> {
    return await this.request("GET", "/repos/" + repo);
  }

  async getAuthenticatedUser(): Promise<{ login: string }> {
    return await this.request("GET", "/user");
  }
}
