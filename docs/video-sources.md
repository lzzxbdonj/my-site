# 视频来源、核实方式与逐条记录

## 核实方式（可复现）

```bash
node --use-system-ca tools/verify-videos.mjs    # 或 npm run verify:videos
```

脚本执行：

1. 对每条哔哩哔哩视频调用 `https://api.bilibili.com/x/web-interface/view?bvid=...`，核对：
   - 视频是否存在（`code === 0`）；
   - **单 P 视频**比对的标题是接口返回的 `data.title`；**多 P 视频**比对的是 `data.pages[n].part`（因为 `data.title` 是合集标题）；
   - UP 主名称与记录的 `creator` 一致；
   - 时长（秒）与记录一致。
2. 对每个账号调用 `https://api.bilibili.com/x/web-interface/card?mid=...`，记录 `official_verify.desc`（是否官方认证）。
3. 对 MIT OpenCourseWare 条目做 HTTP 200 + `<title>` 核对。
4. 结果写入 `docs/video-verification.json`（含每条的 http 状态、实际标题、实际时长、账号认证信息）。

**最近一次结果**：37/37 条一致，0 个问题；3 个账号全部为平台认证账号。

| 账号 | mid | 认证信息 |
| --- | --- | --- |
| 3Blue1Brown | 88461692 | bilibili 知名UP主，3Blue1Brown官方账号 |
| 尚硅谷 | 302417610 | 尚硅谷官方账号 |
| 黑马程序员 | 37974444 | 传智教育旗下官方账号 |

## 刻意不做的声称

- **不声称嵌入播放一定成功**：我们只验证来源页面/元数据可达且一致；播放受地区、登录状态、浏览器策略影响。界面统一标注「播放未验证」，并且任何情况下都保留「打开来源页」链接。
- **不收录无法验证的来源**：本构建环境无法访问 YouTube（`fetch failed`），因此没有收录任何 YouTube 视频，也没有对其可达性做任何陈述；用户若自行添加 YouTube 链接，界面会标注「用户自定义来源 · 未验证」。
- **不下载、不转存**：所有视频都是第三方外链，本站不代理、不缓存视频内容。

## 收录结构

每条视频记录以下字段（`src/data/videos.js`）：

| 字段 | 含义 |
| --- | --- |
| `id` | 站内 id（如 `bili-py-06`）；课程课时通过它引用视频 |
| `bvid` / `page` | 哔哩哔哩 BV 号与分 P（外链与播放器地址都由它生成） |
| `title` | 单 P 视频为视频标题；多 P 视频为该分 P 的标题（已与接口核对） |
| `creator` / `creatorMid` / `creatorProfile` / `creatorVerified` | 作者与账号认证信息 |
| `durationSeconds` | 时长（秒），已核对 |
| `knowledgePoints` | 绑定的知识点 id；「拓展材料」为空数组并带 `enrichment: true` |
| `reason` | 为什么选它（面向知识点的入选理由） |
| `verification` | 核实方式、状态、核实日期、账号是否认证 |
| `playbackVerified` | 恒为 `false`：未做播放验证，避免夸大 |

## 课程与视频的对应

- 每个概念课、实战课与实验室都至少引用 1 条视频；`tests/unit/video.test.mjs` 会断言**双向一致**：
  视频标注的知识点必须存在且该课时确实引用了它，反之课时引用的视频也必须标注了该知识点。
- 三门课程覆盖：线性代数（3Blue1Brown 官方账号 + MIT OCW 18.06）、Python 编程（尚硅谷 / 黑马程序员官方账号 + MIT 6.0001）、机器学习（尚硅谷 / 黑马程序员官方账号 + MIT 6.036）。
- 三条「拓展材料」（`bili-calc-01` 微积分动机、`bili-la-07` 点积与对偶性、`ocw-6001` MIT 6.0001 课程页）不绑定任何知识点，界面显示「拓展材料 · 非必看」，避免把 tangential 内容伪装成配套课程。
- AI 建课时，视频只能从这个已核实库中按 id 匹配；匹配不到就如实留空（界面上显示「无匹配」），**不会生成视频链接**。
