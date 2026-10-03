# ai自学通 · 部署与设置清单

> 这份清单是**照做就行**的操作步骤。把 `<用户名>`、`<仓库名>` 替换成你自己的值。
> 顺序不能颠倒：GitHub 登录的回调地址必须和 Worker 地址完全一致，所以**先部署 Worker，再建 OAuth App**。

## 免费绕开 `workers.dev` 封锁：Pages 反向代理

**问题**：`workers.dev` 在部分网络被 DNS 污染 + 连接重置（实测：用户家庭宽带与手机流量均不通）。

**关键事实**：Cloudflare 的**边缘自己**访问 `workers.dev` 是通的；被封的只是「用户 → workers.dev」这段路径。而 `pages.dev` 实测可用。

**做法**：让浏览器只连 `pages.dev`，由 Pages Function（[`functions/api/[[path]].js`](../functions/api/[[path]].js)）在边缘内部转发到现有的 Worker。**上游 Worker 不需要任何改动。**

```
浏览器 ──(pages.dev，可访问)──> Pages Function ──(Cloudflare 内部)──> Workers（原有代码）
                                       └─ 回程把 CORS 改写成真实请求方
```

### ✅ 已完成（实测通过）

- 项目名 `ai-zixuetong`，由 CLI 直接部署（`wrangler pages deploy dist`）
- 站点：**https://ai-zixuetong.pages.dev/** → HTTP 200
- 代理：**https://ai-zixuetong.pages.dev/api/health** → 返回 Worker 的真实响应
  （`{"ok":true,"service":"studymate-ai-proxy","model":"deepseek-chat",...}`）
- 预检：`OPTIONS /api/course/outline` → 204
- **端到端真实建课**：经代理跑通 1 次大纲 + 7 个知识点，8 次调用、47.8 秒、**7/7 全部成功、无重试**，
  拼装与前端二次校验通过（7 套测验、1 个动手单元、匹配 13 条已核实视频）；
  服务端回报用量 输入 10,789 / 输出 16,786 tokens（**成功响应的下界，不是账单金额**）
- 零配置：站点在 `*.pages.dev` 上打开时，前端会**自动**把代理地址设为当前源
  （见 `src/core/ai-client.js` 的 `defaultWorkerUrl`），用户不需要手填任何地址

### 部署时踩到的网络问题与绕法（如实记录）

本机对 `api.cloudflare.com` 的请求被 **HTTP 劫持重定向到 `https://m.baidu.com/`**（302），
导致 `wrangler` 一律 `fetch failed`。**解决方式**：用 IP 直连验证（`104.17.0.1` 返回真实 200 与账号信息），
然后在 hosts 里固定解析：

```
104.17.0.1 api.cloudflare.com
```

> 备选路径：如果你不想改 hosts，也可以完全走网页后台「Connect to Git」，
> 让 Cloudflare 自己从 GitHub 拉取构建——那样连本机网络都不需要。

### 已知限制（如实记录）

- **访客级限额可能退化为共享计数**：经过代理后，Worker 看到的 `CF-Connecting-IP` 是否仍为终端用户 IP 取决于 Cloudflare 行为，本网络下无法实测确认。**全站每日限额（200 次/天）始终有效**。要彻底解决，需要在 Worker 侧加「可信代理签名」校验——那需要重新部署 Worker。
- 这是绕过网络封锁，不是修复网络：`workers.dev` 本身在该地区依旧不可用。

## 实际部署结果（已发生的事实）

| 项目 | 实际值 | 状态 |
| --- | --- | --- |
| GitHub 仓库 | https://github.com/lzzxbdonj/my-site | ✅ 已推送（125 个文件） |
| 静态站点 | **https://lzzxbdonj.github.io/my-site/** | ✅ 已上线，HTTP 200，标题「ai自学通」 |
| Pages 来源 | GitHub Actions（workflow `deploy-pages.yml`） | ✅ 已启用，构建与部署作业成功 |
| Workers 子域 | `lzzxbdonj.workers.dev` | ✅ 已创建 |
| AI Worker | **https://studymate-ai-proxy.lzzxbdonj.workers.dev** | ✅ 已部署（Cloudflare 侧有版本记录） |
| Worker 机密 | `PROVIDER_API_KEY`、`IP_SALT` | ✅ 已上传（未打印内容） |
| 允许来源 | `ALLOWED_ORIGINS = https://lzzxbdonj.github.io` | ✅ 已写入并部署 |
| GitHub 登录 | 需要 OAuth App | ⬜ 未配置 |
| 从本机访问 Worker | — | ❌ **不通**，见下 |

### ⚠️ 当前阻塞：本网络无法访问 `*.workers.dev`

实测结果（这是网络问题，不是部署问题）：

- 用三个公共 DNS 解析 `studymate-ai-proxy.lzzxbdonj.workers.dev`，得到**三个完全不同的地址**（`210.56.51.192` / `103.214.168.106` / `104.244.46.9`），都不是 Cloudflare 的地址 → 链路上存在 **DNS 污染**。
- 强行指定 Cloudflare 真实 IP（`104.16.132.229` / `104.17.0.1`）连接，被 **RST 重置**；`172.67.0.1` 直接超时 → 连接层被**主动阻断**。
- 同一时刻 `https://lzzxbdonj.github.io/my-site/` 返回 **200**，说明前端没问题；本机 TLS 还需要系统证书（早前 npm 也要 `--use-system-ca`），说明链路上还有 TLS 拦截。

**结论**：Worker 已经正确部署，但这个网络到 Cloudflare 边缘的连接被阻断，因此**在本机用不了 AI 功能**。同一网络下的最终用户也会遇到同样问题。

**先做这一步再决定**：用**手机的移动数据（不要连 WiFi）**打开

```
https://studymate-ai-proxy.lzzxbdonj.workers.dev/api/health
```

- 看到 `{"ok":false,"error":"origin-not-allowed"}` → **Worker 是活的**，只是浏览器没带 Origin（这是正常的）；换到网站上用就能工作。说明只是本机 WiFi 被限制。
- 一直转圈/连接被重置 → 该地区整体访问不了 `workers.dev`，需要换后端方案（见文末「如果 workers.dev 在你那里不可用」）。

## 当前进度（本机已经完成的）

- ✅ 本地 git 仓库已初始化：分支 `main`，初始提交 `0299426`，**124 个文件**
- ✅ 已确认**没有把任何密钥提交进仓库**：`worker/.dev.vars`、`node_modules/`、`dist/`、`.cache/`、`**/.wrangler/`、`*.zip` 都在 `.gitignore` 里；对暂存内容做过密钥样式扫描，0 命中
- ✅ 静态站点与 Worker 均可离线验证：单元＋集成测试 170/170、真实浏览器测试 35/35、静态构建通过
- ⬜ 还没做：**配置 remote 并推送**（需要你的 GitHub 凭据）、Cloudflare 部署、OAuth App、站点内填写 Worker 地址

---

## 步骤 0 · 准备推送凭据（只能你做）

机器上没有安装 `gh`，也没有任何已保存的 git 凭据，所以推送必须由你提供一次授权。三种方式任选：

**方式 A（最推荐，令牌不经过对话）**

```powershell
winget install --id GitHub.cli
gh auth login          # 选 GitHub.com → HTTPS → 浏览器授权
```

授权后我可以直接推送，且**看不到也不需要你的令牌**。

**方式 B（你自己推一条命令）**

我先把 remote 配好，你只需要执行：

```bash
git push -u origin main
```

**方式 C（给我一个最小权限令牌）**

在 GitHub → Settings → Developer settings → **Fine-grained tokens** 新建，只勾**这一个仓库**的 `Contents: Read and write`。
⚠️ 令牌会出现在我们的对话记录里，推送完请**立刻吊销**。我不推荐这种方式。

---

## 步骤 1 · 推送到你的仓库

```bash
cd StudyMate-Web
git remote add origin https://github.com/<用户名>/<仓库名>.git
git push -u origin main
```

要点：

- **仓库根目录必须是 `StudyMate-Web` 里的内容**（不是外层 `Downloads`），GitHub Actions 工作流就是按这个前提写的。
- 默认分支用 `main`：工作流只在 push 到 `main` 时触发。

## 步骤 2 · 开启 GitHub Pages

仓库 → **Settings → Pages → Source 选 “GitHub Actions”**。

之后每次 push 到 `main`，工作流会自动跑测试 → 构建 → 发布。站点地址：

```
https://<用户名>.github.io/<仓库名>/
```

> 如果仓库是 **private**，GitHub Pages 需要付费计划；免费账号请用 public 仓库。

## 步骤 3 · 部署 AI Worker（密钥只存在这里）

```bash
cd StudyMate-Web
npm install                                   # 安装 wrangler
npx wrangler login                            # 打开浏览器，授权你的 Cloudflare 账号
```

改 `worker/wrangler.toml` 第 22 行，换成你真实的 Pages 源（**只写源，不带路径**）：

```toml
ALLOWED_ORIGINS = "https://<用户名>.github.io"
```

生成两个随机串（用于 `IP_SALT` 与后面的 `AUTH_TOKEN_SECRET`）：

```powershell
-join ((1..48) | ForEach-Object { '0123456789abcdef'[(Get-Random -Max 16)] })
```

设置机密（在 `StudyMate-Web` 目录执行，按提示粘贴）：

```bash
npx wrangler secret put PROVIDER_API_KEY --config worker/wrangler.toml
npx wrangler secret put IP_SALT --config worker/wrangler.toml
```

部署并**记下打印出来的地址**：

```bash
npx wrangler deploy --config worker/wrangler.toml
# 形如：https://studymate-ai-proxy.<你的子域>.workers.dev
```

自检（返回 `"ok": true` 才算通）：

```bash
curl -H "Origin: https://<用户名>.github.io" https://studymate-ai-proxy.<你的子域>.workers.dev/api/health
```

- 返回 **403** → `ALLOWED_ORIGINS` 和浏览器地址栏的源不一致（注意：只写源，不要带仓库路径）
- 返回 **503** → 机密没设全（`PROVIDER_API_KEY` / `IP_SALT`）

## 步骤 4 · 创建 GitHub OAuth App（登录功能）

GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**：

| 字段 | 填什么 |
| --- | --- |
| Application name | ai自学通（随意） |
| Homepage URL | `https://<用户名>.github.io/<仓库名>/` |
| Authorization callback URL | `https://studymate-ai-proxy.<你的子域>.workers.dev/api/auth/callback` |

在 `worker/wrangler.toml` 的 `[vars]` 里补两行（Client ID 不是机密）：

```toml
GITHUB_CLIENT_ID = "Iv1.xxxxxxxxxxxx"
AUTH_REDIRECT_URI = "https://studymate-ai-proxy.<你的子域>.workers.dev/api/auth/callback"
```

再设两个机密并重新部署：

```bash
npx wrangler secret put GITHUB_CLIENT_SECRET --config worker/wrangler.toml
npx wrangler secret put AUTH_TOKEN_SECRET --config worker/wrangler.toml
npx wrangler deploy --config worker/wrangler.toml
```

> 登录是**可选**的：不配置这三个变量时登录端点返回 503，但 AI 建课等既有能力照常可用。

## 步骤 5 · 在网站上填入 Worker 地址

打开站点 → **设置 → AI 通道** → 粘贴 `https://studymate-ai-proxy.<你的子域>.workers.dev`。
之后 **设置 → 账号** 会出现「用 GitHub 登录」。

## 步骤 6 · 验收清单

- [ ] `https://<用户名>.github.io/<仓库名>/` 打得开，导航与课程库正常
- [ ] `/api/health` 带正确 Origin 返回 `"ok": true`
- [ ] 设置里填入 Worker 地址后显示「✓ 代理模式可用」
- [ ] AI 建课：选一个模板 → 生成 → 看到「第 1 步 大纲 / 第 2 步 知识点 n/N」进度 → 预览 → 保存
- [ ] 设置 → 账号：点「用 GitHub 登录」能完成跳转并显示「已登录：<你的名字>」
- [ ] 刷新页面后仍是已登录；点「退出登录」后回到未登录
- [ ] 导出备份的 JSON 里**没有** `token` 字段（令牌存在独立键里，不进备份）

---

## 安全提醒

1. **轮换 DeepSeek 密钥**：这个密钥在对话里出现过，本地 `worker/.dev.vars` 也有。请到 DeepSeek 后台重新生成一个，只写进 Cloudflare 机密。
2. `worker/.dev.vars` 只用于本地开发，已被 `.gitignore` 排除；**不要**把它提交或复制进仓库。
3. 会话令牌是**无状态签名**的，默认 30 天有效、**无法单独吊销**；在 Cloudflare 更换 `AUTH_TOKEN_SECRET` 可让所有旧令牌立即失效。

## 已知边界（不夸大）

### 如果 `workers.dev` 在你那里不可用

按代价从低到高：

1. **BYO Worker（零成本，本站已支持）**：每个用户把 Worker 部署到**自己的** Cloudflare 账号。你需要把 Worker 地址告知用户，或让他们自己部署。注意：如果他们的网络同样阻断 `workers.dev`，这条也走不通。
2. **自定义域绑定 Worker**：买一个便宜域名，在 Cloudflare 里加 `routes` 指向 Worker（`wrangler.toml` 里已留注释示例）。**只解决「workers.dev 被单独封」的情况**；若整片 Cloudflare 边缘都被阻断，换域也没用。
3. **换后端位置**：把「保管密钥 + 限流 + 调用模型」这件事放到目标用户能稳定访问的地方（例如国内云函数/自建服务）。代价：`worker/src/index.js` 依赖 Durable Object 做原子限流，需要改写；前端只需改「AI 代理 Worker 地址」一项，因为协议就是普通的 HTTPS JSON 接口。
4. **只用不依赖 AI 的功能**：课程库、定制课程、课件模式、视频、测验、进度、备份全部在浏览器本地完成，**不需要任何后端**。

- 真实 GitHub OAuth 往返**尚未执行过**：现有验证使用模拟 GitHub，覆盖了完整前端流程与全部安全分支（state 篡改/过期、令牌伪造/过期、开放重定向、密钥不外泄）。
- 视频「嵌入播放成功」从未验证，界面标注为「播放未验证」，请用「打开来源页」兜底。
- 真实模型调用只做过一次有界验证（1 次大纲 + 8 个知识点，9 次调用、约 49 秒、无重试）；更长的课程与并发未验证。
- 支付与账号计费**尚未实现**；GitHub 登录已就绪，是后续收费的前置条件。
