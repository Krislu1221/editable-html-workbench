#!/usr/bin/env bash
# setup-mac.sh — macOS / Linux 首次使用：给脚本加可执行位，并检查环境
# ---------------------------------------------------------------
# 从 zip 解压出来的文件在 macOS 上默认没有可执行权限（Windows 打包不保留），
# 所以双击 .command 会打不开。先跑一次这个脚本即可：
#
#   bash scripts/setup-mac.sh
#
# 它只做三件事：chmod、检查 node 版本、打印下一步该点哪里。

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "包目录: $DIR"

chmod +x "$DIR/scripts/"*.sh 2>/dev/null || true
chmod +x "$DIR/scripts/"*.command 2>/dev/null || true
echo "✓ 已设置可执行位（scripts/*.sh、scripts/*.command）"

# 从网络下载的 zip 会被打上 com.apple.quarantine，双击 .command 会提示
# 「无法验证开发者」。这里直接剥掉，省得用户去系统设置里点。
if xattr -p com.apple.quarantine "$DIR" >/dev/null 2>&1; then
    xattr -dr com.apple.quarantine "$DIR" 2>/dev/null || true
    echo "✓ 已移除 com.apple.quarantine（Gatekeeper 拦截已解除）"
fi

if command -v node >/dev/null 2>&1; then
    V="$(node -v)"
    echo "✓ Node.js $V"
    MAJOR="$(echo "$V" | sed 's/v//' | cut -d. -f1)"
    if [ "$MAJOR" -lt 18 ] 2>/dev/null; then
        echo "⚠ Node.js 版本偏低，请装 18+：https://nodejs.org/"
    fi
else
    echo "✗ 没找到 node。请先安装 LTS 版：https://nodejs.org/（或用 brew install node）"
fi

# 测试脚本里也硬编码了浏览器路径，这里顺带提示
if [ -d "/Applications/Google Chrome.app" ] || [ -d "/Applications/Microsoft Edge.app" ]; then
    echo "✓ 找到 Chrome / Edge（_verify 下的自动化测试可用）"
fi

cat <<'EOT'

下一步（任选其一）：
  · 双击 scripts/open-project.command  → 弹窗选项目文件夹，自动打开工作台
  · 或终端运行：bash scripts/editable-studio.sh "<项目目录>" 8899
  · 或把项目文件夹拖到 scripts/open-project.command 上（macOS 会把路径作为第一个参数传进去）

如果 macOS 提示「无法打开，因为无法验证开发者」：
  右键点 .command → 打开；或在终端执行
  xattr -dr com.apple.quarantine "<本目录>"
EOT
