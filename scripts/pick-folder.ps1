# pick-folder.ps1 — 选一个项目文件夹，然后启动工作台
# ---------------------------------------------------------------
# 由 open-project.cmd 调用。所有路径处理都在 PowerShell 里完成，
# 避免中文 / 空格路径在 cmd.exe 与 Node 之间来回转码出错。

Add-Type -AssemblyName System.Windows.Forms | Out-Null

$launcher = Join-Path $PSScriptRoot 'editable-studio.mjs'
if (-not (Test-Path -LiteralPath $launcher)) {
    [Console]::Error.WriteLine("找不到启动器: $launcher")
    exit 1
}

$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = '选择要被编辑的项目文件夹（里面要有 HTML 页面）'
$dlg.ShowNewFolderButton = $false
$dlg.UseDescriptionForTitle = $true

# 默认从桌面开始，省得每次从 C: 一路点进去
$desktop = [Environment]::GetFolderPath('Desktop')
if ($desktop) { $dlg.SelectedPath = $desktop }

$result = $dlg.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    exit 1
}

$folder = $dlg.SelectedPath
$port = 8899

# 记一下上次选的项目，下次可以少点几步（不影响功能）
try {
    $cfgDir = Join-Path $env:LOCALAPPDATA 'EditableHtmlWorkbench'
    New-Item -ItemType Directory -Path $cfgDir -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $cfgDir 'last-project.txt') -Value $folder -Encoding UTF8
} catch {}

# 用 Start-Process 起一个独立的控制台窗口，日志看得见；浏览器由启动器负责打开
$argStr = '"{0}" --root "{1}" --port {2}' -f $launcher, $folder, $port
Write-Host "正在打开工作台：$folder"
Start-Process -FilePath 'node' -ArgumentList $argStr

exit 0
