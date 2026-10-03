# Scope provenance：被标记的两个工作区外文件

本文件按 Lead 要求编写，用于让「工作区范围内的外部变化」可被审阅。
它只陈述**我自己的工具调用历史**；不推断任何我无法观察到的进程或人的行为。
写入本文件时没有触碰、也没有重新运行任何测试；两个工作区外文件保持原样。

## 一句话结论

- `C:\Users\Administrator\Downloads\wps_wid.cid-2006217073.1791008978.exe`：**不是**我的任何工具调用下载、创建、运行或修改的。
- `C:\Users\Administrator\Downloads\1999-1.4(new).pptx`：**不是**我的任何工具调用创建或修改的；我只在它出现之后**读取**过它（只读解压检查），没有写、没有删、没有改。

## 1) 本次任务中我实际执行过的命令类别（完整类别，无遗漏）

| 类别 | 具体形式 | 是否会创建/下载 `.exe` |
| --- | --- | --- |
| 文本/文件写入（仅项目内路径） | `Set-Content -Path C:\Users\Administrator\Downloads\StudyMate-Web\... -Encoding utf8NoBOM`、`Add-Content`（同上路径）、`New-Item -ItemType Directory -Force -Path StudyMate-Web\...` | 不会：只写文本文件，且路径全部以 `StudyMate-Web\` 开头 |
| 读取与检索 | `Get-Content`、`Get-ChildItem`、`Select-String`、`Test-Path`、`Select-Object`、`Measure-Object`、`Get-CimInstance`（只读查询浏览器进程） | 不会 |
| 删除（仅我自己的一次性补丁脚本） | `Remove-Item tools\patch-*.mjs`、`Remove-Item tools\debug-autoload.mjs`、`Remove-Item tools\probe-test.txt`（均在项目内） | 不会 |
| Node 脚本 | `node tools\probe*.mjs`、`node tools\verify-videos.mjs`、`node scripts/build.mjs`、`node tools\inspect-pptx.ps1`（经 `pwsh -File`）、`node --test ...`、`node -e "..."` | 不会：输出为项目内的 `.json` / `dist/**` |
| 包管理与验收命令 | `npm.cmd --prefix C:\Users\Administrator\Downloads\StudyMate-Web test`、`npm.cmd ... run build`、`npm.cmd ... run test:browser` | 不会：本项目零依赖，**从未执行 `npm install`**；这些命令只跑测试与复制构建产物 |
| 浏览器（测试用） | 通过我编写的 CDP 帮助模块启动 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，参数含 `--headless=new`、`--user-data-dir=C:\Users\Administrator\Downloads\StudyMate-Web\.cache\browser-profile-*` | 不会：只启动系统已安装的 Edge，profile 落在项目 `.cache/` 并在测试结束时删除 |

**明确地说：没有任何命令下载、创建、运行或修改 `wps_wid.cid-2006217073.1791008978.exe`；也没有安装 WPS。**
需要时可引用的关键否定事实：我的命令历史中不存在 `curl`、`Invoke-WebRequest`、`Invoke-RestMethod`、`Start-BitsTransfer`、`npm install`、`winget`、`choco`、`Start-Process` 指向 Downloads 下任何 `.exe`，也不存在任何以 `.exe` 结尾的写入路径。

## 2) 我唯一的网络访问（与可执行文件无关）

全部通过 `node --use-system-ca <项目内脚本>` 发起，目标固定为以下 JSON/HTML 接口：

- `https://api.github.com/...`（由 Lead 侧完成的上游文档读取，我在任务早期读过其结论）
- `https://api.bilibili.com/x/web-interface/view?bvid=...`、`.../card?mid=...`、`.../search/all/v2?...`
- `https://ocw.mit.edu/courses/...`（MIT OpenCourseWare 课程页）
- `https://www.youtube.com/oembed?...`（本机不可达，返回 fetch failed，因此未收录任何 YouTube 视频）

这些响应的类型是 JSON/HTML，从来没有产生可执行文件；所有结果都写在
`StudyMate-Web\tools\probe*.out.json` 与 `StudyMate-Web\docs\video-verification.json`。
此外有一次相对路径写入（`tools/probe-videos.out.json`）因为工作目录不在项目内而 **ENOENT 失败**，没有在工作区根目录创建任何东西。

## 3) 参考 PPTX：我只读，不写

- 我读它的方式：`pwsh -NoProfile -File tools\inspect-pptx.ps1`（脚本在项目内）。该脚本用
  `[System.IO.Compression.ZipFile]::OpenRead($path)` **以只读方式**打开包，读取
  `ppt/theme/theme1.xml`、`ppt/presentation.xml` 与 `ppt/slides/slide*.xml`，随后 `Dispose()`；
  不调用任何写方法，也不做解压落地（工作区内没有 `.zip`/`.tmp` 残留）。
- 我观察到的该文件元数据（仅记录，不代表我知道是谁或什么创建了它）：
  `1999-1.4(new).pptx`，276,034,338 字节，创建 `2026-10-03 14:25:27`，最后修改 `2026-10-03 14:26:16`。
- **不是**我的任何工具调用创建或修改了这个文件；我在它出现之后才开始读取它。

## 4) WPS 安装包：我只读了元数据

- 我对该文件做过的事情仅限**目录列举**：`Get-ChildItem -LiteralPath C:\Users\Administrator\Downloads -File`（以及按 `*.exe` 过滤）读取 `Name/Length/CreationTime/LastWriteTime`。
  我没有打开其内容、没有计算其哈希、没有运行、没有改名、没有删除、没有移动。
- 我观察到的元数据：`wps_wid.cid-2006217073.1791008978.exe`，5,487,488 字节，创建 `2026-10-03 14:29:48`，最后修改 `2026-10-03 14:29:50`。
- 我观察到的同目录背景（事实列举，不是对任何人的推断）：`Downloads` 下还有多个更早创建的安装包，例如
  `bili_win-install.exe`（创建 2026-10-01 18:09:19）、`douyin-downloader-v8.5.1-...-wid-99FbBc4R64Y.exe`（2026-10-01 18:00:37）、
  `Reverse1999_MuMuInstaller_3.1.4.0_Bluepoch.exe`（2026-06-06 00:47:50）、`OllamaSetup.exe`（2026-09-12 02:41:11）等，创建时间早于本任务开始（本项目最早文件为 2026-10-03 13:48:21）。

## 5) 我无法观察、因此不做归属的部分

- 我无法观察主机上的其他进程、其他用户操作、浏览器下载管理器、系统更新程序或安全软件。
- 因此本文件只给出**可验证的否定结论**（上述命令类别中不存在任何相关操作），并把「谁创建了这个安装包」留给 Lead 依据你自己的证据判断。
- 为进一步减少疑问：本项目源码中检索 `wps` 与 `.exe` **均无匹配**（检索范围：`*.js,*.mjs,*.json,*.md,*.toml,*.yml,*.html,*.css,*.ps1`）。

## 6) 审阅者可自行执行（全部只读，不修改任何文件）

```powershell
# 1) 查看两个工作区外文件的元数据（只读）
Get-Item -LiteralPath 'C:\Users\Administrator\Downloads\wps_wid.cid-2006217073.1791008978.exe' |
  Select-Object Name, Length, CreationTime, LastWriteTime
Get-Item -LiteralPath 'C:\Users\Administrator\Downloads\1999-1.4(new).pptx' |
  Select-Object Name, Length, CreationTime, LastWriteTime

# 2) 列出 Downloads 根目录的全部 exe（只读，仅元数据）
Get-ChildItem -LiteralPath 'C:\Users\Administrator\Downloads' -File -Filter *.exe |
  Select-Object Name, Length, CreationTime | Sort-Object CreationTime

# 3) 项目内是否引用 wps/.exe（只读）
Get-ChildItem -Path 'C:\Users\Administrator\Downloads\StudyMate-Web' -Recurse -File -Include *.js,*.mjs,*.json,*.md |
  Select-String -Pattern 'wps|\.exe' -SimpleMatch
```

## 7) 本文件的性质

- 由 Lead 要求编写，仅包含对既有事实的陈述；**没有**改动项目代码、测试或产物，**没有**重新运行任何验收命令。
- `StudyMate-Web/` 之外的两个文件（WPS 安装包与参考 PPTX）在本轮中保持原样、未被触碰。

## 8) 外部变化登记（按 Lead 要求补记精确路径）

以下两个文件位于本项目目录之外，属于**工作区快照中的并发外部变化**，不是本任务产物；
它们已被加入冻结 allowedPaths 以便快照记账，但**不是**对本 Worker 触碰它们的授权。

| 精确路径 | 大小 | 创建时间 | 最后修改 | 本任务的处置 |
| --- | --- | --- | --- | --- |
| `C:\Users\Administrator\Downloads\wps_wid.cid-2006217073.1791008978.exe` | 5,487,488 字节 | 2026-10-03 14:29:48 | 2026-10-03 14:29:50 | 未下载、未创建、未运行、未修改；仅做只读元数据列举 |
| `C:\Users\Administrator\Downloads\1999-1.4(new).pptx` | 276,034,338 字节 | 2026-10-03 14:25:27 | 2026-10-03 14:26:16 | 未创建、未修改；仅用 `tools\inspect-pptx.ps1` 以只读方式解压检查 OOXML |

声明：本任务编写的所有文件都位于 `C:\Users\Administrator\Downloads\StudyMate-Web\` 之内；
上面两个文件在本轮及后续都不会被运行、删除、移动、改名或写入。
