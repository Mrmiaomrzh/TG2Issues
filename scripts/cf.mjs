#!/usr/bin/env node
// 统一的 wrangler 入口。
// 存在 wrangler.local.toml（私有部署配置，已在 .gitignore）时优先使用它，
// 否则回落到仓库里的 wrangler.toml 模板。
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const args = process.argv.slice(2);
const config = existsSync("wrangler.local.toml") ? "wrangler.local.toml" : "wrangler.toml";

if (args.length === 0) {
  console.log("用法: node scripts/cf.mjs <wrangler 子命令> [参数...]");
  console.log("当前配置: " + config);
  process.exit(1);
}

console.log("[cf] 使用配置 " + config);
const result = spawnSync("npx", ["wrangler", ...args, "--config", config], {
  stdio: "inherit",
  shell: true,
});
process.exit(result.status ?? 1);
