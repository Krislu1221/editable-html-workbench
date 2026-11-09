# v5.8 变更记录 —— 精确编辑 + 保存门控

- 日期：2026-11-01（北京时间 02:15–03:10）
- 基线：v5.7-mac（= Windows 侧 v5.6 + macOS 移植修正）
- 验收环境：Mac mini M4 / macOS 26.5.1 / Node 26.5.0 / Google Chrome
- 验收脚本：`_verify/t50-accurate.mjs`（新增）+ 原有六套全量回归

## 一、修了什么

| # | 问题 | 根因 | 修法 |
|---|---|---|---|
| A | **作者写的裸 `data-drag` 被保存删掉** | `serialize()` 里 `if (!el.getAttribute("data-drag")) removeAttribute(...)`——把「空值」当垃圾判据；而 README §8 教作者写的就是裸 `data-drag` | 删掉该判据，改为只清带 `data-ed-drag-added` 标记的属性；编辑器从不写 data-drag，所以实际不清任何东西 |
| B | **没改动点保存也改写文件** | `save()` 无条件 `serialize()` 并 POST；DOM 重序列化必然产生字节差异（`<html><head>` 合并、`hidden`→`hidden=""`、注入脚本剥掉的空行） | 新增「原文 vs 当前页面」语义比对：两边各自过 `canonicalHtml()`（删纯空白文本节点、data-*/boolean 空值属性归一、剥掉 `__EDIT_FILE__` 注入脚本）后相等就**不写盘** |
| B' | **连点两次保存字节继续漂** | 同 B，且无基准 | 写成功后把当前内容设为新基准（`pristineCache = content`），再点保存命中「无改动」分支 → 幂等 |
| B'' | **门控被事件对象绕过**（B 改完发现的坑） | `on("ed_save","click", save)` 直接把 click 事件传进 `save(force)`，`force` 恒真 | 改成 `() => save()` |
| C | 无法做像素级微调 | 面板「位置与尺寸」只读，没有方向键 | 新增方向键微调：1px / Shift 10px；700ms 内连续按键合成**一个**撤销步 |
| D | 不能精确输坐标 | 同 C | 面板新增 X / Y / 宽 / 高 四个数字输入框，回车即落位（页面坐标 px，与缩放无关） |
| E | 放大后看不到真实比例 | 无 | 按住空格 → `zoomOverride = 1`（1 CSS px : 1 屏幕 px），松开恢复；顶部显示「1:1 真实比例」提示条 |

改动文件：`assets/editable.js`（唯一改动的运行时代码）、`_verify/t50-accurate.mjs`（新增）、README、本文件。

## 二、怎么验证的（t50-accurate 输出摘要）

```
空保存提示: "没有实质改动，未写盘"
PASS  没改动时点保存：文件逐字节未变（caa5187d1dd9）
PASS  方向键把元素转入自由定位
PASS  → 连按 3 次位移 3.0px（期望 3）
PASS  Shift+↓ 位移 10.0px（期望 10）
PASS  撤销退回到上一步（连续方向键合为一个撤销步）
PASS  X/Y 输入生效 = 120 / 180
PASS  W/H 输入生效 = 420px / 160px
PASS  面板数值与元素真实几何同步
PASS  按住空格 → 缩放 1.000（期望 1，即 1:1）
PASS  出现 1:1 提示条
PASS  松开空格恢复 0.542（原 0.542）
PASS  提示条已移除
PASS  有改动时确实写盘了
PASS  作者的裸 data-drag 没被删（原文 4 处，保存后 4 处）
PASS  写回的文件没有编辑器残留
PASS  编辑期 scale 没有写进文件
PASS  X=300 已落到文件里
PASS  连点第二次保存：文件不变（幂等）
控制台错误: 无 error
```

回归（同一台机器，改完 v5.8 后全部重跑）：
`t11-full` / `t12-extra` / `t20-any-project` / `t21-open-doc` / `t22-zoom` / `t23-preview` **六套零 FAIL**。

## 三、缩放到底会不会改页面（这轮反复被追问，钉死结论）

缩放只做一件事：给画布加 `transform: scale(k)`。

实测（编辑态，放大前后对比）：

| 读数 | 放大前 | 放大后 |
|---|---|---|
| `.slide` 的 `offsetWidth` | 1920 | **1920** |
| `h2` 的 computed `font-size` | 28px | **28px** |
| 文档 `scrollWidth` | 2125 | **2125** |
| `.slide.style.transform` | `(none)` | `scale(1.107)` |
| 保存后的文件里出现的 `transform: scale(` | — | **0 处** |

即：所谓「文字变大」是像素被拉大后画到屏幕上（拿放大镜看同一张纸），页面 CSS 一个字没改，也不会写进文件。
要「不改变视觉比例也能调准」，正确工具是方向键微调与数值输入（本轮已加）。

## 四、已知取舍

- 真做了修改再保存时，文件仍会被整份重新序列化（`data-drag=""`、`hidden=""`、空行规范化）。
  这是 DOM→字符串的固有行为，不追求逐字节复刻原格式；但**没有修改时绝不会碰文件**。
- 方向键会把元素转成自由定位（和拖动一致）。想回到栅格用面板「回到栅格」。
- 数值输入改 X/Y 同样会转自由定位；元素在栅格时会先按当前位置脱流，视觉位置不变。
