import { Hono } from "hono";
import type { Env } from "./config";
import { buildDeps, schedule } from "./deps";
import { handleUpdate } from "./pipeline";
import { handleGithubEvent } from "./github/webhook";
import type { GhEventPayload } from "./github/webhook";
import { timingSafeEqual, verifyGithubSignature } from "./security";
import type { TgUpdate } from "./telegram/extract";
import { errText } from "./utils";
import { api as adminApi } from "./admin";
import dashboardHtml from "./dashboard.html";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
});

app.get("/", (c) => {
  c.header("Cache-Control", "no-store");
  return c.html(dashboardHtml);
});

app.get("/healthz", async (c) => {
  try {
    const stats = await buildDeps(c.env).store.stats();
    return c.json({ ok: true, ...stats });
  } catch (error) {
    return c.json({ ok: false, error: errText(error) }, 500);
  }
});

app.post("/tg/webhook/:secret", async (c) => {
  const deps = buildDeps(c.env);
  const expected = deps.settings.webhookSecret;
  const fromPath = c.req.param("secret");
  const fromHeader = c.req.header("x-telegram-bot-api-secret-token") ?? "";
  if (!expected || !timingSafeEqual(fromPath, expected) || !timingSafeEqual(fromHeader, expected)) {
    return c.json({ ok: false, error: "forbidden" }, 403);
  }

  let update: TgUpdate;
  try {
    update = (await c.req.json()) as TgUpdate;
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }

  schedule(c, handleUpdate(update, deps));
  return c.json({ ok: true });
});

app.post("/github/webhook", async (c) => {
  const deps = buildDeps(c.env);
  const raw = await c.req.text();
  const valid = await verifyGithubSignature(raw, c.req.header("x-hub-signature-256") ?? "", deps.settings.ghWebhookSecret);
  if (!valid) return c.json({ ok: false, error: "bad signature" }, 401);

  const event = c.req.header("x-github-event") ?? "";
  const delivery = c.req.header("x-github-delivery") ?? "";
  if (delivery && (await deps.store.seenDelivery(delivery, event))) {
    return c.json({ ok: true, duplicate: true });
  }

  let payload: GhEventPayload;
  try {
    payload = JSON.parse(raw) as GhEventPayload;
  } catch {
    return c.json({ ok: false, error: "invalid json" }, 400);
  }

  schedule(c, handleGithubEvent(event, payload, deps));
  return c.json({ ok: true });
});

app.route("/api", adminApi);

export default app;
