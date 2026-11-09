#!/usr/bin/env bash
# pick-folder.sh — macOS：弹「选择项目文件夹」对话框，然后启动工作台
# ---------------------------------------------------------------
# 由 open-project.command 调用（双击 .command 即可）。
# 与 Windows 的 pick-folder.ps1 对应；两个平台都用各自的系统对话框，
# 保证路径里带中文/空格也不会出错。
#
# 用法：
#   bash pick-folder.sh                → 弹窗选文件夹
#   bash pick-folder.sh "/某个/目录"    → 跳过弹窗，直接用该目录
#   bash pick-folder.sh "/某个/目录" 8900  → 指定端口

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${2:-8899}"

FOLDER="${1:-}"
if [ -z "$FOLDER" ]; then
    # 默认从当前项目目录（脚本上一级）开始翻，省去一层层点进去
    FOLDER="$(osascript \
        -e "set startDir to POSIX file \"${DIR}/..\"" \
        -e 'POSIX path of (choose folder with prompt "选择要被编辑的项目文件夹（里面要有 HTML 页面）" default location startDir)' \
        2>/dev/null || true)"
fi

if [ -z "${FOLDER:-}" ]; then
    echo "已取消。"
    exit 0
fi

echo "正在打开工作台：$FOLDER"
exec bash "$DIR/editable-studio.sh" "$FOLDER" "$PORT"
