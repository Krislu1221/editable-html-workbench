# pick-file.ps1 — 弹「打开文档」对话框，把选中的路径写进 -OutFile
# ---------------------------------------------------------------
# 由 editable-server.mjs 在 /__pick 时调用。
#
# 为什么写临时文件而不是输出到 stdout：
#   Windows PowerShell 5.1 的重定向 stdout 默认用 OEM 代码页（936），
#   中文路径按 UTF-8 解会变乱码。写 UTF-8 临时文件可完全绕开编码问题。
#
# 为什么用旧式对话框（AutoUpgradeEnabled = $false）：
#   新版 shell 对话框首次打开要加载云端文件系统扩展（OneDrive 等），
#   实测要等好几秒；旧式对话框是本地控件，快得多。

param(
    [Parameter(Mandatory = $true)][string]$OutFile,
    [string]$InitialDir
)

Add-Type -AssemblyName System.Windows.Forms | Out-Null

$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Title = '打开要编辑的 HTML 文档'
$dlg.Filter = 'HTML 页面 (*.html;*.htm)|*.html;*.htm|所有文件 (*.*)|*.*'
$dlg.CheckFileExists = $true
$dlg.Multiselect = $false
$dlg.RestoreDirectory = $true
$dlg.AutoUpgradeEnabled = $false

# 从当前项目目录开始，省得每次从「文档」一路点进去
if ($InitialDir -and (Test-Path -LiteralPath $InitialDir)) {
    $dlg.InitialDirectory = $InitialDir
}

if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($OutFile, $dlg.FileName, $enc)
    exit 0
}

exit 1
