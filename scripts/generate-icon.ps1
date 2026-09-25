$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$directory = Join-Path $PSScriptRoot '../apps/desktop/src-tauri/icons'
[System.IO.Directory]::CreateDirectory($directory) | Out-Null
$bitmap = New-Object System.Drawing.Bitmap 64, 64
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(9, 12, 14))
$white = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(229, 237, 231)), 3
$green = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(160, 215, 166)), 3
$graphics.DrawEllipse($white, 12, 12, 40, 40)
$graphics.DrawEllipse($green, 23, 12, 18, 40)
$graphics.DrawLine($white, 6, 32, 58, 32)
$memory = New-Object System.IO.MemoryStream
$bitmap.Save($memory, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $memory.ToArray()
[System.IO.File]::WriteAllBytes((Join-Path $directory 'icon.png'), $png)
$stream = [System.IO.File]::Create((Join-Path $directory 'icon.ico'))
$writer = New-Object System.IO.BinaryWriter $stream
$writer.Write([uint16]0)
$writer.Write([uint16]1)
$writer.Write([uint16]1)
$writer.Write([byte]64)
$writer.Write([byte]64)
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([uint16]1)
$writer.Write([uint16]32)
$writer.Write([uint32]$png.Length)
$writer.Write([uint32]22)
$writer.Write($png)
$writer.Dispose()
$memory.Dispose()
$white.Dispose()
$green.Dispose()
$graphics.Dispose()
$bitmap.Dispose()