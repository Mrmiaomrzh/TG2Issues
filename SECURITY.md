# Security Policy

## Reporting a vulnerability

Please do **not** open a public issue for security problems. Use **Security → Report a vulnerability** (GitHub private vulnerability reporting) on this repository, or contact the maintainer directly.

## Where secrets belong

| What | Where | Committed |
| --- | --- | --- |
| Bot token, GitHub PAT, webhook secrets, ADMIN_TOKEN | `wrangler secret put NAME` (production) / `.dev.vars` (local) | No |
| Real chat ids, target repo, D1 database id | `wrangler.local.toml` | No |
| Non-sensitive settings (rate limits, labels, time zone, …) | `[vars]` in `wrangler.toml` | Yes (template) |

`.dev.vars` and `wrangler.local.toml` are git-ignored. Never paste tokens into issues, pull requests, chat messages or screenshots.

If a token leaks: revoke it with BotFather (`/revoke`), regenerate the GitHub PAT, update `.dev.vars` and run `npm run deploy:ps`.

## Built-in protections

- **Telegram webhook**: the secret is validated in both the URL path and the `X-Telegram-Bot-Api-Secret-Token` header, compared in constant time.
- **GitHub webhook**: HMAC-SHA256 verification (`X-Hub-Signature-256`) plus `X-GitHub-Delivery` dedupe.
- **Fail-closed allow-list**: an empty chat allow-list rejects every message.
- **Idempotency**: `update_id` dedupe plus a per-message claim, so webhook retries never create duplicate issues.
- **Per-user rate limits** (3 per minute and 20 per day by default).
- **Secret redaction**: strings that look like PATs or API keys are replaced with `[REDACTED]` before they reach GitHub.
- **Injection protection**: HTML comments and forged provenance markers are stripped from user input, and titles/bodies are escaped.
- **Dashboard**: the page itself contains no secrets, its data API requires `ADMIN_TOKEN`, and responses carry `no-store` plus hardening headers.

## Supported versions

Only the latest revision on `main` is maintained.
