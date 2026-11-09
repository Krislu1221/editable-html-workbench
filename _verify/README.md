# `_verify/` — 零依赖验收脚本

用**系统已装的 Chrome**（或 Edge）通过 CDP 驱动真实鼠标事件，不需要安装 Playwright，也不下载浏览器。
Node.js 18+ 即可（用到内置 `WebSocket`，Node 22+ 更稳）。

## 前置

先用**打包根目录**启动工作台（不是 `_verify`）：

```powershell
# 在包根执行
node scripts\editable-studio.mjs --port 8899 --no-open
```

## 运行

```powershell
cd _verify
node t11-full.mjs     # 拖动 / 缩放 / 旋转 / 撤销 / 回到栅格 / 双击改字 / 层级 / 保存 / 回退
node t12-extra.mjs    # 封面页拖动 / 吸附参考线 / 切页 / 独立演示外壳 index.html
node t50-accurate.mjs  # v5.8：方向键微调 / 数值输入 / 空格 1:1 / 保存门控 / data-drag 保留

# 通用性：指向一个跟本包无关的项目（先单独起一个服务）
#   node scripts\editable-server.mjs --root "D:\某项目" --port 8911
node t20-any-project.mjs http://127.0.0.1:8911 "D:\某项目"

# 打开文档：切到项目外的某个 html 并写回（先起服务：--root 包根 --port 8923）
node t21-open-doc.mjs http://127.0.0.1:8923 "D:\某处\x.html"
```

输出形如：

```
PASS  单击即选中
屏幕位移 (100,60) → 逻辑位移 (187.3, 112.4)，期望 (187.3, 112.4)
PASS  水平位移 187.3 ≈ 期望 187.3（±吸附 6px）
```

`t11` 会真的把改动写回 `slides/03-new.html`，并在结束时用 `/__revert` + 本地兜底还原成原文，
失败时也会在 `finally` 里把文件写回。跑之前建议备份或确认有 git。

## 说明

- `cdp.mjs` 自己启动 `chrome.exe`（`--headless=new` + `--remote-debugging-port`），
  找不到 Chrome 时自动退到 Edge。Linux / macOS 需把 `cdp.mjs` 里的浏览器路径改成对应位置。
- 这些脚本**不要**放进项目页面目录，也不要改成 `.html`——工作台会把 `.html` 扫进左侧文件栏，
  打乱页码（`.mjs` 只会出现在文件树里，不影响列表）。
