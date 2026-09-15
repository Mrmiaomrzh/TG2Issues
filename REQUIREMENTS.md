# TG2Issues · 需求与实现方案（v0.1 待评审）

> **一句话**：把 Telegram 群组/频道里的「提示、反馈、建议、Bug 报告」自动转换成 GitHub 仓库里的 Issue，并保留双向可追溯。

- 目标形态：一个长期在线的小型服务（Bot），监听指定 TG 会话 → 校验权限 → 提取内容 → 创建 Issue → 回执链接。
- 首版范围（MVP）：**文本 + 图片**，单一目标仓库，会话白名单，幂等去重，限流，本地/Docker 部署。
- 非目标（首版不做）：Issue→TG 双向同步（放 M4）、多仓库智能路由、AI 摘要、>20MB 附件。

---

## 1. 背景与使用场景

社区通过 Telegram 收集反馈，但反馈散落在聊天记录里：会丢、无法跟踪、无法分配、无法统计。GitHub Issues 是天然的反馈池，但要求用户有 GitHub 账号、能访问、会写 Issue —— 门槛太高。

| 场景 | 描述 |
| --- | --- |
| 社区群收集 Bug | 用户在群里描述问题并附图，Bot 自动建 Issue，维护者直接在 GitHub 处理 |
| 频道/私聊提建议 | 用户私聊 Bot 提建议，Bot 建 Issue 并回消息告知链接 |
| 内部测试群 | 测试同学在群里贴截图，自动进入私有仓库 Issue 列表 |
| 客服工单入口 | 把「提示」规范成 Issue，用 label 区分类型并分配负责人 |

---

## 2. 功能需求（FR）

### 2.1 消息接入与触发
- **FR-1** 支持 Long Polling 与 Webhook 两种接入方式，通过配置切换（默认 Polling，生产建议 Webhook）。
- **FR-2** 触发方式可配置（三选一）：
  - 命令触发：消息以 `/issue`、`/bug`、`/suggest` 开头（推荐默认，公群防刷屏）。
  - 话题触发：消息位于指定 `message_thread_id` 的 Topic 内（论坛群）。
  - 全量触发：白名单会话内所有消息都转发（仅适合私有小群）。
- **FR-3** 支持回复触发：对某条消息回复 `/issue` 时，把「被回复消息 + 当前消息」合并为反馈内容。
- **FR-4**（v1.1）消息编辑同步更新 Issue 正文；消息删除只记日志，不自动关闭 Issue。

### 2.2 内容提取与转换
- **FR-5** 提取文本（text / caption），保留原文排版，对会破坏 Issue 结构的字符做转义。
- **FR-6** 提取附件：图片（photo，取最大分辨率）、文档（document，受大小策略约束）、语音/视频（v1.1）。
- **FR-7** 生成标题：取正文首行（去命令前缀），折叠空白，截断至 80 字符；为空时用「来自 Telegram 的反馈 YYYY-MM-DD HH:mm」。
- **FR-8** 生成正文：反馈正文 + 可折叠的来源元信息（会话、发送者、原始消息链接、时间、消息 ID）。
- **FR-9** 标签映射：正文中的 `#bug#suggestion` 命中白名单标签则附加到 Issue，未命中忽略（不报错）。
- **FR-10** 固定附加标签（如 `from-telegram`）用于溯源筛选；可配置默认 assignee / milestone。
- **FR-11** 回执：创建成功后在被触发的会话回复 Issue 链接；失败时回复简要原因（不暴露内部细节）。

### 2.3 幂等、去重与状态
- **FR-12** 同一条 TG 消息只允许产生一个 Issue（`chat_id + message_id` 唯一约束）。
- **FR-13** 同一 `update_id` 重复投递（Webhook 重试）必须被忽略。
- **FR-14** Issue 正文写入隐藏标记 `<!-- tg2issues: chat=.. msg=.. -->`，作为数据库丢失时的兜底对账依据。
- **FR-15** 维护 `tg ↔ issue` 映射表，供回执、编辑同步、统计使用。

### 2.4 权限、限流与安全
- **FR-16** 会话白名单（chat_id）与用户白名单；白名单为空时**默认拒绝一切**（fail-closed）。
- **FR-17** 用户级限流（默认 3 条/分钟、20 条/天）+ 全局熔断（如 200 条/小时），超限只提示不建 Issue。
- **FR-18** Webhook 必须校验 `X-Telegram-Bot-Api-Secret-Token`；GitHub 回传必须校验 `X-Hub-Signature-256`（HMAC-SHA256）。
- **FR-19** 敏感信息脱敏：正则过滤 GitHub PAT（`ghp_/github_pat_`）、`sk-` 开头的 Key、`token=xxx` 等，替换为 `[REDACTED]`。
- **FR-20** 隐私提示与匿名化：可配置不公开 TG 用户名（署名替换为 ID 哈希），或在群内置顶转发告知。

### 2.5 可靠性与可观测
- **FR-21** Webhook 请求 3 秒内返回 200（先入队后处理），避免 TG 重试风暴。
- **FR-22** GitHub 调用失败按指数退避重试 3 次，仍失败进死信队列并通知管理员。
- **FR-23** 结构化日志 + `/healthz` 存活检查 + 控制台统计（成功/失败/重试/被限流数）。

### 2.6 管理能力（v1.1+）
- **FR-24** `/close #123`、`/retry`、`/stats` 等管理命令，仅管理员可用。
- **FR-25** Issue 评论/关闭回流到原 TG 会话通知（M4）。

### 2.7 控制台与 Web 界面（v0.2 已实现）
- **FR-26** 提供 Web 控制台：概览指标（已建 Issue / 处理中 / 死信 / 收到 update / 触发模式）、反馈记录分页与筛选、死信队列、运行状态、配置体检。
- **FR-27** 控制台是**零依赖静态页面**（原生 HTML/CSS/JS，无构建步骤），页面本身不含密钥；数据一律走 `/api/*`。
- **FR-28** 数据接口统一用 `ADMIN_TOKEN` 鉴权（`Authorization: Bearer` 或 `?token=`），定长比较，令牌为空时全部拒绝；页面响应带 `no-store` 与安全响应头。
- **FR-29** 死信可一键重试：清掉该 update 的去重记录与消息占用后重跑完整流程；重试仍失败时累加 attempts 且不重复堆积条目。
- **FR-30** 控制台可直接发出一条测试反馈，走完整校验链路（白名单 / 限流 / 渲染 / 建 Issue），便于上线前验证。

### 2.8 Telegram 指令（v0.3 已实现）
- **FR-31** 提交型指令：`/issue <内容>`（同义 `/bug`、`/suggest`）把内容直接转成 Issue，可只发图片；缺少内容时回复用法提示。
- **FR-32** 查询型指令：`/issues [数量]`（**默认只列当前会话**的反馈，默认 5 条上限 20）、`/issues all [数量]`（跨会话，需 `TG_ALLOWED_USER_IDS` 授权）、`/link`（回复某条消息后查询其对应 Issue）、`/stats`（统计）、`/status`（运行状态）、`/help` / `/start`（帮助）。
- **FR-32.1** 支持「普通群聊 + 纯指令」形态：`TG_TRIGGER_MODE=command` + `TG_ALLOWED_CHAT_IDS` 指定群，`TG_TOPIC_IDS` 留空；无需关闭 Bot 隐私模式，也无需管理员权限。
- **FR-33** 指令可绕过 topic 触发限制，但仍受会话白名单、update 去重、消息占用、每用户限流约束；查询型指令不计入限流额度。
- **FR-34** 指令回复统一走 HTML parse_mode，用户内容与错误信息一律转义，避免注入。
- **FR-35** 指令参数解析需兼容 `/issues@my_bot 5` 形式，并在建 Issue 前剥掉命令前缀。

---

## 3. 非功能需求（NFR）

| 类别 | 要求 |
| --- | --- |
| 安全 | 密钥仅存环境变量/密钥管理；不进日志、不入库、不进 Issue 正文；Token 最小权限 |
| 隐私 | 反馈内容将**公开发布**在 Issue，需显式告知；支持匿名化；可选「先私聊确认再发布」 |
| 可用性 | 单实例可跑；崩溃自动重启；幂等表持久化，重启不重复建 Issue |
| 性能 | 文本端到端 ≤5s；图片 ≤15s；单实例可承载 <5 条/秒（远超实际需求） |
| 成本 | 可 0 成本运行（本机 / 免费 VPS / Cloudflare Workers 免费额度） |
| 可维护 | 单文件配置 + 环境变量；无状态优先，唯一有状态的是 SQLite/KV 幂等表；含 Docker 一键部署 |
| 兼容 | 支持 GitHub.com 与 GitHub Enterprise（API Base 可配置） |
| 国际化 | 不改写用户原文；Bot 回复文案支持 zh-CN / en |

---

## 4. 关键技术决策（含推荐）

### 4.1 技术栈
| 方案 | 优点 | 缺点 | 推荐 |
| --- | --- | --- | --- |
| **Python 3.11+ / python-telegram-bot v21+ / FastAPI / httpx / SQLite** | 生态成熟、文档多、图片处理方便、易读易改 | 部署体积略大 | ⭐ 推荐（本机已装 Python 3.13） |
| Node 20+ / grammY / Hono / better-sqlite3 | 类型好、Workers 友好、部署轻 | 生态略分散 | ⭐ 备选（无服务器优先时） |
| Go / telebot | 单二进制、内存小 | 开发速度慢 | 资源极度受限场景 |

### 4.2 Telegram 接入方式
| 方式 | 说明 | 适用 |
| --- | --- | --- |
| Long Polling（`getUpdates`） | 无需公网 IP、域名、证书 | MVP、内网/个人服务器 ✅ 起步推荐 |
| Webhook | 需公网 HTTPS，`setWebhook` 带 `secret_token` | 生产、Serverless ✅ |
| 自建 Local Bot API Server | 解除 Bot 下载文件 20MB 限制，可收发 2GB | 大附件需求时 |

> 注意：Bot API 下载文件上限 **20MB**（`getFile` 拿到 file_path 后下载），超出需自建本地 Bot API Server。

### 4.3 GitHub 认证方式
| 方式 | 优点 | 缺点 | 适用 |
| --- | --- | --- | --- |
| Fine-grained PAT（Issues RW + Contents RW，限定单仓库） | 5 分钟配好、权限最小化 | 会过期需轮换；按用户配额 5000/h | ✅ MVP 推荐 |
| Classic PAT（`repo`/`public_repo`） | 兼容老工具 | 权限过大 | 不推荐 |
| **GitHub App**（Installation Token） | 不绑人、按安装配额、权限精细、自动轮换 | 需私钥 + JWT + 安装流程，配置成本高 | 生产 / 多仓库 ✅ 目标形态 |

### 4.4 附件（图片）落地方式 —— 本项目最大的坑
**GitHub 没有公开的 Issue 附件上传 API**。网页版拖拽上传走的是 `github.com/upload/policies/assets` + `uploads.github.com`，依赖登录 Cookie 与 `authenticity_token`，非公开接口，不适合机器人长期使用。

| 方案 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **A. 转存到 assets 仓库/分支**（推荐） | 用 Contents API `PUT /repos/{owner}/{repo}/contents/{path}` 把图片提交到独立 assets 仓库（或同仓库 `assets` 分支），正文引用 raw.githubusercontent.com / jsDelivr | 稳定、永久、无第三方依赖、可控可清理 | 仓库体积增长；私有仓库的 raw 链接对 Issue 读者不可见 |
| B. 第三方图床 | 上传 catbox/imgur/S3/自建 CDN 后引用 | 不污染仓库 | 依赖第三方可用性与隐私，链接可能失效 |
| C. 逆向网页上传接口 | 复用 Cookie 调 `upload/policies/assets` | 能得到官方 CDN 链接 | 非公开 API，随时可能变，不建议生产 |
| D. 仅转发文本 | 图片只写文件名 | 最简单 | 丢失关键信息 |

> **结论**：MVP 用方案 A 的缩小版（提交到目标仓库 `assets/tg/YYYY/MM/` 或独立 assets 仓库），失败时降级为「图片未转发 + 提示用户」。

### 4.5 运行形态
| 形态 | 说明 |
| --- | --- |
| 云服务器 + Docker Compose | ⭐ 生产最省心 |
| systemd / Windows 服务（NSSM、任务计划） | 无 Docker 环境适用（**当前开发机为 Windows 10、未安装 Docker**，本机联调直接跑 Python） |
| Cloudflare Workers + D1/KV | 免费免运维，需 Webhook；附件转存走 fetch 中继 |
| Vercel / 其他 Serverless | 可行，注意冷启动与 10~60s 超时，务必异步建 Issue |

---

## 5. 总体架构

```
Telegram（群 / 频道 / 私聊）
        │ update（polling 或 webhook）
        ▼
┌──────────────────────────────────────────────┐
│ tg2issues 服务                                │
│ ① 接入层   webhook(校验 secret) / polling      │
│ ② 安全层   白名单 → 限流 → 脱敏 → 触发判定      │
│ ③ 提取层   message → Feedback{text, media, meta}│
│ ④ 渲染层   Feedback → {title, body, labels}    │
│ ⑤ 执行层   附件转存 → 建 Issue → 回执           │
│ ⑥ 存储     SQLite: processed_updates/issue_map │
│ ⑦ 队列     重试、死信、限速串行化               │
└──────────────────────────────────────────────┘
        │ REST（PAT 或 App Token）
        ▼
GitHub 仓库 Issues  ◀── 反向 Webhook（M4：评论/关闭 → 通知 TG）
```

**正常路径（文本反馈）**
1. 收到 update → 校验来源/白名单 → 命中触发规则。
2. `update_id` 去重 → 提取内容 → 脱敏 → 限流检查。
3. 渲染 Issue 草稿（title / body / labels，含隐藏标记）。
4. 若含图片：下载（`getFile`，≤20MB）→ 转存 → 得到外链。
5. `POST /repos/{owner}/{repo}/issues` → 得到 number 与 html_url。
6. 写 issue_map → 回复原会话链接。
7. 失败：指数退避重试 3 次 → 死信 + 通知管理员。

---

## 6. 数据模型（SQLite）

```sql
CREATE TABLE processed_updates (
  update_id  INTEGER PRIMARY KEY,
  chat_id    INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE issue_map (
  chat_id      INTEGER NOT NULL,
  message_id   INTEGER NOT NULL,
  repo         TEXT    NOT NULL,
  issue_number INTEGER NOT NULL,
  issue_url    TEXT    NOT NULL,
  sender_id    INTEGER,
  created_at   TEXT    NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);
CREATE INDEX idx_issue_map_number ON issue_map(repo, issue_number);

CREATE TABLE dead_letters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  payload    TEXT NOT NULL,   -- 原始 update JSON（已脱敏）
  error      TEXT NOT NULL,
  attempts   INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE rate_events (
  user_id INTEGER NOT NULL,
  ts      INTEGER NOT NULL
);
CREATE INDEX idx_rate_user_ts ON rate_events(user_id, ts);
```

---

## 7. 转换规则明细

### 7.1 字段映射
| TG 元素 | Issue 字段 | 规则 |
| --- | --- | --- |
| 正文（text/caption） | body | 原文保留，去命令前缀，转义危险字符 |
| 首行 | title | 折叠空白、截断 80 字、去 `#` 与引用符号；空则兜底标题 |
| `#bug#建议` 等 | labels | 仅接受白名单标签 |
| 图片/文件 | body 内 Markdown | 转存后引用外链；失败则附文件名说明 |
| 发送者 | body 元信息 / 可选 assignees | 默认不 @ 人；可配置 TG↔GitHub 映射 |
| 会话与话题 | labels + 元信息 | v1.1 支持按 chat_id/thread_id 路由到不同仓库 |

### 7.2 Issue 正文模板
```markdown
<!-- tg2issues: chat=-1001234567890 msg=4242 -->
**反馈内容**

<用户原文>

![image](https://raw.githubusercontent.com/owner/assets/main/tg/2025/01/4242_1.jpg)

<details><summary>来源信息</summary>

- 来源：Telegram 群「XXX」
- 发送者：@alice（TG ID 12345）
- 原始消息：[查看](https://t.me/c/1234567890/4242)
- 接收时间：2025-01-01 12:00:00 +08:00
- 消息 ID：4242 · update_id 987654321

</details>
```
> 私有超级群消息链接形如 `https://t.me/c/<internal_id>/<message_id>`（去掉 `-100` 前缀）；公开群/频道用 `https://t.me/<username>/<message_id>`。

### 7.3 标题规则
- 先取首行（先剥掉 `#`/`>`/列表符号等前缀）；若首行不足 4 字（如「啊」「求助」），再用后续行拼接补足上下文。
- 超长按 80 字符截断并加省略号；完整原文仍保留在正文中以便搜索。
- 允许不同反馈拥有相同标题，靠 issue_map 区分，**不**自动追加序号。

---

## 8. 实现要点与代码骨架（Python 版）

### 8.1 目录结构
```
tg2issues/
├─ app/
│  ├─ main.py              # 入口：polling 或 webhook(FastAPI)
│  ├─ config.py            # 环境变量加载 + 启动自检
│  ├─ pipeline.py          # 主流程编排（安全→提取→渲染→执行）
│  ├─ telegram/
│  │  ├─ bot.py            # Bot 封装（发送、下载文件、getMe 自检）
│  │  └─ extract.py        # update → Feedback
│  ├─ github/
│  │  ├─ client.py         # REST 客户端（重试、退避、限流处理）
│  │  ├─ render.py         # Feedback → title/body/labels
│  │  └─ assets.py         # 附件转存（Contents API）
│  ├─ security.py          # 白名单、限流、脱敏、签名校验
│  ├─ store.py             # SQLite 访问层
│  └─ queue.py             # 任务队列 + 重试 + 死信
├─ tests/                  # pytest：渲染/去重/限流/脱敏
├─ .env.example
├─ pyproject.toml
├─ Dockerfile
├─ docker-compose.yml
└─ README.md
```

### 8.2 环境变量清单
| 变量 | 必填 | 说明 |
| --- | --- | --- |
| TG_BOT_TOKEN | ✅ | BotFather 获取 |
| TG_MODE | ✅ | polling / webhook |
| TG_WEBHOOK_SECRET | webhook 必填 | 校验请求头 X-Telegram-Bot-Api-Secret-Token |
| PUBLIC_BASE_URL | webhook 必填 | 例如 https://your.host |
| TG_ALLOWED_CHAT_IDS | ✅ | 逗号分隔；**留空 = 拒绝全部** |
| TG_ALLOWED_USER_IDS | 否 | 白名单用户；管理员也在其中 |
| TG_TRIGGER_MODE | ✅ | command / topic / all |
| TG_TRIGGER_COMMANDS | 否 | 默认 /issue,/bug,/suggest |
| TG_ADMIN_CHAT_ID | 建议 | 告警接收 |
| GH_TOKEN | ✅（PAT 模式） | Fine-grained PAT：Issues RW + Contents RW |
| GH_APP_ID / GH_APP_PRIVATE_KEY / GH_INSTALLATION_ID | App 模式 | 三件套 |
| GH_REPO | ✅ | owner/repo（多仓库用逗号分隔，v1.1） |
| GH_DEFAULT_LABELS | 否 | 默认 from-telegram |
| GH_DEFAULT_ASSIGNEE | 否 | 默认负责人 |
| GH_API_BASE | 否 | GHES 用，默认 https://api.github.com |
| ASSET_MODE | 否 | commit（默认）/ upload（第三方图床） |
| ASSET_REPO / ASSET_BRANCH / ASSET_PREFIX | 否 | 默认同仓库 main 分支 assets/tg/ |
| DB_PATH | 否 | 默认 ./data/tg2issues.db |
| RATE_PER_MIN / RATE_PER_DAY | 否 | 默认 3 / 20 |
| REDACT_ENABLE | 否 | 默认 true |
| ANONYMIZE_SENDER | 否 | 默认 false |
| DRY_RUN | 否 | true 时只打印将创建的 Issue，不真建 |

### 8.3 核心骨架

```python
# app/config.py
from pydantic import Field
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    tg_bot_token: str
    tg_mode: str = "polling"                 # polling | webhook
    tg_webhook_secret: str = ""
    public_base_url: str = ""
    tg_allowed_chat_ids: list[int] = Field(default_factory=list)   # 空 = 拒绝全部
    tg_allowed_user_ids: list[int] = Field(default_factory=list)
    tg_trigger_mode: str = "command"         # command | topic | all
    tg_trigger_commands: list[str] = ["/issue", "/bug", "/suggest"]
    gh_token: str = ""
    gh_repo: str = ""
    gh_default_labels: list[str] = ["from-telegram"]
    gh_default_assignee: str | None = None
    db_path: str = "./data/tg2issues.db"
    rate_per_min: int = 3
    rate_per_day: int = 20
    redact_enable: bool = True
    anonymize_sender: bool = False
    dry_run: bool = False
```

```python
# app/telegram/extract.py
from dataclasses import dataclass, field

@dataclass
class Feedback:
    chat_id: int
    message_id: int
    update_id: int
    text: str
    media: list[dict] = field(default_factory=list)   # [{file_id, kind, name}]
    sender_id: int | None = None
    sender_name: str | None = None
    thread_id: int | None = None
    chat_title: str | None = None
    reply_to: dict | None = None

def is_triggered(msg: dict, s) -> bool:
    text = (msg.get("text") or msg.get("caption") or "").strip()
    if s.tg_trigger_mode == "all":
        return True
    if s.tg_trigger_mode == "topic":
        return msg.get("message_thread_id") in getattr(s, "tg_topic_ids", [])
    if not text:
        return False
    first = text.split()[0].split("@")[0].lower()
    return first in [c.lower() for c in s.tg_trigger_commands]

def strip_command(text: str, commands: list[str]) -> str:
    for c in commands:
        if text.lower().startswith(c.lower()):
            return text[len(c):].strip()
    return text.strip()

def extract(msg: dict, update_id: int, commands: list[str]) -> Feedback:
    text = strip_command(msg.get("text") or msg.get("caption") or "", commands)
    media = []
    if msg.get("photo"):
        media.append({"file_id": msg["photo"][-1]["file_id"], "kind": "photo"})
    if msg.get("document"):
        d = msg["document"]
        media.append({"file_id": d["file_id"], "kind": "document",
                      "name": d.get("file_name"), "size": d.get("file_size")})
    frm = msg.get("from") or {}
    return Feedback(
        chat_id=msg["chat"]["id"], message_id=msg["message_id"], update_id=update_id,
        text=text, media=media, sender_id=frm.get("id"),
        sender_name=frm.get("username") or frm.get("first_name"),
        thread_id=msg.get("message_thread_id"), chat_title=msg["chat"].get("title"),
    )
```

```python
# app/github/render.py
import re, html

TAG_RE = re.compile(r"(?<![\w/])#([A-Za-z0-9_\-\u4e00-\u9fa5]{1,24})")

def build_title(text: str, max_len: int = 80) -> str:
    first = next((l.strip() for l in text.splitlines() if l.strip()), "")
    if len(first) < 8:
        first = " ".join(text.split())
    first = re.sub(r"^[#>*\-\s]+", "", first).strip() or "来自 Telegram 的反馈"
    return first[:max_len] + ("..." if len(first) > max_len else "")

def pick_labels(text: str, allowed: list[str]) -> list[str]:
    found = {m.group(1).lower() for m in TAG_RE.finditer(text)}
    return [l for l in allowed if l.lower() in found]

def tg_message_link(chat_id: int, message_id: int) -> str:
    cid = str(chat_id)
    inner = cid[4:] if cid.startswith("-100") else cid.lstrip("-")
    return f"https://t.me/c/{inner}/{message_id}"

def build_body(fb, images: list[str], anonymize: bool = False) -> str:
    marker = f"<!-- tg2issues: chat={fb.chat_id} msg={fb.message_id} -->"
    sender = "匿名" if anonymize else f"{fb.sender_name or '未知'}（TG ID {fb.sender_id}）"
    imgs = "\n".join(f"![image]({u})" for u in images)
    quoted = "\n".join("> " + l for l in fb.text.splitlines())
    return (
        marker + "\n"
        + "**反馈内容**\n\n" + quoted + "\n\n"
        + (imgs + "\n\n" if imgs else "")
        + "<details><summary>来源信息</summary>\n\n"
        + f"- 来源：Telegram「{fb.chat_title or fb.chat_id}」\n"
        + f"- 发送者：{sender}\n"
        + f"- 原始消息：[查看]({tg_message_link(fb.chat_id, fb.message_id)})\n"
        + f"- 消息 ID：{fb.message_id} · update_id {fb.update_id}\n\n"
        + "</details>\n"
    )
```

```python
# app/github/client.py —— 建 Issue 与附件转存（含重试与退避）
import base64, time, logging, httpx

log = logging.getLogger("gh")

class GitHubClient:
    def __init__(self, token: str, base: str = "https://api.github.com"):
        self.h = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        self.base = base

    def _request(self, method: str, url: str, **kw) -> httpx.Response:
        for attempt in range(4):
            r = httpx.request(method, url, headers=self.h, timeout=20, **kw)
            if r.status_code < 400:
                return r
            if r.status_code in (403, 429) or r.status_code >= 500:
                wait = int(r.headers.get("Retry-After", 2 ** attempt))
                log.warning("github %s -> retry in %ss", r.status_code, wait)
                time.sleep(min(wait, 60))
                continue
            r.raise_for_status()
        raise RuntimeError(f"github request failed: {method} {url}")

    def create_issue(self, repo: str, title: str, body: str,
                     labels: list[str], assignee: str | None = None) -> dict:
        payload = {"title": title, "body": body, "labels": labels}
        if assignee:
            payload["assignees"] = [assignee]
        r = self._request("POST", f"{self.base}/repos/{repo}/issues", json=payload)
        return r.json()

    def upload_asset(self, repo: str, path: str, data: bytes,
                     branch: str, message: str) -> str:
        """把图片提交到 assets 仓库/分支，返回可引用的下载链接。"""
        r = self._request("PUT", f"{self.base}/repos/{repo}/contents/{path}", json={
            "message": message,
            "content": base64.b64encode(data).decode(),
            "branch": branch,
        })
        return r.json()["content"]["download_url"]
```

```python
# app/pipeline.py —— 主流程
async def handle_update(update: dict, deps) -> None:
    msg = update.get("message") or update.get("edited_message")
    if not msg:
        return
    s, store, tg, gh = deps.settings, deps.store, deps.tg, deps.gh

    if store.seen_update(update["update_id"]):                  # FR-13
        return
    if msg["chat"]["id"] not in s.tg_allowed_chat_ids:          # FR-16
        log.info("chat not allowed: %s", msg["chat"]["id"])
        return
    if store.has_issue(msg["chat"]["id"], msg["message_id"]):   # FR-12
        return
    if not is_triggered(msg, s):                                # FR-2
        return
    if not deps.limiter.allow(msg["from"]["id"]):               # FR-17
        await tg.reply(msg, "请求过于频繁，请稍后再试。")
        return

    fb = extract(msg, update["update_id"], s.tg_trigger_commands)
    if s.redact_enable:
        fb.text = redact(fb.text)                               # FR-19

    images = []
    for m in fb.media[:4]:                                      # 单条最多 4 张
        try:
            data = await tg.download(m["file_id"])              # <=20MB
            url = gh.upload_asset(s.asset_repo, asset_path(m, fb), data,
                                  s.asset_branch, f"tg2issues: {fb.message_id}")
            images.append(url)
        except Exception as e:
            log.warning("asset upload failed: %s", e)           # 失败降级

    title = build_title(fb.text)
    body = build_body(fb, images, s.anonymize_sender)
    labels = s.gh_default_labels + pick_labels(fb.text, s.allowed_labels)

    if s.dry_run:
        log.info("DRY_RUN would create issue: %s | labels=%s", title, labels)
        await tg.reply(msg, f"[DRY_RUN] 将创建 Issue：{title}")
        return

    issue = gh.create_issue(s.gh_repo, title, body, labels, s.gh_default_assignee)
    store.save_issue(msg["chat"]["id"], msg["message_id"], s.gh_repo,
                     issue["number"], issue["html_url"], fb.sender_id)   # FR-15
    await tg.reply(msg, f"已创建 Issue #{issue['number']}：{issue['html_url']}")  # FR-11
```

```python
# app/security.py —— 脱敏与限流
import re, time

PATTERNS = [
    re.compile(r"gh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"github_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"sk-[A-Za-z0-9]{20,}"),
    re.compile(r"(?i)(token|password|secret)\s*[:=]\s*\S{8,}"),
]

def redact(text: str) -> str:
    for p in PATTERNS:
        text = p.sub("[REDACTED]", text)
    return text

class RateLimiter:                      # 滑动窗口 + 日限额
    def __init__(self, per_min: int, per_day: int):
        self.per_min, self.per_day, self.buf = per_min, per_day, {}

    def allow(self, user_id: int) -> bool:
        now = time.time()
        hits = [t for t in self.buf.get(user_id, []) if now - t < 86400]
        if len([t for t in hits if now - t < 60]) >= self.per_min or len(hits) >= self.per_day:
            self.buf[user_id] = hits
            return False
        hits.append(now)
        self.buf[user_id] = hits
        return True

def verify_tg_secret(header_value: str, expected: str) -> bool:
    import hmac
    return bool(expected) and hmac.compare_digest(header_value or "", expected)

def verify_gh_signature(payload: bytes, header_value: str, secret: str) -> bool:
    import hashlib, hmac
    mac = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={mac}", header_value or "")
```

```python
# app/main.py —— webhook 入口（FastAPI）：先 200 再异步处理
from fastapi import FastAPI, Request, Header, HTTPException, BackgroundTasks

app = FastAPI()

@app.post("/tg/{secret}")
async def tg_webhook(secret: str, req: Request, bg: BackgroundTasks,
                     x_telegram_bot_api_secret_token: str = Header(default="")):
    if not (verify_tg_secret(secret, settings.tg_webhook_secret)
            and verify_tg_secret(x_telegram_bot_api_secret_token,
                                 settings.tg_webhook_secret)):
        raise HTTPException(403)
    update = await req.json()
    bg.add_task(handle_update, update, deps)     # 立刻返回，避免 TG 重试
    return {"ok": True}

@app.post("/github/webhook")
async def gh_webhook(req: Request, bg: BackgroundTasks,
                     x_hub_signature_256: str = Header(default="")):
    raw = await req.body()
    if not verify_gh_signature(raw, x_hub_signature_256, settings.gh_webhook_secret):
        raise HTTPException(403)
    bg.add_task(handle_github_event, await req.json(), deps)   # M4
    return {"ok": True}

@app.get("/healthz")
async def healthz():
    return {"ok": True, **deps.store.stats()}
```

### 8.4 上线自检清单
1. `getMe` 成功；`GH_TOKEN` 调 `GET /repos/{owner}/{repo}` 返回 200。
2. PAT 权限勾选：**Issues: Read and write** + **Contents: Read and write**（转存图片必需）。
3. 先以 `DRY_RUN=true` 跑通全流程，再切生产。
4. Webhook 模式：`setWebhook(url=..., secret_token=..., allowed_updates=["message","edited_message"])`。
5. 用一个测试消息验证：Issue 出现、回执到达、重复投递不重复建。

---

## 9. 里程碑与工作量

| 阶段 | 内容 | 预估 |
| --- | --- | --- |
| M0 骨架 | 项目结构、配置、日志、TG/GitHub 连通自检、DRY_RUN | 0.5 天 |
| M1 MVP | 文本反馈 → Issue：触发判定、白名单、幂等、限流、回执、SQLite | 1 天 |
| M2 附件 | 图片下载 + 转存（Contents API）+ 正文引用 + 失败降级 | 0.5 天 |
| M3 部署 | Dockerfile/compose 或 systemd/Windows 服务、/healthz、告警、README | 0.5 天 |
| M4 双向 | Issue 评论/关闭 → TG 通知（GitHub Webhook + HMAC 校验） | 1 天 |
| M5 扩展 | 管理命令、多仓库路由、AI 摘要/自动打标、相似 Issue 提示 | 2 天+ |

---

## 10. 验收标准（DoD）

1. 白名单群发 `/issue 结账页报错` + 截图 → **≤15 秒**内目标仓库出现 Issue：标题为正文首行、正文含图片与来源链接、带 `from-telegram` 标签。
2. 同一条消息人为投递 10 次（模拟 Webhook 重试）→ 只产生 **1 个** Issue。
3. 非白名单用户/群、非触发消息 → 不建 Issue，且有可读日志。
4. 超过 `RATE_PER_MIN` → Bot 回复限流提示，不建 Issue。
5. 正文含 `ghp_xxxx` → Issue 中显示 `[REDACTED]`。
6. 进程重启后重投同一条消息 → 不重复建 Issue；`/healthz` 返回 200。
7. 模拟 Token 失效 → 重试 3 次后进死信并告警管理员，服务不崩溃。
8. `DRY_RUN=true` 时无任何写操作。

---

## 11. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| GitHub 无官方 Issue 附件上传 API | 图片必须转存 | Contents API 提交到 assets 分支/仓库（4.4 方案 A），失败降级 |
| Bot 下载文件 20MB 上限 | 大附件失败 | 提示用户；或自建 Local Bot API Server |
| 反馈被公开发布 | 隐私/合规 | 群内告知 + 可选匿名化 + 可选「私聊确认后发布」 |
| Token 过期/泄漏 | 服务中断或被滥用 | GitHub App 迁移、启动自检、密钥轮换、日志脱敏 |
| Webhook 伪造/重放 | 垃圾 Issue | secret_token 校验 + update_id 幂等 + 白名单 |
| 刷屏灌水 | 仓库被垃圾 Issue 淹没 | 限流 + 命令触发 + 可选人工 /confirm 确认 |
| GitHub 二级限流 | 偶发失败 | 指数退避 + 遵循 Retry-After + 队列串行化 |
| SQLite 单点 | 状态丢失导致重复 Issue | 定期备份 + 正文隐藏标记兜底对账 |

---

## 12. 待确认决策（需拍板）

1. **技术栈**：Python（推荐，本机已装 3.13）还是 Node / grammY？
2. **运行形态**：本机 Windows 长期跑（polling）/ 云服务器 Docker（webhook）/ Cloudflare Workers？
3. **触发方式**：命令 `/issue`（推荐）/ 指定 Topic / 白名单群全量消息？
4. **双向同步**：本轮是否要做 Issue 评论回流 TG（M4）？
5. **目标仓库**：单仓库，还是「多群 → 多仓库」路由？
6. **隐私**：是否匿名化发送者 / 发帖前二次确认？

---

## 13. 已确认的落地决策（v0.2，实现已按此完成）

| 决策点 | 结论 | 对方案的影响 |
| --- | --- | --- |
| 技术栈 | **Node 24 + TypeScript + Hono + grammY** | 用 grammY 的 `Api` 调 Telegram；路由用 Hono（Workers 原生友好） |
| 运行形态 | **Cloudflare Workers + Webhook** | 无服务器、免费额度；必须有公网 HTTPS；用 `waitUntil` 实现「先 200 再处理」（FR-21） |
| 状态存储 | **Cloudflare D1（SQLite）** | 替代原方案的 better-sqlite3（Workers 无 Node 原生模块）；表结构见 `6 |
| 触发方式 | **指定 Forum Topic 内全部消息** | 必须关闭 BotFather 隐私模式；白名单为 `TG_ALLOWED_CHAT_IDS` + `TG_TOPIC_IDS`（留空 = 拒绝全部） |
| 首版范围 | **文本 + 图片 + Issue→TG 双向同步** | 图片走「转存 + 引用链接」；双向同步用 GitHub Webhook + HMAC 验签 + delivery 去重 |

### 13.1 已实现清单（代码位置）

| 需求 | 实现 |
| --- | --- |
| FR-1/2/3 触发与接入 | `src/telegram/extract.ts`（topic/command/all、命令剥离、被回复消息合并）、`src/index.ts` 路由 |
| FR-5..FR-11 提取与渲染 | `src/github/render.ts`（标题/正文/标签/来源链接）、`src/pipeline.ts` |
| FR-12/13/14/15 幂等 | `src/store.ts` 的 `processed_updates` 与 `issue_map` 主键抢占，正文隐藏标记 `<!-- tg2issues: ... -->` |
| FR-16/17/18/19/20 安全 | `src/security.ts` + `src/index.ts`（定长比较、HMAC 验签、限流、脱敏、匿名化） |
| FR-21/22/23 可靠性 | `schedule()` + `waitUntil`、死信表 + 管理员告警、`/healthz` `/stats` `/admin/selfcheck` |
| FR-6 附件 | `src/github/assets.ts` + `src/telegram/api.ts`（下载 ≤ `ASSET_MAX_BYTES`，Contents API 转存） |
| FR-25 反向同步 | `src/github/webhook.ts`（Issue 评论/关闭/重开 → 原话题）+ `gh_deliveries` 去重 |

### 13.2 仍在后续版本

- 消息编辑同步更新 Issue 正文（当前被幂等表挡住，只处理首次）
- `/close #123` 等管理命令、多仓库路由、AI 摘要与自动打标
- 大文件（>20MB）需自建 Local Bot API Server

### 13.3 与本文档的差异说明

1. 文档 `4.1 里的 better-sqlite3 由 **D1** 替代（Workers 运行时不支持 Node 原生模块）。
2. 文档 `4.5 的「本机 Windows 长期跑」未采纳，改为 Workers 部署；本地仍可用 `wrangler dev` + 隧道工具做联调。
3. 部署、Telegram/GitHub 侧配置步骤见 `README.md`。

---

## 15. Telegram 指令设计（v0.3 已实现）

### 15.1 路由位置
指令在**主流程的最前面**处理（去重 → 白名单之后、触发判定之前），保证：
1. 去重与限流对指令同样生效，不会因为命令绕过防护；
2. 查询型指令不会创建 Issue，也不会占用 `issue_map` 的抢占位；
3. 提交型指令 `/issue` 之后的正文继续走同一套提取 / 脱敏 / 渲染 / 建 Issue 逻辑，没有第二套实现。

```
message → seenUpdate 去重 → 会话白名单
        ├─ 查询指令（/help /issues /stats /status /link）→ 直接回复，结束
        ├─ 提交指令（/issue /bug /suggest）→ 绕过 topic 判定 → 主干道
        └─ 普通消息 → 按 TG_TRIGGER_MODE 判定 → 主干道
```

### 15.2 回复格式
- 统一使用 Telegram HTML parse_mode，标题用 `<b>`、命令与参数用 `<code>`、链接用 `<a href>`；
- 所有用户可控内容（反馈标题、错误信息）都过 `escapeHtml()`，杜绝标签注入；
- 回复挂在原消息上（`reply_parameters`），话题内保持在同一 `message_thread_id`，不会刷屏到其它话题。

### 15.3 与控制台的关系
控制台「运行状态」页内置指令速查表；`/issues` 与「反馈记录」页读的是同一张 `issue_map` 表（含 `title` 列，由 `0002_issue_title.sql` 迁移新增）。

---

## 14. 控制台面板设计（v0.2 已实现）

### 14.1 形态
- 单文件静态页面 `src/dashboard.html`，由 Worker 在 `GET /` 直接返回，Wrangler 以 Text 模块打包，**无前端构建链**。
- 页面只负责渲染与交互；数据全部来自 `/api/*`，令牌存在浏览器 localStorage，不写进 URL（避免进日志与 Referer）。

### 14.2 五个区域
| 区域 | 数据来源 | 主要动作 |
| --- | --- | --- |
| 指标卡 | `/api/overview` | 可选 15 秒轮询 |
| 反馈记录 | `/api/issues`（status / q / limit / offset） | 状态筛选、关键字搜索、分页、跳转 Issue |
| 死信队列 | `/api/dead-letters` | 查看 payload、重试、删除 |
| 运行状态 | `/api/overview?live=1`、`/api/selfcheck` | 设置 / 删除 Webhook、发测试反馈 |
| 配置体检 | `/api/overview`（problems + config） | 展示 fail-closed 提醒与生效配置 |

### 14.3 安全与取舍
- 页面公开、数据接口鉴权：即使域名泄露也拿不到任何反馈内容。
- `/api/overview` 默认**不**调用 Telegram/GitHub 外部接口，只有 `?live=1` 或点「运行自检」时才探测，避免面板轮询放大外部调用。
- 死信重试同步执行并把结果回传（`{ status, title, issueUrl }`），便于面板直接反馈；Webhook 主链路仍保持「先 200 再后台处理」。
- 已知取舍：单令牌、无多用户与审计日志；需要分权时前置 Cloudflare Access。
