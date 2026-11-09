# Editable HTML 工作台

> 指到一个项目的文件夹，就能在浏览器里拖放 / 改字 / 改色 / 调层级，**保存写回原文件**。
> 不产生新文件编号，写完仍是干净、可 git diff 的源码。

- 版本：v5.8（2026-11-01，macOS 移植 + 精确微调 + 保存门控）
- 上一版：v5.6（Windows 侧，画布自适应/独立缩放）
- 平台：**Windows / macOS / Linux 通用**（同一份包，零依赖，只需 Node.js 18+）

| 平台 | 双击入口 | 文件对话框 |
|---|---|---|
| Windows | `scripts\open-project.cmd` | `pick-folder.ps1`（WinForms） |
| macOS | `scripts\open-project.command` | `pick-folder.sh`（osascript） |
| Linux | `bash scripts/editable-studio.sh` | 需装 `zenity` |
- 拖放内核：**自带原生指针实现**（`assets/editable.js` 内部，零第三方依赖）

**v5 的关键变化：项目零侵入。**
工作台自己的界面和编辑器从**包目录**提供（`/__wb/`），所以 `--root` 指向任意项目都能直接用——
不需要往项目里放 `studio.html`、也不需要它引用 `editable.js`。
编辑脚本只在带 `?edit=1` 时通过 HTTP 注入，**不写进文件**；保存时自动剥掉，项目源码保持干净。

**v5.1 新增：在编辑器里「打开文档」。** 点一下按钮就能选任意位置的 `.html`，
工作根自动切到它所在目录，改完写回它本身——不用先把它拷进项目目录。

**v5.8 新增：精确编辑 + 保存门控。**

| 能力 | 用法 |
|---|---|
| 方向键微调 | 选中后 `←↑→↓` 每次 1px，`Shift+方向键` 每次 10px；700ms 内连续按键合成**一个**撤销步 |
| 数值输入 | 右侧「位置与尺寸」四个框 X / Y / 宽 / 高，改完即落位（**页面坐标 px**，与当前缩放无关） |
| 按住空格 | 页面临时回到 1 CSS px : 1 屏幕 px 的**真实比例**，松开恢复 |
| 保存门控 | 内容没真变就**不写盘**（提示「没有实质改动，未写盘」）；写一次后连点保存幂等 |

> 为何要门控：以前无论改没改都把整页重新序列化送回服务端，
> 于是「只放大看看、顺手保存」也会改写文件（3135 → 3101 bytes），连点两次字节继续漂。
> 现在先各自过一遍 DOM 规范化再比，**只比语义不比格式**（`<html><head>` 合并、`hidden` vs `hidden=""`、空行漂移都不算改动）。
> 同时修了一个硬伤：v5.6 把**裸的 `data-drag`** 当垃圾属性删掉，而 README §8 恰恰教作者写裸 `data-drag`——现在完整保留。

---

## 1. 打开一个项目 / 一份文档（四种方式，任选）

> **Windows 用 `.cmd`，macOS 用 `.command`**，命令行的写法两者通用（只把反斜杠换成 `/`）。
> macOS 首次使用看第 1.1 节，30 秒搞定。

### 方式 A：双击选文件夹（推荐，最省事）

**Windows**

```
双击 scripts\open-project.cmd  →  选一个装了 HTML 的文件夹  →  浏览器自动打开工作台
```

**macOS**

```
bash scripts/setup-mac.sh          ← 只需第一次：给脚本加可执行位
双击 scripts/open-project.command  ← 之后每次：弹窗选文件夹
```

### macOS 首次使用（三步）

```bash
# 1) 解压后进入包目录
cd ~/Downloads/editable-html-workbench

# 2) 给脚本加可执行位（zip 从 Windows 打包，不带权限位；只需做一次）
bash scripts/setup-mac.sh

# 3) 双击 scripts/open-project.command，选文件夹 → 浏览器自动打开
```

> 如果 macOS 拦住 `.command`（提示「无法验证开发者」）：
> **右键 → 打开**，或在终端执行 `xattr -dr com.apple.quarantine "<解压后的目录>"`。
>
> 首次双击弹窗可能有 2–4 秒延迟（`osascript` 冷启动），属正常。

### 方式 B：把文件夹或**单个 HTML 文档**拖到启动器上

**Windows**：拖到 `scripts\editable-studio.cmd`
**macOS**：拖到 `scripts\open-project.command`

拖文件时，工作根会自动切到该文件所在目录，并直接选中它。

> v5.7（macOS 移植）起，`.command` 接受拖拽路径作为第 1 个参数；不拖就直接弹「选择文件夹」。

### 端口被占用会自动顺延

默认 8899。若那个端口上跑着别的本地服务（或旧版本工作台），启动器会**自动改用下一个空闲端口**
并在终端打印实际地址；它不会傻乎乎地把浏览器指到一个旧版编辑器上。

### 方式 C：命令行（想固定端口/脚本化时用）

**Windows**

```powershell
node scripts\editable-studio.mjs --root "D:\我的项目" --port 8899
node scripts\editable-studio.mjs --root "D:\某处\report.html" --port 8899
```

**macOS / Linux**

```bash
node scripts/editable-studio.mjs --root "/Users/me/项目" --port 8899
node scripts/editable-studio.mjs --root "/Users/me/某处/report.html" --port 8899
# 也可以走包装脚本（会自动找 homebrew / nvm 里的 node）
bash scripts/editable-studio.sh "/Users/me/项目" 8899
```

### 方式 D：在编辑器里点「打开文档…」

工作台已经开着时，点右上角 **打开文档…** → 弹出系统文件选择框 → 选任意位置的 `.html`。
服务端会把工作根切到该文档所在目录（这样它引用的相对 CSS/JS 仍能加载），并自动选中它。
**原文件会被就地改写**，不会另存副本。

浏览器会打开 <http://127.0.0.1:8899/__wb/studio.html>。
**注意**：工作台地址永远是 `/__wb/studio.html` —— 它是从包目录提供的，不属于你的项目。

> 服务只监听 127.0.0.1，不对外网暴露。换项目（或换文档）都用「打开文档…」，不必重启服务。
> 若用命令行/拖拽换了根目录，先关掉旧的服务窗口（同一端口只能跑一个项目）。

---

## 2. 用起来

1. 左侧栏列出**该项目**里的所有 HTML 页面（`index.html` 排第一）
2. 点右上角 **进入编辑**
3. 在画布上：
   - **拖动** —— 按住元素拖；靠近其它块或页边会自动对齐（红色虚线）
   - **缩放** —— 拖四周 8 个控制点
   - **旋转** —— 拖上方的小圆点
   - **改字** —— 双击直接改
   - **改色 / 字号 / 粗细 / 对齐** —— 右侧属性面板
   - **调层级** —— 面板里的置顶 / 上移 / 下移 / 置底
   - **精确定位** —— 右侧 X / Y / 宽 / 高 直接输数值；或选中后方向键 1px（Shift 10px）
   - **按住空格** —— 临时看 1:1 真实比例，松开恢复当前缩放
   - **回到栅格** —— 把自由定位的元素放回原来那一格
4. 改完点右上角 **保存到原文件**（或 `Ctrl+S`）

**保存 = 写回原文件**，不会生成 `xxx(1).html`。`Ctrl+Z` 撤销，服务端还有 `/__revert` 可整页回退。

### 画布缩放（只缩页面，不缩界面）

右上角一组：`−  100%  +  适应`，也可以 `Ctrl + 滚轮`（或 `Ctrl + =` / `Ctrl + -` / `Ctrl + 0`）。

| 场景 | 行为 |
|---|---|
| **预览态** | 打开页面时自动**等比缩放到可用区域**（定宽 1920×1080 的页面缩到约 68%，完整可见、不被裁）；「适应」= 回到自动适配 |
| **编辑态** | 基础比例是「适应窗口」，`+` / `−` 在它之上再放大缩小；**左侧目录和右侧属性面板尺寸完全不变**，只有页面本身缩放 |
| 放大后 | 页面可正常滚动查看被放大的部分（自动补出滚动空间） |

### 对项目有什么要求？

- **必须**：是 HTML 页面（`.html` / `.htm`）
- **不必须**：不需要引 `editable.js`、不需要 `.slide` 结构、不需要 tokens.css
- **建议**：页面有明确的「画布容器」（`<section class="slide">` 或 body 里第一个主容器）。
  编辑器优先认 `.slide`，没有就自动退到 body 的第一个块级子元素，并在编辑期临时给它加
  `position: relative`（保存时自动撤掉）。

---

## 3. 目录结构

```
editable-html-workbench/
├── studio.html              ← 工作台外壳（/__wb/studio.html）
├── index.html               ← 演示用直接浏览页（也支持进入编辑）
├── slides/                  ← 演示用 3 页幻灯片
├── assets/
│   ├── tokens.css           ← 设计令牌（唯一色值/字号/间距来源）
│   ├── layout.css           ← 布局与组件规则（不含字面色值）
│   └── editable.js          ← 编辑器 + 原生拖放内核（零依赖）
├── scripts/
│   ├── editable-server.mjs  ← 本地服务（静态服务 + /__wb/ + 写回原文件）
│   ├── editable-studio.mjs  ← 跨平台启动器（macOS/Win/Linux）
│   ├── open-project.cmd     ← Windows：弹窗选项目文件夹后启动
│   ├── pick-folder.ps1      ← Windows 那个的文件对话框实现（WinForms）
│   ├── open-project.command ← macOS：双击弹窗选项目文件夹
│   ├── pick-folder.sh       ← macOS 那个的对话框实现（osascript）
│   ├── setup-mac.sh         ← macOS/Linux 首次使用：chmod + 环境检查
│   ├── editable-studio.sh   ← macOS/Linux 包装
│   └── editable-studio.cmd  ← Windows 包装（也支持拖文件夹上来）
├── docs/
│   ├── spec_editable-html_v1.0.md   ← 三层分离规范 12 条硬约束 + 踩坑记录
│   ├── CHANGELOG-v5.8.md            ← 最近一版改了什么
│   └── macOS-port-verification-v5.7.md ← macOS 移植验收记录
├── demo/                    ← 介绍本编辑器的一页落地页
└── _verify/                 ← 验收脚本（零依赖 CDP，用系统已装的 Chrome）
```

---

## 4. 三层分离（项目长得规范时更好维护）

| 层 | 位置 | 规则 |
|---|---|---|
| 设计决策 | `assets/tokens.css` | 所有色值/字号/间距只在这里定义 |
| 布局 | 语义 class（`.grid` / `.span-N`） | 不用绝对定位撑版面 |
| 内容 | HTML 标记 | 文字、图片 |

**编辑器只改 `class` 和 `style` 属性，从不重写 CSS 文件**——所以保存后仍可手工维护、可 git diff。
规范不是硬性前提，但项目照这个写会长久省事，细节见 `docs/spec_editable-html_v1.0.md`。

---

## 5. 服务端接口

| 接口 | 方法 | 作用 |
|---|---|---|
| `/__list` | GET | 项目文件树（左侧栏），同时返回 `root` 与当前 `open` 文档 |
| `/__save` | POST | 序列化结果写回**原文件**（路径必须在当前 root 内，防穿越） |
| `/__revert` | POST | 回退到上一版（内存备份，不落 `.bak`） |
| `/__open` | POST | 切到任意位置的文档/目录（`{path}`）→ 工作根随之切换 |
| `/__pick` | GET | 弹系统「打开文档」对话框，返回用户选中的绝对路径 |
| `/__ping` | GET | 健康检查（返回当前根目录、包目录、当前文档） |
| `/__wb/*` | GET | 工作台自身 UI 与编辑器（**只读**，永远来自包目录） |

> `/__pick` 由服务端进程自己弹对话框（Windows 用 `pick-file.ps1`，macOS 用 `osascript`，
> Linux 用 `zenity`），路径经 **UTF-8 临时文件**回传——绕开 PowerShell 重定向 stdout 的代码页问题，
> 中文/空格路径不会变乱码。

```bash
curl -X POST http://127.0.0.1:8899/__save \
  -H "Content-Type: application/json" \
  -d '{"path":"index.html","content":"<!DOCTYPE html>..."}'
```

---

## 6. 拖放内核（改代码前必读）

v3 曾用 [Moveable](https://github.com/daybrush/moveable)，但在真实浏览器里它的内部手势对象
（`targetAbles`/`targetGesto`）建立不起来，`dragStart` 静默失败，最小复现也拖不动。
v4 起改为 `editable.js` 内的原生指针实现（约 300 行，Pointer Events + `getBoundingClientRect`）。

仍然成立的核心语义：

1. **位移必须按缩放比换算**：逻辑位移 = 屏幕位移 / `k`，
   `k = 画布.getBoundingClientRect().width / 画布.offsetWidth`。
2. **拖动起点取「按下时」的坐标**，不是越过阈值那一刻——否则起步几像素被吃掉（实测差 7%）。
3. **拖动时锁死宽高**：元素脱离文档流后宽高会按新容器重算（拖一下变整行宽）。
4. **改文字只改文本节点**：`el.textContent = x` 会冲掉子标签结构。
5. **自由定位元素统一进 `.free-layer`**，并记 `data-eid-parent` / `data-eid-next`，
   撤销与「回到栅格」都靠它回原位。
6. **序列化要清干净**：`data-eid*` / `data-sel` / `contenteditable` / 编辑器 UI /
   `data-ed-inject` 注入脚本 / 编辑期 `transform: scale()` / 临时 `position: relative`。

完整踩坑记录见 `docs/spec_editable-html_v1.0.md` 文末。

---

## 7. 验证方法

```powershell
# 1) 启动服务（不要加 --no-open 也行）
node scripts\editable-studio.mjs --port 8899 --no-open

# 2) 跑验收（零依赖，用系统已装的 Chrome，不需要 Playwright）
cd _verify
node t11-full.mjs            # 拖动/缩放/旋转/撤销/改字/层级/保存/回退
node t12-extra.mjs           # 封面页/吸附参考线/切页/独立外壳
node t20-any-project.mjs http://127.0.0.1:8911 "D:\某个普通项目"   # 任意项目通用性
node t21-open-doc.mjs http://127.0.0.1:8923 "D:\某处\x.html"       # 打开项目外的文档并写回
```

核心核对公式：`期望逻辑位移 = 鼠标屏幕位移 / k`。

**本机实测（Windows 11 + Chrome）**：`k = 0.5186`，屏幕位移 100×60 → 逻辑 **184.6 × 110.8**，
与期望逐位一致；吸附后与相邻块边缘差 **0.80px**；保存后无编辑器残留，
`/__revert` 回退后与原文件逐字节一致；在无 `.slide`、无 `editable.js` 的普通项目上同样全通；
`POST /__open` 切到项目外的文档后，改动能写回该文件、回退后逐字节还原。

**本机实测（macOS 26.5 / Apple Silicon + Chrome，2026-11-01）**：t11 / t12 / t20 / t21 / t22 / t23 六套全绿，
屏幕 100×60 → 逻辑 **180.0 × 110.8**（期望 184.6 × 110.8，水平差 4.6px 在吸附容差内）；
中文 + 空格路径（`~/Downloads/中文 目录 测试/_proj-fake`）读写正常；`--root` 直接指向单个 `.html` 也可；
一张图都无残留、回退逐字节一致、控制台零 error。
**macOS 移植需改的两处**：`cdp.mjs` 的浏览器路径（已补 mac/Linux）、以及把脚本里写死的 Windows 截图路径改成 `OUT + <名字>`（已改）。

**v5.8 复验（macOS 26.5 / Apple Silicon + Chrome，2026-11-01）**：t11 / t12 / t20 / t21 / t22 / t23 / **t50** 七套全绿。
关键读数：方向键 ×3 → 位移 **3.0px**；Shift+↓ → **10.0px**；面板 X/Y/W/H → 120/180/420/160 精确落位；
按住空格 scale **0.542 → 1.000**，松开回 0.542；没改动点保存 → 文件**逐字节未变**；有改动保存后再点一次 → **完全幂等**；
保存后 `data-drag` 4 处 → 4 处（v5.6 会变 0 处）。

---

## 8. 已知限制

- **行内元素不能当拖动目标**：`blockOf()` 会向上找块级祖先，但若它本身就该是块，请加 `data-drag`。
- **拖动只改位置，不改宽高**；缩放走 8 个控制点。
- **旋转后的缩放按未旋转包围盒计算**，大角度时缩放方向会有偏差（拖动/旋转不受影响）。
- **不支持多人同时编辑**（本地单机服务）。
- **需要本地服务**：`file://` 直接打开无法保存（浏览器安全限制）。
- **一个服务进程只有一个工作根**：「打开文档…」会切换它；想同时开两个项目，就用两个端口
  （`--port 8899` / `--port 8900`）。
- **「打开文档…」依赖系统对话框**：Windows 用 PowerShell 的 `OpenFileDialog`，
  macOS 用 `osascript`，Linux 需要装 `zenity`。

---

## 9. 常见问题

**Q：双击 `.cmd` 闪一下就没了？**
A：Node.js 没装或不在 PATH。先在 PowerShell 跑 `node -v` 确认，或直接
`node scripts\editable-studio.mjs --root "项目路径"` 看报错。

**Q：双击后打开的是演示页，不是我的项目？**
A：用 `open-project.cmd` 选文件夹，或把项目文件夹拖到 `editable-studio.cmd` 上。
不带参数的 `editable-studio.cmd` 只会打开**本包自己的**演示。

**Q：端口被占用？**
A：`editable-studio.cmd "" 8900`，或 `node scripts\editable-studio.mjs --root "..." --port 8900`。

**Q：左侧栏是空的？**
A：所选文件夹里没有 HTML，或者只有 `_` 开头的文件 / `studio.html`。换目录或改文件名。

**Q：改了颜色但看不出？**
A：编辑器写的是元素行内 `style`，优先级高于样式表。若无效，检查是不是被 `!important` 覆盖了。

**Q：保存没反应 / 提示「当前不在编辑模式」？**
A：先点右上角「进入编辑」再改。

---

## 10. 许可

- 本工作台代码：**MIT**，见 [LICENSE](LICENSE)
- 无第三方运行时依赖（v4 起移除 Moveable），无需分发 vendor 许可文件
