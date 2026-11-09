# v5.10 变更记录 —— PPT 式画布锁定 + 另存副本

- 日期：2026-11-10（北京时间 01:40–02:40）
- 基线：v5.9（版面占位）
- **v5.9 的占位块（`data-ph-for`）已被本版删除**：语义不对（老板原话「占位带来的负面效果是反亲和性」）。v5.9 归档为历史，仅记录“为什么不能靠占位”。
- 验收环境：Mac mini M4 / macOS 26.6.2 / Node 26.5.0 / **WKWebView（原生壳内）**

## 一、语义变更：从「流式 + 占位」到「画布锁定」

老板要求：**像改 PPT 一样改 HTML** —— 元素之间没有反亲和性，可重叠、可覆盖，拖一个不该让别的动，也不该在原地留死区。

旧做法（v5.9）：元素拖走后在原位插隐形占位块钉住版面 → 邻居不动，但**原位置被永久占死**，正是老板说的反亲和性。

新做法（v5.10）：进入编辑时一次性把整页**冻成绝对坐标**——之后没有任何元素参与文档流，谁都不受谁影响。

| # | 改动 | 说明 |
|---|---|---|
| A | `freezeLayout()` 画布锁定 | 递归：对每个块级子元素 `position:absolute; left/top; width/height; margin:0; box-sizing:border-box`，坐标取自冻结前的实测矩形并换算到父容器 padding box；inline 子元素（文字/span）留在父盒文字流里跟着走 |
| B | 冻结顺序（真 bug） | 必须**先读完所有兄弟矩形再下手**。边读边设会把第一个子元素变绝对 → 兄弟立刻上移 → 后读到的坐标全是错的（实测三块全被冻到同一个 top，版面叠成一坨） |
| C | 缩放比（真 bug） | 用 `元素 rect.width / offsetWidth` 实测，**不能**用 `state.scale`：`fitCanvas()` 刚改完 state、浏览器还没重算 transform 时，rect 是未缩放值，冻结宽度会被放大 1/k（实测 1200 → 1840 或 1840 错位） |
| D | 画布宽度不再写死 1920 | 原来编辑期 CSS 写 `body[data-editing] .slide{width:1920px}`，会把任意页面（如 1280 宽的普通页）改形。改为 `width:var(--ed-w,1920px)`，`--ed-w` 在 init 时按页面**自然尺寸**写入 |
| E | 「回到栅格」→「回到原位」 | 语义改为把自由定位元素放回原父容器 + 原坐标（`data-eid-orig` 记录冻结时的 l/t/w/h） |
| F | `restore()` 修旧 bug | 重做（redo）拖动自 v3 起无效：只挂 `data-free` 属性、元素人还在流里。现在真的 `appendChild` 回 `.free-layer` |
| G | **另存副本**（新功能） | 面板/工作台新增「另存副本」：`POST /__saveas` → 弹系统「另存为」对话框（macOS osascript / Windows `pick-save.ps1` / Linux zenity）→ 写到你选的位置；**主文件与「有没有改动」基准都不动**；响应带 `inRoot`，副本在项目内时左侧文件树自动刷新 |

## 二、验收（WKWebView 内真事件，11/11 PASS）

```
preview: a(40,40,1200,62) b(40,126) c(40,212)
frozen : a(40,40,1200,62) b(40,126) c(40,212)     ← 冻结后与冻结前逐位一致
after  : a(40,40) c(40,212) b(160,212)            ← 只动了 b，且 b 与 c 重叠（允许）
PASS  freeze-does-not-move-anything   max |Δ| = 0.000 px over 4 boxes
PASS  freeze-keeps-page-width         40 -> 40（自然宽度 1200 未被改成 1920）
PASS  no-placeholders-after-freeze
PASS  neighbours-unmoved-after-drag   上下邻居逐位相同
PASS  dragged-moved                   40|126 -> 160|212
PASS  still-no-placeholder
PASS  overlap-allowed                 允许覆盖
PASS  undo-restores / redo-keeps-neighbours
PASS  saveas-writes-copy              1314B
PASS  saveas-keeps-original-untouched
```

保存后文件：`position:absolute` 冻结坐标写进文件，**无任何 `data-ph-for` 占位块**（grep 计数 0）。

## 三、另存副本的接口

```bash
# 弹系统对话框（UI 走这条）
curl -X POST http://127.0.0.1:8899/__saveas -H "Content-Type: application/json" \
  -d '{"content":"<!DOCTYPE html>...","from":"index.html"}'

# 直接指定路径（脚本/自动化走这条）
curl -X POST http://127.0.0.1:8899/__saveas -H "Content-Type: application/json" \
  -d '{"content":"<p>x</p>","path":"/tmp/copy.html"}'
```

默认副本名：`<原名>-copy-YYYYMMDD-HHMM.html`（带时间戳，不覆盖上一个副本）。

## 四、留下的坑 / 已知限制

- 画布锁定后元素全部脱离流：**页面的高度由冻结的盒子撑起来**，如果你把最底部的元素拖很靠上，页面底部会留空白（PPT 也是这样）。
- 冻结会写到每个块级元素的行内 `style` 上（`position/left/top/width/height/margin/box-sizing`）→ 保存后的文件比原来“重”，但渲染结果与编辑前一模一样（实测 Δ=0）。
- 已在流外（`position:absolute/fixed`）的元素不重复冻结，只递归处理它们的子级。
- **系统「另存为」对话框本身**没法自动化验收，只验了“显式路径写入”与 UI 走通；对话框三条分支（macOS / Windows / Linux）需要真机各点一次。
- 多页文档（≥2 个 `.slide`）在编辑期会被包进 `#__ed_scope` 一起缩放，冻结坐标以它为画布基准 —— 保存时会拆掉包装层，位置不变。
