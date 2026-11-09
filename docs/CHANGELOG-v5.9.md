# v5.9 变更记录 —— 拖动不再挪动邻居（版面占位）

- 日期：2026-11-10（北京时间 01:30–02:20）
- 基线：v5.8（macOS 移植 + 精确微调 + 保存门控）
- 验收环境：Mac mini M4 / macOS 26.6.2 / Node 26.5.0 / **WKWebView（原生壳内）**

## 一、修了什么

| # | 问题 | 根因 | 修法 |
|---|---|---|---|
| A | **拖一个块，其他元素自动往上/往下跳** | `toFreeQuiet()` 把元素 appendChild 进 `.free-layer`（`position:absolute`）→ 元素脱离文档流 → 兄弟元素立刻塌缩重排 | 搬走**之前**先在原位插一个隐形占位块 `div[data-ph-for=<eid>]`：`visibility:hidden`（保留版面空间）、`pointer-events:none`（点不到）、宽高 = 元素原尺寸 **含 margins**，并把元素的布局类（`.span-N` / flex 类等）拷过去，保证在栅格/伸缩布局里仍占原来的格子 |
| B | 撤销后占位块残留 | `backToGrid()` 只把元素插回原位，没管占位块 | `backToGrid()` 首行 `removePlaceholder(eid)`；「回到栅格」按钮清理 `data-eid-ph` |
| C | **重做（redo）拖动结果无效**（v3 起的旧 bug，这次顺带发现） | `restore()` 对 `free` 快照只挂了 `data-free` 属性，元素人还在流里，没进 `.free-layer` | `restore()` 对 `free` 快照：写回 `data-eid-parent/next/ph` → `freeLayer().appendChild(el)` → `ensurePlaceholder(el)` |

改动文件：`assets/editable.js`（唯一运行时代码）+ README §6 + 本文件。

## 二、怎么验证的（原生壳内 `EDITABLE_HTML_SELFTEST=1`，WKWebView 真跑鼠标事件）

**纵向堆叠页（3 个 `.blk`，拖中间那块）**

```
before: a(10.5,346.7) b(10.5,369.2) c(10.5,391.7)
after : a(10.5,346.7) [ph 10.5,369.2 h22.5] c(10.5,391.7) b(130.5,459.2)
PASS  neighbour-above-unmoved   10.5|346.7|482|16.2 -> 10.5|346.7|482|16.2
PASS  neighbour-below-unmoved   10.5|391.7|482|16.2 -> 10.5|391.7|482|16.2
PASS  dragged-moved             10.5|369.2|482|16.2 -> 130.5|459.2|482|16.2
PASS  placeholder-present       1
PASS  undo-restores-neighbours  28|327|1287|43.4 / 28|206.7|1287|43.4
PASS  undo-removes-placeholder  0
PASS  redo-keeps-neighbours     28|327|1287|43.4
PASS  redo-restores-placeholder 1
```

**12 栏栅格页（3 个 `.span-4`，拖中间那个）**

```
before: g1(10.5,346.7) g2(172.6,346.7) g3(334.6,346.7)
after : g1(10.5,346.7) [ph "blk span-4" 172.6,346.7] g3(334.6,346.7) g2(292.6,436.7)
```

→ 栅格里占位块仍占原来的格子（靠拷 `data-eid-base-cls` 的布局类），g1/g3 纹丝不动。

## 三、保存出的文件长什么样

```html
<section class="slide"><div class="stack">
  <div class="blk" id="a">块 A</div>
  <div class="blk" data-ph-for="e3" style="margin:0;padding:0;border:0;background:none;box-sizing:border-box;
       visibility:hidden;pointer-events:none;width:86px;height:62px"></div>
  <div class="blk" id="c">块 C</div>
  <div class="free-layer" style="position:absolute;inset:0;pointer-events:none;z-index:60">
    <div class="blk" id="b" style="position:absolute;left:130px;top:459px;...">块 B</div>
  </div>
</div></section>
```

- 占位块**故意保留**在交付文件里：它代表「这块版面仍然被占着」，删了重新打开就会重排。
- `data-eid-ph`（元素上的尺寸备份）在保存时被剥掉（纯编辑器内部状态）。

## 四、留下的坑

- 占位块会把元素的视觉类（`.card`/`.blk` 等）一并拷过去，`visibility:hidden` 保证看不见；但若某个类带 `:hover` 动效或 `animation`，占位块仍可能触发动画时间线（不影响版面）。
- 若元素原来靠 `float` 或绝对定位参与布局（本身已脱离流），占位块是多余的 —— 当前只在 `toFreeQuiet()` 里无条件插，接受这点冗余。
