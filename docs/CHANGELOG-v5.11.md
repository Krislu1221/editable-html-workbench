# v5.11 变更记录 —— 层序（PPT 的「层」）

- 日期：2026-11-10（北京时间 02:55–03:20）
- 基线：v5.10（PPT 画布锁定 + 另存副本）
- 起因：老板问「重叠的时候有层的概念吗？能在上层/下层移动吧？」——面板里本来就有「置顶/上移/下移/置底」，
  但**画布锁定之后这套层序有两个真实断点**，本版修掉并补验收。

## 一、问题

| # | 问题 | 后果 |
|---|---|---|
| A | `.free-layer` 自带 `z-index:60` | 拖出来的元素永远压在页面内容之上，**「置底」根本看不见效果**（它的层号只在 free-layer 内部比较，而 free-layer 整体在 60） |
| B | 序列化时「非 free-layer 成员一律剥掉 z-index」 | 这条规则是早期流式时代的补丁（那时只有自由层需要层号）。画布锁定后所有块级元素都是定位元素 → **你在面板里调好的层序，一保存就被抹掉**，重新打开层次全乱 |
| C | 冻结时不发初始层号（全是 `z-index:auto`） | `zOf()` 默认值 10 与 auto 混用，「上移/下移」的基准不可预测 |

## 二、改法

1. **free-layer 不再设 z-index**（`position:absolute;inset:0;pointer-events:none`）→ 它的子元素与画布其他定位元素进入**同一个层叠上下文**，真正可前可后。
2. **序列化只剥「非定位元素」的 z-index**：`position:absolute|fixed|relative` 的元素（含冻结出的）保留层号；判断依据从「在不在 free-layer」改成「是否定位」。
3. **冻结时按文档顺序给每个块发初始 z-index**（已带 z-index 的元素不覆盖，避免重置用户调过的层序）。
4. `__editableAPI.layer(cmd)` 暴露给外壳/验收脚本：`front / back / up / down`（先 `select(el)`）。

## 三、验收（WKWebView 真事件，层序部分）

```
PASS  boxes-overlap                两块确实重叠（重叠点 154,357）
PASS  dragged-on-top-by-default    重叠点命中 b（拖出来的元素默认在上）
PASS  back-button-exists           面板 [data-z="back"] 存在
PASS  send-to-back-works           点「置底」后重叠点命中 c —— 真的翻到下层
PASS  z-index-written              b=-1 c=4
PASS  saveas-writes-copy           1350B
PASS  freeze-does-not-move-anything  max|Δ| = 0.000 px over 4 boxes
PASS  neighbours-unmoved-after-drag
```

保存后的文件（层号完整保留）：

```html
<div class="blk" id="a" style="position:absolute;left:0px;top:0px;width:1200px;height:62px;...;z-index:2">
<div class="blk" id="c" style="position:absolute;left:0px;top:172px;width:1200px;height:62px;...;z-index:4">
<div class="blk" id="b" style="position:absolute;left:206.41px;top:250.81px;width:1200px;...;z-index:-1">
<div class="free-layer" style="position: absolute; inset: 0px; pointer-events: none">   ← 不再带 z-index:60
```

## 四、层的边界（必须知道）

- **同一父容器内**：z-index 直接比较，置顶/置底立刻生效。
- **跨父容器**（例如自由层里的元素 vs 某个卡片里的元素）：浏览器按「最近的层叠上下文」比较。
  如果父容器自己没定位/没 z-index，两者仍可比较；若父容器有 `z-index`（自建层叠上下文），
  子元素的层号只在父容器内部生效 —— 和 PPT 的「组合/组内层序」是同一回事。
- 面板命令作用于**当前选中元素所属的「块」**（`blockOf`），文字层选中会先上溯到块。

## 五、未做（如果需要再说）

- 没有「图层面板」（列出所有元素 + 缩略层号拖动排序）。现在只有选中后的四个按钮 + 面板里的层号数值。
- 没有「锁定/隐藏元素」开关（PPT 里有）。
