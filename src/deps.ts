import { Api } from "grammy";
import type { Context } from "hono";
import type { Env, Settings } from "./config";
import { loadSettings } from "./config";
import { Store } from "./store";
import { GithubClient } from "./github/client";
import { timingSafeEqual } from "./security";
import { errText } from "./utils";

export interface Deps {
  env: Env;
  settings: Settings;
  store: Store;
  api: Api;
  gh: GithubClient;
}

export type Ctx = Context<{ Bindings: Env }>;

export function buildDeps(env: Env): Deps {
  const settings = loadSettings(env);
  return {
    env,
    settings,
    store: new Store(env.DB),
    api: new Api(settings.botToken),
    gh: new GithubClient(settings.ghToken, settings.ghApiBase),
  };
}

export function schedule(c: Ctx, task: Promise<unknown>): void {
  const guarded = task.catch((error) => console.error("后台任务失败", errText(error)));
  try {
    c.executionCtx.waitUntil(guarded);
  } catch {

  }
}

export function adminAllowed(c: Ctx, expected: string): boolean {
  if (!expected) return false;
  const header = c.req.header("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return timingSafeEqual(bearer, expected) || timingSafeEqual(c.req.query("token") ?? "", expected);
}

export function maskWebhookUrl(url: string | undefined): string {
  if (!url) return "";
  return url.replace(/\/tg\/webhook\/[^/]+/, "/tg/webhook/***");
}
