# 一键部署到 Cloudflare Workers
#   pwsh -File scripts/deploy.ps1            完整流程
#   pwsh -File scripts/deploy.ps1 -SkipSecrets  只重新部署（密钥已设置过）
#
# 前置：.dev.vars 里填好 TG_BOT_TOKEN / GH_TOKEN，并确认 wrangler.local.toml（或 wrangler.toml）的 [vars] 配置。
# 密钥只从 .dev.vars 读取并通过 stdin 传给 wrangler，不会出现在命令行历史里。

param([switch]$SkipSecrets)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Read-DevVars {
  $map = @{}
  if (-not (Test-Path ".dev.vars")) { throw ".dev.vars 不存在：请先复制 .dev.vars.example 并填写" }
  foreach ($line in Get-Content ".dev.vars") {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"]*)"?\s*$') {
      $map[$matches[1]] = $matches[2].Trim()
    }
  }
  return $map
}

$config = if (Test-Path "wrangler.local.toml") { "wrangler.local.toml" } else { "wrangler.toml" }
Write-Host ("使用配置: " + $config)

$vars = Read-DevVars
$secretKeys = @("TG_BOT_TOKEN", "TG_WEBHOOK_SECRET", "GH_TOKEN", "GH_WEBHOOK_SECRET", "ADMIN_TOKEN")

if (-not $SkipSecrets) {
  $missing = @()
  foreach ($key in $secretKeys) {
    if (-not $vars[$key] -or $vars[$key] -match "REPLACE|123456:") { $missing += $key }
  }
  if ($missing.Count -gt 0) {
    throw ("这些密钥还没填好（.dev.vars）：" + ($missing -join ", "))
  }
}

# 1) 检查仓库/群 ID 这类非密钥配置
$toml = Get-Content -Raw $config
if ($toml -match 'database_id\s*=\s*"([^"]+)"') { Write-Host ("D1 database_id: " + $matches[1]) }
if ($toml -notmatch 'GH_REPO\s*=\s*"[^"]+"') { Write-Warning "wrangler.toml 里的 GH_REPO 还是空的，建 Issue 会失败" }
if ($toml -notmatch 'TG_ALLOWED_CHAT_IDS\s*=\s*"-') { Write-Warning "TG_ALLOWED_CHAT_IDS 还没填群 ID，Bot 会拒绝所有消息（fail-closed）" }

# 2) 推送密钥
if (-not $SkipSecrets) {
  foreach ($key in $secretKeys) {
    Write-Host ("-> 设置密钥 " + $key)
    $vars[$key] | node scripts/cf.mjs secret put $key | Out-Null
  }
}

# 3) 远端建表 + 部署
Write-Host "-> 应用远端数据库迁移"
node scripts/cf.mjs d1 migrations apply tg2issues --remote

Write-Host "-> 部署 Worker"
$deployOut = (node scripts/cf.mjs deploy 2>&1 | Out-String)
Write-Host $deployOut
$m = [regex]::Match($deployOut, "https://[A-Za-z0-9_.-]+\.workers\.dev")
if (-not $m.Success) { throw "没能从部署输出里解析出 Worker 地址，请手动执行 /api/actions/set-webhook" }
$base = $m.Value.TrimEnd("/")
Write-Host ("Worker 地址: " + $base)

# 4) 注册 Telegram Webhook + 自检
$headers = @{ Authorization = "Bearer " + $vars["ADMIN_TOKEN"] }
try {
  $hook = Invoke-RestMethod -Method Post -Uri ($base + "/api/actions/set-webhook") -Headers $headers -TimeoutSec 30
  Write-Host ("Webhook 已设置: " + $hook.url + "（待处理 " + $hook.pending + "）")
} catch {
  Write-Warning ("设置 Webhook 失败（可稍后在控制台点一下）：" + $_.Exception.Message)
}
try {
  $check = Invoke-RestMethod -Uri ($base + "/api/selfcheck") -Headers $headers -TimeoutSec 40
  Write-Host "---- 自检结果 ----"
  if ($check.problems.Count -eq 0) { Write-Host "OK：没有发现问题" } else { $check.problems | ForEach-Object { Write-Host ("[!] " + $_) } }
  if ($check.bot) { Write-Host ("Bot: @" + $check.bot.username) }
  if ($check.repo) { Write-Host ("仓库: " + $check.repo.fullName) }
} catch {
  Write-Warning ("自检失败：" + $_.Exception.Message)
}

Write-Host ""
Write-Host ("控制台: " + $base + "/")
Write-Host "下一步：把 Bot 拉进群，在群里发 /help 验证。"
