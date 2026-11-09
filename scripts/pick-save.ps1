# 「另存副本」文件对话框（Windows）
# 用法：powershell -File pick-save.ps1 -OutFile <临时文件> [-InitialDir <目录>] [-FileName <默认名>]
# 选中路径写进 -OutFile（UTF-8），不写 stdout：
# PowerShell 5.1 重定向 stdout 默认是 OEM 代码页，中文路径会变乱码。
param(
    [Parameter(Mandatory=$true)][string]$OutFile,
    [string]$InitialDir = "",
    [string]$FileName = "copy.html"
)

Add-Type -AssemblyName System.Windows.Forms | Out-Null

$dlg = New-Object System.Windows.Forms.SaveFileDialog
$dlg.Title = "另存副本到"
$dlg.Filter = "HTML 文件 (*.html;*.htm)|*.html;*.htm|所有文件 (*.*)|*.*"
$dlg.FileName = $FileName
$dlg.AddExtension = $true
$dlg.OverwritePrompt = $true
if ($InitialDir -and (Test-Path -LiteralPath $InitialDir)) {
    $dlg.InitialDirectory = $InitialDir
}

$res = $dlg.ShowDialog()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
    [System.IO.File]::WriteAllText($OutFile, $dlg.FileName, (New-Object System.Text.UTF8Encoding($false)))
    exit 0
}
exit 1
