# ai自学通 AI 代理 Worker（Cloudflare Workers）

> 这是 **ai自学通** 的可选后端。品牌改名只影响用户可见文案：Worker 名（`studymate-ai-proxy`）、Durable Object 迁移名（`RateLimiter`）等部署标识**保持不变**，不需要为了改名重新部署。

前端（GitHub Pages）只负责界面；**供应商密钥只存在于 Cloudflare Worker 的机密中**，浏览器永远不会拿到它。
本目录提供可部署的 Worker：

| 端点 | 作用 |
| --- | --- |
| `GET /api/health` | 返回环境、模型名与额度配置（不含任何密钥），可用于部署自检 |
| `POST /api/course/outline` | 分阶段建课第一步：只返回课程大纲（元信息 + 知识点骨架），不含正文与测验 |
| `POST /api/course/lesson` | 分阶段建课第二步：传入 `outline` 与 `conceptId`，返回该知识点的正文、术语、练习、测验与动手任务 |
| `POST /api/course/generate` | 单次调用生成完整课程（历史路径，仍然保留可用；输出上限不足时容易 `output-truncated`） |
| `POST /api/explain` | 传入知识点标题/摘要，返回一段清理过的讲解文本 |
| `GET /api/auth/login` | 返回 GitHub 授权地址（仅在配置了登录时可用） |
| `GET /api/auth/callback` | GitHub 跳回这里：换取用户身份并签发会话令牌（顶层导航，不校验 Origin，靠签名 state 防 CSRF） |
| `GET /api/auth/me` | 校验 `Authorization: Bearer <token>` 并返回当前用户 |

## GitHub 登录（可选）

**为什么用 GitHub 登录而不是邮箱验证码**：站点没有自有域名时，前端在 `*.github.io`、接口在 `*.workers.dev`，二者跨站；跨站 Cookie 不可靠，所以登录态用 `Authorization: Bearer`。同时，邮箱验证码要发给任意用户，实务上**必须先有可控域名**（在 DNS 配置 SPF/DKIM 证明发信域归属），否则只能发给自己或使用公共邮箱当发件人——后者会大面积进垃圾箱。GitHub 登录零域名、零发信成本，且本项目的受众本来就在 GitHub 上。详见 [`docs/commercialization-plan.md`](../docs/commercialization-plan.md) 第 6.1 节。

启用步骤：

```bash
# 1) 在 GitHub 上创建 OAuth App：Settings → Developer settings → OAuth Apps → New OAuth App
#    Application name：随意（例如 ai自学通）
#    Homepage URL：你的站点地址，例如 https://your-name.github.io/你的仓库名/
#    Authorization callback URL：必须与下面 AUTH_REDIRECT_URI 完全一致
#    https://studymate-ai-proxy.<你的子域>.workers.dev/api/auth/callback

# 2) 非机密变量（wrangler.toml 的 [vars]，或用 wrangler secret 之外的变量方式设置）
#    GITHUB_CLIENT_ID = "Iv1.xxxxxxxx"
#    AUTH_REDIRECT_URI = "https://studymate-ai-proxy.<你的子域>.workers.dev/api/auth/callback"

# 3) 机密（不会写入仓库）
npx wrangler secret put GITHUB_CLIENT_SECRET --config worker/wrangler.toml
npx wrangler secret put AUTH_TOKEN_SECRET --config worker/wrangler.toml   # ≥32 位随机串
npx wrangler deploy --config worker/wrangler.toml
```

设计要点与取舍：

- **会话令牌是无状态签名**（`payload.signature`，HMAC-SHA256）：不需要新增 D1/KV/DO 绑定，部署面最小。代价是**无法在到期前单独吊销某个令牌**；默认有效期 30 天，更换 `AUTH_TOKEN_SECRET` 可让全部旧令牌立即失效。需要「立即下线某个账号」时应改为服务端存储校验。
- **`state` 是服务端签名的短期票据**（10 分钟，含随机数）：防登录 CSRF；回调被篡改或过期一律拒绝，且**不会**向 GitHub 发出任何请求。
- **`returnTo` 只允许白名单内的源**：防止把用户重定向到任意站点（开放重定向）。
- **令牌放在 URL fragment 里回传**：fragment 不发送给服务器、不进入服务端访问日志；前端取到后立刻跳离该地址。前端把令牌存在**独立存储键**（`studymate.auth.v1`）里，因此**备份导出不会包含它**。
- **只申请 `read:user`**：不申请邮箱权限；令牌载荷只含 `sub / login / name`，不含邮箱。
- 任何响应与错误页都**不含** client secret、access token 或签名密钥；回调失败时不会重定向（避免把半成品令牌带出去）。

> 前端不发起任何后台请求：只有在用户点击「用 GitHub 登录 / 检查登录状态」时才会访问这些端点。不登录也能使用全部课程、视频、测验与进度功能。

分阶段建课的实际调用次数是 **1 + N**：1 次大纲 + 每个知识点各 1 次正文；自动测试（`npm test`、`npm run test:browser`）使用本地模拟的供应商响应，不产生真实费用。若你自己有可用的 Worker 与额度，可用 [`tools/_verify-staged.mjs`](../tools/_verify-staged.mjs) 做一次**有界**的真实冒烟（它是可选工具，不在自动验收里，会真实计费）。

## 安全与成本设计

- **密钥只服务端持有**：`PROVIDER_API_KEY` 是 Worker 机密，永不进入响应、日志或前端。缺少任何必需配置时 Worker 直接返回 `503`，不会降级放行。
- **固定供应商端点**：只能调用你在 `PROVIDER_BASE_URL` 中配置的 HTTPS 地址，客户端无法指定目标（避免任意代理/SSRF）。
- **Origin 白名单 ≠ 鉴权**：`ALLOWED_ORIGINS` 只防浏览器跨站调用；真正的用量控制来自下面的配额。私有部署请叠加 Cloudflare Access。
- **原子配额 + 并发控制（Durable Object）**：`RateLimiter` 在 `blockConcurrencyWhile` 内完成「读取 → 判断 → 写入」，先**占用**一次尝试额度再调用模型。KV 计数器是最终一致的，两个并发请求可能同时通过，因此本项目不使用 KV 计数。
  - **尝试额度不可退款**：只要真的发起了供应商请求，这一次就计入硬上限，且**可能产生费用**（无效输出、超时、供应商报错都算调用过）。因此 README 与界面都不承诺「失败不计费」，前端错误文案会明确说明「已计入额度并可能产生费用」。
  - 默认上限：**每位访客每天 60 次**、**全站每天 200 次**（本项目选定的折中默认值，非用户指定），可用 `VISITOR_DAILY_LIMIT` / `SITE_DAILY_LIMIT` 覆盖。计数单位是**模型尝试次数**：分阶段建课下一门课约 1（大纲）+ 知识点个数（正文）次，因此 60 次 ≈ 每天 8-10 门 6-8 知识点的课。
  - **并发上限**：默认同时最多 2 个模型请求（`MAX_CONCURRENT_PROVIDER_REQUESTS`）。每次请求先创建带过期时间（`RESERVATION_TTL_MS`，默认 180 秒）的预占 ID，并在 `finally` 中释放；释放是幂等的，且只作用于自己那一天的计数，跨午夜不会递减第二天的额度。
  - 结果只做记录（成功/失败计数），不退还额度；错误响应里会明确提示「这次尝试已计入每日额度」。
- **访客识别**：只使用 Cloudflare 注入的 `CF-Connecting-IP`（**不使用 `x-real-ip` / `x-forwarded-for` 等客户端可伪造的头**），并用 `IP_SALT` 做 SHA-256 加盐哈希后只保留 16 位十六进制；不存明文 IP。缺少可信头时归入一个共享的受限桶（不会放宽限制）。
- **输入/输出都有上界**：请求体按 **UTF-8 字节**边读边计数（默认 20 KB，超限立即取消读取）、供应商响应体上限（默认 256 KB）、输出 token 上限（默认 8000）、超时（默认 90 秒）、结构化课程的数量与文本长度上界。
- **输出预算与截断**：完整课程（4-12 个知识点，含正文、练习、带解析测验）需要可观输出；默认 `PROVIDER_MAX_OUTPUT_TOKENS=8000`、`PROVIDER_TIMEOUT_MS=90000`。当模型因长度上限被截断（`finish_reason=length`）时，接口返回 `422 output-truncated` 并提示调整预算或缩小主题，而不是返回半截课程。**这些是项目选定的默认值；真实费用取决于你选择的供应商与模型。** 自动化测试不产生任何费用；最近一次有界真实验证跑通了 1 次大纲 + 8 个知识点（9 次调用、约 49 秒、无重试），复现方式见 `tools/verify-staged-live.mjs`（默认只预演，加 `--live` 才会真实调用）。
- **视频目录以服务端为准**：提示词里的视频来自服务端打包的同一份精选目录（`src/catalog.js` ← `src/data/videos.js`）；客户端提交的「视频库」只作提示，伪造条目一律忽略并在 `meta.ignoredClientVideoEntries` 中如实报告，返回的 `videoIds` 只可能是服务端已知 id。
- **模型输出视为不可信**：见 `src/schema.js` —— 禁止 HTML/脚本/链接、要求唯一 id、要求 prerequisites 无环且存在、要求测验答案合法且带解析、要求每课有正文与练习、至少有动手单元；`videoIds` 只能来自**服务端打包的已核实视频目录**（`src/catalog.js` ← `src/data/videos.js`），编造 id 会被拒绝，客户端提交的条目只作提示。
- **不记录密钥**：Worker 不做任何包含密钥的日志输出。
- **课程模板只认白名单**：请求里的 `templateId` 只在服务端与前端共用的目录（`../src/data/course-templates.js`）里查表；未知/伪造 id 一律退化为 `custom`（不插入任何模板段落），客户端文本永远不会进入提示词。返回的 `meta.templateId` / `meta.templateLabel` 只是回显。
- **术语名允许 1 个字**：`keyTerms[].term` 的长度下限是 1（「键」「值」「熵」这类单字术语合法），空串与超长（>40 字）仍然被拒绝；课程数量与输出预算不变（4-12 个知识点，大纲 3000 / 单个知识点 5000 tokens 上限，仍受 `PROVIDER_MAX_OUTPUT_TOKENS` 约束）。

## 部署步骤

```bash
# 1) 安装 Wrangler（在 StudyMate-Web/ 目录内）
npm install -D wrangler

# 2) 登录 Cloudflare 账号
npx wrangler login

# 3) 修改 worker/wrangler.toml
#    - PROVIDER_BASE_URL / PROVIDER_MODEL：你使用的 OpenAI 兼容服务
#    - ALLOWED_ORIGINS：你的站点源，例如 https://your-name.github.io（只写源，不要带路径）

# 4) 设置机密（不会写入仓库）
npx wrangler secret put PROVIDER_API_KEY --config worker/wrangler.toml
npx wrangler secret put IP_SALT --config worker/wrangler.toml      # 至少 16 位随机串

# 5) 部署（会创建 RateLimiter Durable Object 迁移）
npx wrangler deploy --config worker/wrangler.toml

# 6) 自检（workers_dev = true 时 wrangler 会在输出里给出实际地址）
curl -H "Origin: https://your-name.github.io" https://studymate-ai-proxy.<你的子域>.workers.dev/api/health
# 使用自定义域时：把 wrangler.toml 的 workers_dev 设为 false，并配置 routes（示例已写在文件里）
```

部署完成后，在网站「设置 → AI 服务」中填入 Worker 地址（例如 `https://studymate-ai-proxy.xxx.workers.dev`），
前端只会发送学习需求（以及可选的视频库提示，服务端只采信自己的目录），**不会发送任何供应商密钥**。

> 前端侧还有一个「等待上限」：`src/core/ai-client.js` 的 `WORKER_DEADLINES`（**四个端点统一 120 秒**，含 `outline` 与 `lesson`），它必须大于这里的 `PROVIDER_TIMEOUT_MS` 默认值 90 秒。调大 `PROVIDER_TIMEOUT_MS` 时请同步调大前端上限（新超时 + ≥30 秒），否则前端会先放弃一次可能已经计费的调用。

本地开发（可选）：

```bash
npx wrangler dev --config worker/wrangler.toml --local
# 机密可放在 worker/.dev.vars（已在 .gitignore 中）：
# PROVIDER_API_KEY="..."
# IP_SALT="..."
```

## 私有部署与访问控制

- 公开站点上的静态前端**无法隐藏任何共享密钥**：如果不想让陌生人消耗你的额度，请使用 Cloudflare Access（Zero Trust）保护 Worker 域名，只允许你的邮箱/身份访问；或在 `ALLOWED_ORIGINS` 之外，用 Access 的 JWT 校验作为额外门槛。
- 若你更愿意让每位用户自带密钥（BYOK），前端仍保留「直连模式」作为**次级**选项，界面上会明确标注风险：浏览器直连会把密钥暴露给该接口方。

## 额度用尽与错误表现

| 情况 | HTTP | 前端表现 |
| --- | --- | --- |
| 访客尝试额度用尽 | 429 `visitor-quota-exceeded` | 提示「今天的额度已用完，明天重置」 |
| 全站尝试额度用尽 | 429 `site-quota-exceeded` | 提示本站额度已用完 |
| 并发已满 | 429 `concurrency-limit` | 提示稍后重试（未发起新的模型调用） |
| 输出被截断 | 422 `output-truncated` | 提示调整输出预算或缩小主题；该次尝试已计入额度 |
| 模型输出不合法 | 422 `invalid-model-output` | 展示被拒绝的原因（哪一类结构问题）；该次尝试已计入额度 |
| 模型超时 | 504 `provider-timeout` | 提示超时；**该次尝试已计入额度**（已发起调用） |
| 供应商错误 | 502 `provider-error` | 提示服务错误；**该次尝试已计入额度** |
| 配置缺失 | 503 `worker-configuration-error` | 提示需要先完成 Worker 配置 |

> 说明：本仓库不包含任何真实密钥；自动化测试全部使用本地模拟的供应商响应，不产生费用。最近一次有界真实验证（人工触发、可复现）跑通 1 次大纲 + 8 个知识点：9 次调用、约 49 秒、无失败无重试，服务端回报输入 12,392 / 输出 21,939 tokens。该 usage **只来自成功响应**，是真实支出的下界而非账单金额；真实费用请以你自己的供应商账单为准。
