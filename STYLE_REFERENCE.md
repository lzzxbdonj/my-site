# STYLE_REFERENCE：参考 1999-1.4(new).pptx 的视觉语言（与诚实说明）

本文件记录本项目从 `C:\Users\Administrator\Downloads\1999-1.4(new).pptx` 提取到的设计证据、实际借鉴了什么、以及明确**没有**借鉴/复制什么。

## 诚实说明：我们是怎么"看"这份参考的

- 我们**没有渲染或观看幻灯片的视觉画面**。没有导出图片、没有截图、没有播放动画。
- 我们做的是**OOXML 结构与属性层面的读取**：解压 PPTX 包，读取 `ppt/theme/theme1.xml`、`ppt/presentation.xml` 与全部 `ppt/slides/slide*.xml`，统计主题色、字体名与显式颜色出现频率。
- 原始提取结果保存在 [`docs/style-evidence.json`](docs/style-evidence.json)，可用 `pwsh -File tools/inspect-pptx.ps1` 复现（只读，不修改参考文件）。
- 因此本文件里所有关于"版式"的描述都来自**属性与结构**（尺寸、颜色、字体、文本量），而不是来自对画面的主观印象。

## 提取到的证据（来自 docs/style-evidence.json）

| 项目 | 数值 |
| --- | --- |
| 画布 | 12192000 × 6858000 EMU（16:9） |
| 幻灯片数 | 53 |
| 版式数（slideLayouts） | 47 |
| 媒体条目 | 185 个，合计约 0.22 GB（这是文件体积的主要来源） |
| slide XML 总量 | 约 7.0 MB |
| 全部幻灯片文本字符数 | 8223（平均每页约 155 字 → 这是**以视觉为主、文本为辅**的演示文稿） |

**主题色（theme1.xml 的 clrScheme）**

| 槽位 | 颜色 |
| --- | --- |
| dk1 | `#5EABA9`（青绿） |
| lt1 | `#FFFFFF` |
| dk2 | `#50696D`（灰绿） |
| lt2 / accent1 | `#D1CCB5`（米灰） |
| accent2 | `#F2EFE6`（米色纸面） |
| accent3 | `#50696D` |
| accent4 | `#5EABA9` |
| accent5 | `#374F57`（深灰绿） |
| accent6 | `#2B2A2F`（近黑墨色） |

**幻灯片中显式使用最多的颜色（按出现次数）**

`#E9E4D5`(216) · `#D1CCB5`(130) · `#A29F7E`(96) · `#FFFFFF`(67) · `#828DAA`(48) · `#EDECE3`(38) · `#BAA780`(37) · `#F6F0EB`(37) · `#787B6A`(35) · `#ABA98D`(33) · `#37969B`(32) · `#6C6038`(32)

**字体（按出现次数，含主题占位符）**

`Cambria Math`(251) · 主题东亚字体(109) · 主题拉丁字体(85) · **华文中宋**(72) · `Arial`(56) · `Calibri Light`(54) · **方正小标宋简体**(24) · `Book Antiqua`(23) · `Times New Roman`(16) · `Baskerville Old Face`(10) · `Wingdings`(8)

由这些属性可以推断（结构层面的推断，而非视觉判断）：大量数学字体与几何字体使用、中文衬线标题字体、低饱和米色/灰绿/黄铜配色、极低的文本密度。

## 实际借鉴了什么（视觉语法）

1. **米色纸面基色**：`--bg: #F2EFE6`（accent2）、`--bg-soft: #F6F0EB`、`--bg-sunk: #E9E4D5`（出现最多的显式色）。
2. **高对比深墨正文**：`--ink: #2B2A2F`（accent6）、`--ink-soft: #374F57`（accent5）、`--ink-muted: #787B6A`。
3. **线色与分隔**：`--line: #D1CCB5`（accent1）、`--line-strong: #A29F7E`。
4. **点缀色**：青绿 `--indigo: #37969B`（幻灯片高频青绿）、黄铜 `--amber: #BAA780`、灰绿 `--teal: #50696D`（dk2）。
5. **中文衬线标题栈**：`"华文中宋", "方正小标宋简体", "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "SimSun", Georgia, "Times New Roman", serif`；
   **不打包任何字体文件**，全部依赖系统已安装字体并按顺序回退。正文仍使用无衬线栈以保证屏幕可读性（不把正文做成小字装饰）。
6. **章节感与微标签**：课件页有 `CHAPTER · 章节 / CONCEPT · 概念 / EXAMPLE · 示例 / SUMMARY · 小结` 这类英文微标签（大写 + 字距），以及 `03 / 08` 形式的页码（folio）。
7. **纸张与细线母题**：背景使用极淡的 CSS 平行细纹（`repeating-linear-gradient`，不引入任何图片），卡片与分隔使用 1px 线色，装饰保持克制。

## 派生色（不是从参考文件直接取到的值）

参考文件的调色板缺少若干语义色与浅底色，这些由我们从上述色相**派生**并保持同族低饱和，已在 CSS 中注释标明：

- `--indigo-soft: #E1EBE8`、`--indigo-ink: #2C6F73`、`--teal-soft: #E4E9E8`、`--amber-soft: #EFE7D6`
- 语义色：`--ok: #3F7A63` / `--ok-soft: #E2EDE6`、`--warn: #8A6A2F` / `--warn-soft: #F0E7D3`、`--bad: #8F4A45` / `--bad-soft: #F2E2DF`

## 明确没有借鉴 / 没有复制的内容

- **没有角色立绘、游戏标识、Logo、音乐、动画或任何媒体文件**：参考包的 185 个媒体条目一个都没有进入本项目，`StudyMate-Web/` 内不含任何来自该 PPTX 的二进制资源。
- **没有复制幻灯片文字**：PPTX 全部约 8223 字的文本没有被引用或改写进课程内容；本项目课程与课件文字均为原创（或由用户自己配置的 AI 生成）。
- **没有打包任何字体**：项目不附带 `华文中宋`、`方正小标宋简体` 等商用字体文件。
- **没有改动参考文件**：`1999-1.4(new).pptx` 全程只读。

## 这一风格如何落进网站（可验证）

- 全局设计令牌与纸面质感：`src/styles/app.css` 顶部 `:root` 与 `body`。
- 课件模式视图：`src/ui/views/slides.js`（16:9 舞台、页码、微标签、键盘翻页、索引、打印按钮）。
- 课件内容生成器：`src/core/slides.js`（把课时内容映射成 章节 / 学习目标 / 概念 / 术语 / 示例 / 练习 / 实验 / 影像档案 / 小结 / 测验 页，内置页数上限）。
- 打印/PDF：`app.css` 的 `@media print` 段落，每页独占一张纸；移动端在 `max-width: 900px` 下自动切换为纵向阅读。
- 示例原始课件（本项目原创内容）：`#/slides/linear-algebra/la-vectors`；AI 生成课程走同一模板（`deck.source === 'ai'`）。
