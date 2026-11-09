# Editable HTML：可编辑的 HTML 产出模式

> **一句话**：风格照旧由设计环节决定，但产出的结构必须换成「人能维护」的范式——
> 设计决策在 tokens、布局在 class、内容在标记里，三者互不污染。

> 规范 v1.0（12 条硬约束不变）；**编辑器实现 v4（2026-10-25）**：
> 拖放内核由 Moveable 换成 `editable.js` 内的原生指针实现，零第三方依赖。
> 变更原因与替代关系见文末「踩坑记录」。

## 为什么需要这个模式

2026-10 诊断：AI 直接产出的 HTML 的问题是**结构范式**问题，不是编辑器问题。

| 症状 | 根因 | 后果 |
|------|------|------|
| 改一个主色要找 20 处 | 色值不归一处 | 改不完、漏改、风格漂移 |
| 挪一个卡片要调 4 个数值 | 绝对定位撑版面 | 压到邻居、反复返工 |
| 读懂整页要读 400 行 CSS | 布局规则与视觉规则混写 | 不敢改 |
| 单页 5–7 MB | base64 字体+图内嵌 | 卡、git 冲突、发给同事是灾难 |

**Editable HTML 模式**不降低视觉上限（照样能做高保真），但强制输出结构可维护。

---

## 三层分离（核心铁律）

| 层 | 载体 | 谁改 | 例子 |
|----|------|------|------|
| **设计决策** | `tokens.css` 的 CSS 变量 | 改主色/字号/密度只动这里 | `--accent: #1f7a3d` |
| **布局实现** | 语义化 class | 挪位置只改 class | `span-4` → `span-6` |
| **内容** | 标记里的文字 | 双击改 | `<h4>视觉驱动型</h4>` |

**任何改动不得跨越层**。改颜色不能去动标记，改位置不能去调像素值。

---

## 文件结构（标准交付形态）

```
项目/
├── assets/
│   ├── tokens.css        ← 设计令牌（唯一色值/字号/间距来源）
│   ├── layout.css        ← 布局与组件规则（不得出现字面色值）
│   └── editable.js       ← 可视化编辑套件（可选，零依赖）
├── slides/
│   ├── 01-xxx.html       ← 每页独立 HTML
│   └── 02-xxx.html
└── index.html            ← 演示外壳（键盘翻页 / 概览 / 编辑模式开关）
```

**禁止**：把 tokens 和 layout 内联进每页 HTML（那等于回到旧范式，改一处要改 N 页）。
**禁止**：base64 内嵌字体与图片（用 `@font-face` + `url()` 相对路径，或本地字体栈）。

---

## 12 条硬约束

### 结构类
1. **内容元素禁止 `position:absolute`**。唯一例外是 `.deco` 装饰层（必须 `pointer-events:none`）。
2. **版式一律 grid/flex**。栅格用 `.grid` + `.span-N` / `.start-N`。
3. **样式只用 class，不用 id**；不写 `!important`；不写深层后代选择器（`>` 与空格后代都不超过 1 层）。
4. **每页骨架固定三行**：`grid-template-rows: auto minmax(0,1fr) auto`（页眉/内容/页脚），内容永远不会压到页脚。

### 样式类
5. **`layout.css` 与页面 HTML 里不得出现字面色值**（`#xxx` / `rgb()`）——色值只许在 `tokens.css`。
6. **字号只许用 `var(--fs-N)`**，不写裸 `px` 字号。
7. **间距只许用 `var(--sp-N)` / `var(--gutter)`**，不写裸 `px` 间距。
8. **`tokens.css` 里不得出现 `!important`，不得出现布局属性**（position/top/left/width/height）。

### 内容类
9. **文字必须包在语义标签里**（`h1`-`h6`/`p`/`li`/`td`/`figcaption`），禁止裸字进 div、禁止 span 承载正文。
10. **每页自带页眉/页脚**，页码由演示外壳统一承载——单页内**不得**再写页码，否则与外壳双页码打架。
11. **交互元件用原生元素**（`button`/`input`/`select`/`a` + `aria-*`），不要用 div 假装按钮。
12. **每个可拖拽块加 `data-drag`**，每个需要被选中的元素由 `editable.js` 自动编号（不要手写 `data-eid`）。

---

## 可视化编辑套件（editable.js）

**拖放内核 = 自带的原生指针实现**（v4，2026-10-25）。早期版本用 [Moveable](https://github.com/daybrush/moveable)（MIT），但在真实浏览器里它的内部手势对象（`targetAbles`/`targetGesto`）建立不起来，`dragStart` 静默失败，最小复现也拖不动。现改为 `assets/editable.js` 内部的 ~300 行原生实现，只依赖 Pointer Events + `getBoundingClientRect`：零第三方依赖、无异步时序坑、行为可预测。拖动 / 八向缩放 / 旋转 / 吸附参考线全部由编辑器自己负责，交付文件不再需要任何 vendor 运行时。

用法：页面 URL 加 `?edit=1`（需通过工作台服务打开才能保存，见下）。

| 能力 | 操作 |
|------|------|
| 选中元素 | 单击 |
| 改文字 | 双击直接编辑，或右侧「文字 → 内容」 |
| 改颜色/字号/粗细/对齐 | 右侧「样式」区 |
| **自由拖动位置** | 直接拖元素（自动脱离栅格，变成自由定位层里的绝对定位元素） |
| **缩放大小** | 拖角/边手柄（8 向） |
| **旋转** | 拖顶部圆点 |
| **吸附参考线** | 自动对齐页边、页面中线、其它块边缘（命中画红色虚线） |
| **层级调整** | 右侧「层级」→ 置顶 / 上移 / 下移 / 置底 |
| 改外观变体 | 右侧「附加 class」→ 如 `accent-blue` |
| 回到栅格 | 右侧「回到栅格」→ 把自由定位元素放回文档流原位 |
| 撤销 / 重做 | `Cmd+Z` / `Cmd+Shift+Z`，或按钮 |
| **保存** | 「保存到原文件」或 `Cmd+S` → **写回原路径**，不产生新文件、不加编号 |

**设计约束（重要）**：编辑器只改 `class` 与 `style` 属性，**从不重写 CSS 文件**。
所以保存后的 HTML 仍然是干净、可手工维护、可 git diff 的源码——不是「编辑器私有格式」。

### 保存必须写回原文件（硬要求）

浏览器在 `file://` 下无法写盘，所以**必须通过本地工作台服务访问**：

```bash
node scripts/editable-server.mjs --root <项目目录> --port 8899
# 或一键启动（跨平台）
node scripts/editable-studio.mjs --root <项目目录> --port 8899   # macOS / Windows / Linux
bash scripts/editable-studio.sh <项目目录> 8899                   # macOS/Linux 包装
scripts\editable-studio.cmd <项目目录> 8899                       # Windows 双击/CMD
```

服务提供：
- `GET /__list` — 文件树（工作台左侧栏用）
- `POST /__save` — 把 DOM 序列化结果写回**原文件**（路径必须在 root 内，防穿越）
- `POST /__revert` — 回退到上一版（内存备份，不落 `.bak` 磁盘文件）
- `GET /__ping` — 健康检查

**工作台地址**：`http://127.0.0.1:8899/studio.html`

> ⚠️ 交付给用户/同事的 HTML **不能**带保存能力（没有服务就写不回去）。
> 交付时用普通浏览器直接打开，编辑功能需自行起服务。


### 编辑模式的画布规则

编辑时画布必须保持 **1920×1080 真实尺寸并等比缩放**（`--ed-scale`），
不能被右侧面板挤压变形——否则表格/图表会被裁切，改的位置在演示时对不上。

---

## 演示外壳（index.html）必备

- 键盘：`←` `→` 翻页，`Esc` 退出概览
- 「进入编辑模式」按钮：给当前页 iframe 加 `?edit=1`
- 概览墙（可选）：网格 + 画廊双模式，直接复用 `assets/deck_index.html`

---

## 与其他模式的关系

| 模式 | 何时用 | 可编辑性 |
|------|--------|---------|
| **Editable HTML** | 用户自己要改、要交互演示、要长期维护 | ★★★★★ |
| 视觉驱动型（默认） | 一次性成片、动画、导出 PPTX/视频优先 | ★★☆☆☆ |
| Path A（PPTX 4 条硬约束） | 明确要可编辑 PPTX | ★★★☆☆（受 PPTX 约束） |

**Editable HTML 与 Path A 兼容**：本规范第 9 条（语义标签）与 Path A 硬约束方向一致，
所以 Editable HTML 写法的 deck 也有较大概率能过 `html2pptx.js`——但仍需实测，不保证。

---

## 检查清单（交付前逐条打勾）

- [ ] `layout.css` / 页面 HTML 里 `grep -E '#[0-9a-f]{3,6}'` 无命中
- [ ] 页面 HTML 里无裸 `px` 字号（`grep -E 'font-size:\s*[0-9]'`）
- [ ] 内容元素无 `position:absolute`（只有 `.deco` 有）
- [ ] 每页有 `.slide-head` / `.slide-body` / `.slide-foot` 三段
- [ ] 页码只在外壳，单页内无页码
- [ ] 字体/图片用相对路径，无 base64 内嵌（`grep -c 'base64'` = 0）
- [ ] 浏览器控制台无 error
- [ ] Playwright 截图：内容不越界、不压页脚
- [ ] `?edit=1` 可打开：选、改字、改色、改栅格、撤销、导出全通
- [ ] 导出文件里 `grep -E 'data-eid|__editable'` 无命中

---

## 工具

- `assets/tokens.css` — 设计令牌（复制即用，按项目改色板）
- `assets/layout.css` — 布局与组件规则（不含字面色值）
- `assets/editable.js` — 可视化编辑套件（含原生拖放内核，零第三方依赖）
- `scripts/editable-server.mjs` — 本地工作台服务（静态服务 + 写回原文件）
- `scripts/editable-studio.mjs` — 一键启动工作台（跨平台，Node 官方实现）
- `scripts/editable-studio.sh` — macOS/Linux 薄包装（转调 .mjs）
- `scripts/editable-studio.cmd` — Windows 包装（转调 .mjs）
- `slides/` + `studio.html` + `index.html` — 完整可运行演示（3 页 + 工作台 + 编辑模式）

## 踩坑记录（durable）

### 为什么放弃 Moveable（v3 → v4，2026-10-25 Windows 实机定位）

v3 用 Moveable 当拖放内核，累计踩了 9 个坑并全部「修好」，但真机上仍然拖不动。实测证据链：

1. `moveable.target` 已切到目标块，控制框（`moveable-control-box`）也正常渲染、位置正确；
2. 但内部 `targetAbles` / `enabledAbles` 始终是空数组，`targetGesto` 从未被创建；
3. 于是 `dragStart(e, e.target)` 直接返回失败，**不抛异常、不打日志**——表现为「拖不动且无从查起」；
4. 用官方最简用法（`new Moveable(document.body, {target: el, draggable: true, resizable: true})` + 真实鼠标拖拽）单独复现，同样不动。

结论：不是封装写法的问题，是这一版内核在手头环境里建立不起手势对象。
继续修 = 逆向 240KB 压缩源码，性价比低于自研。**v4 已改为 `assets/editable.js` 内的原生指针内核。**

### 仍然成立的核心语义

- **坐标必须用缩放比换算**：编辑态画布是 `transform: scale(--ed-scale)`，鼠标位移是屏幕像素，
  逻辑位移 = 屏幕位移 / `k`，其中 `k = slide.getBoundingClientRect().width / slide.offsetWidth`。
  不要让内核「猜」缩放比，v3 的 zoom 参数就是栽在这。
- **拖动起点用「按下的位置」，不是「越过阈值那一刻的位置」**：否则起步几像素被吃掉。
  实测偏差 7%（拖 100 屏幕 px 只走 172.5，应为 187.3）。
- **拖动时不要动宽高**：元素脱离文档流后宽高会按新容器重算，拖一下变成整行宽。
  进入自由层时就锁定 `width/height`。
- **改文字不能写 `el.textContent = x`**：会冲掉子标签结构（改标题把整个块的 `<h4>/<p>` 毁了）。
  用 `setTextPreserving()`：元素自己有直接文本就改自己的，否则取文本最长的叶子元素。
- **自由定位元素统一放进 `.free-layer`**（页面内绝对定位层），坐标相对页面左上角。
  该层标 `data-ed-layer`，**不能**标 `data-eid-ui`（后者序列化时会被删，定位层消失）。
- **撤销 / 回到栅格必须记父节点路径**：转自由定位时记 `data-eid-parent` / `data-eid-next`，
  否则元素拖进 `.free-layer` 后就回不去原栅格位（v3 的「回到栅格」只清 style，元素其实还留在层里）。
- **编辑态画布必须固定真实尺寸 + 等比缩放**（`--ed-scale`），宽高都要参与缩放比计算，
  并垂直居中；否则表格被裁，改的位置在演示时对不上。
- **内嵌时隐藏页面内 HUD**：工作台已经提供了退出/撤销/保存按钮，页面里的 HUD 会盖住画布。
- **序列化必须清干净**：`data-eid*` / `data-sel` / `contenteditable` / 编辑器 UI / 缩放变量，
  否则交付文件暴涨且带一堆内部标记。

### 跨平台（Windows）要点

1. **启动器不能依赖 bash / curl / open**：统一用 Node 官方实现（`editable-studio.mjs`），
   健康检查用内置 `http`/`fetch`，浏览器按平台分 `open` / `cmd /c start` / `xdg-open`。
2. **`.cmd` 里不要写中文**：cmd.exe 默认 OEM 代码页（936）会把 UTF-8 中文渲染成乱码；
   提示语用 ASCII，并在开头 `chcp 65001` 让 Node 的 UTF-8 日志可读。
3. **默认根目录要取「包根」而不是 CWD**：双击 `.cmd` 时 CWD 是 `scripts\`，
   用 `%CD%` 会让工作台只服务 `scripts/`。要用 `%~dp0..`（`.sh` 里同理用 `SCRIPT_DIR/..`）。
4. **字体栈必须补 `"Microsoft YaHei"`**：只写 PingFang / Hiragino 在 Windows 上掉字形。
5. **server 不用改**：已用 `path.sep` 感知 + `relOf()` 正斜杠归一化，
   `safePath()` 对 Windows 盘符（`C:\`）天然生效，中文路径实测正常。

### 验证方法（可复用）

- **Playwright**：真实拖拽 + 逻辑坐标核对，`k = slide.getBoundingClientRect().width / slide.offsetWidth`，
  期望逻辑位移 = 鼠标屏幕位移 / k。
- **零依赖 CDP 方案**（交付包 `_verify/` 里就是这套）：启动系统已装的 Chrome
  `--remote-debugging-port` + Node 内置 `WebSocket` 直连 CDP，
  `Input.dispatchMouseEvent` 发真实鼠标事件，`Runtime.evaluate` 读状态。
  不需要安装 Playwright，也不下载浏览器。
- **本机实测（Windows 11 + Chrome）**：`k = 0.5339`，拖 100 屏幕 px → 逻辑位移 **187.3**、
  拖 60 → **112.4**，与期望逐位一致；吸附后与相邻块边缘差 **0.79px**；
  保存后文件无 `data-eid` / `__editable` / `moveable` 残留，`/__revert` 回退后与原文件逐字节一致。
- **测试文件不要放进项目根**：会被工作台扫进左侧文件栏（`_verify/xxx.html` 会打乱页码），
  放项目外或加 `_` 前缀。
