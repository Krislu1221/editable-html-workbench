# macOS 移植验收记录 — editable-html-workbench v5.6 → v5.7-mac

- 日期：2026-11-01 02:00–02:35 CST
- 机器：Mac mini M4 (Mac16,10)，macOS Tahoe 26.5.1，Apple Silicon
- Node：v26.5.0（`/opt/homebrew/bin/node`）
- 浏览器：Google Chrome（`/Applications/Google Chrome.app`）
- 源包：Windows 侧产出的 `editable-html-workbench-v5.6.zip`（Feishu 附件）

## 结论

**可以移植，且已跑通。** 工作台本体（server / launcher / editable.js / studio.html）本来就是 Node + 浏览器实现，
平台相关的只有三处：浏览器可执行路径、系统文件对话框、Windows 写死的绝对路径。全部已修。

六套验收脚本在 macOS 上**全绿**（t11 / t12 / t20 / t21 / t22 / t23），控制台零 error。

## 本机实测数字

| 项 | Windows 侧记录 | macOS 实测 |
|---|---|---|
| 拖动换算 | k=0.5186，屏幕 100×60 → 逻辑 184.6×110.8 | 屏幕 100×60 → 逻辑 **180.0×110.8**（差值 4.6px 在 6px 吸附容差内） |
| 缩放 | 312.5 → 462.4 | 310.0 → 457.7 |
| 旋转 | rotate(92deg) | rotate(91deg) |
| 吸附对齐 | 与邻块边缘差 0.80px | 差 **1.48px** |
| 保存写回 | 3135 → 3205 bytes | 3135 → 3205 bytes，内容干净 |
| `/__revert` | 与原文件逐字节一致 | 一致 |
| 预览自适应 | 1920×1080 → 68% | 68%（画布 1312×738，不压面板） |
| 编辑态缩放 | 左右面板尺寸不变 | 260px / 300px 恒定，仅页面 transform |
| 中文 + 空格路径 | `C:\...\文档\...` 正常 | `~/Downloads/中文 目录 测试/_proj-fake` 正常 |
| 单文档 root | 支持 | 支持（`--root <某个.html>`） |
| 控制台 | 无 error | 无 error |

## 改了什么（6 处，都是平台相关，不动编辑器内核）

| # | 文件 | 改动 | 原因 |
|---|---|---|---|
| 1 | `_verify/cdp.mjs` | 浏览器候选路径补 macOS / Linux（Chrome / Edge / Chromium） | 原本只有 `C:\Program Files\...\chrome.exe`，Mac 上直接 `no chrome/edge found` |
| 2 | `_verify/t22-zoom.mjs`、`t23-preview.mjs` | 截图路径由写死的绝对路径（`C:\Users\<you>\OneDrive\...`）改为 `OUT + "30-zoom.png"` | Mac 上会在 `_verify/` 里生成**名字带反斜杠**的垃圾文件 |
| 3 | `_verify/t20-any-project.mjs`、`t21-open-doc.mjs` | 默认 fixture 路径改为跨平台（`os.tmpdir()`），根目录断言正则改 `[\\/]_proj-fake$` | 原断言写死 Windows 路径，Mac 上必然 FAIL |
| 4 | `scripts/open-project.command` | 支持拖拽路径作为 `$1`（原来无论拖什么都还是弹窗） | README 第 1.2 节承诺了拖拽，但脚本忽略了参数 |
| 5 | `scripts/pick-folder.sh` | 弹窗加 `default location`（从包目录起）、支持传目录/端口跳过弹窗 | 对齐 Windows 的 `-InitialDir`，少点几层目录 |
| 6 | `scripts/editable-studio.mjs` | **端口占用自动顺延** + `/__ping` 校验 `package` 字段 | 见下「踩到的坑」第 3 条 |
| 7 | `scripts/setup-mac.sh` | 自动 `xattr -dr com.apple.quarantine` | 从网上下载的 zip 双击 `.command` 会被 Gatekeeper 拦 |

## 踩到的坑（值得记住）

1. **zip 用反斜杠当路径分隔符**
   Windows 打的包在条目里写 `editable-html-workbench\assets\editable.js`。macOS `unzip` 会警告
   `appears to use backslashes as path separators`，目录仍能建出来，但**任何文件名里带反斜杠的条目会被落成一个字面文件名**。
   所以 Mac 侧重新打包必须用 `zip -r`（正斜杠 + 保留权限位）。

2. **zip 不保留可执行位**
   解压后 `scripts/*.sh`、`*.command` 没有 x 位，双击 `.command` 直接报错。
   这就是 `setup-mac.sh` 存在的原因——Mac 用户第一次必须先跑一次。

3. **端口 8899 上可能坐着「别的东西」**（本机真实情况）
   - `127.0.0.1:8899` = 本机 7 天前留下的**旧版本 v1.1 工作台**
   - `*:8899`（IPv6）= 虾软的 english-reader 服务
   - `127.0.0.1:8900` = 另一个遗留的 editable-server（另一个 deck 项目）

   原启动器的逻辑是「ping 通就当自己已在运行 → 直接开浏览器」。旧版工作台同样会回 200，
   于是**双击 v5.6 反而打开 v1.1 的旧编辑器**——这是最坑的一条，肉眼看着「能用」，其实跑的是老代码。
   修法：`/__ping` 返回的 `package` 字段必须等于本包路径，否则视为「端口被占」，顺延到下一个空闲口。

4. **macOS `/tmp` 是符号链接**（指向 `/private/tmp`）
   测试 fixture 放 `/tmp/...` 时，中转的根目录字符串会与断言里的原始路径不一致；
   用 `os.tmpdir()` 或真实路径比较即可。

## 未在本机自动验证的项（需人肉一次）

- **`/__pick` 系统文件对话框**：macOS 分支走 `osascript -e 'POSIX path of (choose file ...)'`，
  语法已用 `osacompile` 校验通过，但真弹窗无法在无人值守下点。请在工作台里点一次右上角「打开文档…」确认能选中文名文件。
- **双击 `open-project.command`**：需要 Finder 交互（建议右键 → 打开 一次）。
- **`openBrowser`**：darwin 分支就是 `open <url>`，属系统标准行为。

## 使用方式（macOS）

```bash
cd ~/Downloads/editable-html-workbench-v5.6
bash scripts/setup-mac.sh          # 只需第一次
# 之后任选
open scripts/open-project.command  # 或 Finder 双击 / 拖文件夹上去
# 或者直接指定项目
node scripts/editable-studio.mjs --root "/path/to/your/deck-project" --port 8899
```

服务只监听 `127.0.0.1`，不对外暴露。工作台地址永远是 `/__wb/studio.html`（来自包目录，不在你的项目里）。
