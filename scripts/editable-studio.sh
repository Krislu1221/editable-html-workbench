#!/usr/bin/env bash
# editable-studio.sh — 启动 Editable HTML 工作台（macOS/Linux 便捷包装）
#
# 用法：
#   ./editable-studio.sh <项目目录> [端口]
#
# 作用：起本地服务（默认 8899），打开工作台。
# 编辑器保存时直接写回原文件，不产生新文件、不加编号。
#
# 注意：跨平台逻辑已统一在 editable-studio.mjs（Windows 用 editable-studio.cmd），
#       本脚本只做薄包装，避免两处逻辑漂移。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# 默认根目录 = 包根目录（scripts 上一级）。旧默认值指向作者自己机器上的
# ~/.nanobot 路径，换台机器就失效。
ROOT="${1:-$SCRIPT_DIR/..}"
PORT="${2:-8899}"

[ -d "$ROOT" ] || { echo "目录不存在: $ROOT" >&2; exit 1; }
[ -f "$SCRIPT_DIR/editable-server.mjs" ] || { echo "找不到 server: $SCRIPT_DIR/editable-server.mjs" >&2; exit 1; }

if command -v node >/dev/null 2>&1; then
  exec node "$SCRIPT_DIR/editable-studio.mjs" --root "$ROOT" --port "$PORT"
fi

# 没有 node：尝试常见安装位置
for N in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.nvm/versions/node"/*/bin/node; do
  if [ -x "$N" ]; then
    exec "$N" "$SCRIPT_DIR/editable-studio.mjs" --root "$ROOT" --port "$PORT"
  fi
done

echo "未找到 Node.js，请先安装：https://nodejs.org/" >&2
exit 1
