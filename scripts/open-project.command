#!/usr/bin/env bash
# open-project.command — macOS 双击入口：选一个项目文件夹，打开工作台
#
# 三种用法：
#   1) 双击                    → 弹「选择文件夹」对话框
#   2) 把文件夹/单个 html 拖上来 → 直接用拖进来的路径（Finder 会把路径作为 $1 传入）
#   3) 终端 ./open-project.command "/路径" [端口]
#
# 首次使用前请先跑一次 scripts/setup-mac.sh 给它加可执行位。
# 若提示「来自身份不明的开发者」，右键 → 打开，或在终端执行：
#   xattr -dr com.apple.quarantine "<解压后的目录>"

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "${1:-}" != "" ]; then
    # 拖拽或命令行给了路径：跳过对话框
    exec bash "$DIR/editable-studio.sh" "$1" "${2:-8899}"
fi

exec bash "$DIR/pick-folder.sh"
