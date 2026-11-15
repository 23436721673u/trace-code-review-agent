$ErrorActionPreference = 'Stop'
$traceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$tracePython = (& py -3 -c 'import sys; print(sys.executable)').Trim()
if ($LASTEXITCODE -ne 0) { throw '需要 Python 3.9 或以上版本。' }
$tracePythonW = Join-Path (Split-Path -Parent $tracePython) 'pythonw.exe'
if (-not (Test-Path -LiteralPath $tracePythonW)) { throw '未找到 pythonw.exe。' }
if (-not (Test-Path -LiteralPath (Join-Path $traceRoot 'index.html'))) { throw '请先生成 index.html。' }

# Draw a native Windows icon from the existing TRACE wordmark geometry.
Add-Type -AssemblyName System.Drawing
$traceAssets = Join-Path $traceRoot 'assets'
New-Item -ItemType Directory -Path $traceAssets -Force | Out-Null
$traceIcon = Join-Path $traceAssets 'trace.ico'
$traceBitmap = [System.Drawing.Bitmap]::new(128, 128)
$traceGraphics = [System.Drawing.Graphics]::FromImage($traceBitmap)
$traceGraphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$traceGraphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#080d19'))
$traceBlue = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#9dd7ff'))
$tracePurple = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#ac9cf8'))
$traceGraphics.FillRectangle($traceBlue, 28, 33, 72, 14)
$traceGraphics.FillRectangle($traceBlue, 57, 43, 14, 55)
$traceGraphics.FillEllipse($tracePurple, 88, 86, 13, 13)
$traceNative = [System.Drawing.Icon]::FromHandle($traceBitmap.GetHicon())
$traceStream = [System.IO.File]::Create($traceIcon)
try { $traceNative.Save($traceStream) } finally { $traceStream.Dispose() }
$traceGraphics.Dispose()
$traceBitmap.Dispose()
$traceBlue.Dispose()
$tracePurple.Dispose()

$traceDesktop = [Environment]::GetFolderPath('Desktop')
$traceShell = New-Object -ComObject WScript.Shell
$traceShortcutPath = Join-Path $traceDesktop 'TRACE 代码审查.lnk'
$traceShortcut = $traceShell.CreateShortcut($traceShortcutPath)
$traceShortcut.TargetPath = $tracePythonW
$traceShortcut.Arguments = '"' + (Join-Path $traceRoot 'desktop_launcher.pyw') + '"'
$traceShortcut.WorkingDirectory = $traceRoot
$traceShortcut.IconLocation = $traceIcon + ',0'
$traceShortcut.Description = 'TRACE · 只读代码审查 Agent / DeepSeek + Strix'
$traceShortcut.Save()
Write-Output ('桌面入口已创建：' + $traceShortcutPath)
