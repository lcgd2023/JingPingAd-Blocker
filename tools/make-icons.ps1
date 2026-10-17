#!/usr/bin/env pwsh
<#
  净屏 · 广告拦截 — 从品牌原图生成扩展图标
  用法： powershell -File tools\make-icons.ps1
         powershell -File tools\make-icons.ps1 -Variant mark    # 换成「只保留叶子」的版本

  输入： icons/jingping.png （透明背景的品牌标志：叶子 + 净屏 字样）

  产物：
    icons/icon16.png icon32.png icon48.png icon128.png   扩展实际使用的图标（默认 = 完整标志）
    dist/icon-full/…  dist/icon-mark/…                   两种变体，便于切换 / 对比
    dist/icon-preview.png                                浅色 / 深色背景下的实际尺寸预览

  流程：按不透明像素裁掉透明边距 → 等比居中放进正方形画布（不拉伸变形）→
        4 倍超采样缩放（小尺寸更锐利）→ 输出 32 位带透明通道 PNG。
  mark 变体会把低饱和度的灰色像素（文字）透明化，只留下彩色叶子。
#>
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [string]$Source = '',
  [ValidateSet('full', 'mark')][string]$Variant = 'full'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$iconDir = Join-Path $Root 'icons'
$distDir = Join-Path $Root 'dist'
$fullDir = Join-Path $distDir 'icon-full'
$markDir = Join-Path $distDir 'icon-mark'
if (-not $Source) { $Source = Join-Path $iconDir 'jingping.png' }
if (-not (Test-Path $Source)) { throw "找不到图标源文件：$Source" }
New-Item -ItemType Directory -Force -Path $iconDir, $distDir, $fullDir, $markDir | Out-Null

$sizes = @(16, 32, 48, 128)
$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $Source).Path)

# 统计内容边界。$greenOnly = $true 时只统计有彩色的像素（叶子），从而排除灰色文字。
function Get-ContentBox {
  param([System.Drawing.Bitmap]$Bitmap, [bool]$GreenOnly)
  $minX = $Bitmap.Width; $minY = $Bitmap.Height; $maxX = -1; $maxY = -1
  for ($y = 0; $y -lt $Bitmap.Height; $y++) {
    for ($x = 0; $x -lt $Bitmap.Width; $x++) {
      $p = $Bitmap.GetPixel($x, $y)
      if ($p.A -le 8) { continue }
      if ($GreenOnly) {
        $max = [math]::Max($p.R, [math]::Max($p.G, $p.B))
        $min = [math]::Min($p.R, [math]::Min($p.G, $p.B))
        if (($max - $min) -lt 40) { continue }
      }
      if ($x -lt $minX) { $minX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
  if ($maxX -lt 0) { throw '未在源图中找到内容像素（图片可能是空白的？）' }
  return [pscustomobject]@{ X = $minX; Y = $minY; W = ($maxX - $minX + 1); H = ($maxY - $minY + 1) }
}

# 把低饱和度（灰色）像素透明化，只留下彩色叶子
function New-LeafOnlyBitmap {
  param([System.Drawing.Bitmap]$Bitmap)
  $out = New-Object System.Drawing.Bitmap($Bitmap.Width, $Bitmap.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  for ($y = 0; $y -lt $Bitmap.Height; $y++) {
    for ($x = 0; $x -lt $Bitmap.Width; $x++) {
      $p = $Bitmap.GetPixel($x, $y)
      if ($p.A -le 8) { continue }
      $max = [math]::Max($p.R, [math]::Max($p.G, $p.B))
      $min = [math]::Min($p.R, [math]::Min($p.G, $p.B))
      $sat = $max - $min
      if ($sat -lt 40) { continue }
      # 边缘轻微羽化，避免锯齿
      $alpha = $p.A
      if ($sat -lt 70) { $alpha = [int]($p.A * (($sat - 40) / 30.0)) }
      $out.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, $p.R, $p.G, $p.B))
    }
  }
  return $out
}

function Set-HighQuality {
  param([System.Drawing.Graphics]$Graphics)
  $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $Graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
}

# 把 $Box 区域的图像等比缩放进 $Size x $Size 的正方形 PNG
function New-IconPng {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    [pscustomobject]$Box,
    [int]$Size,
    [string]$OutPath
  )
  $pad = [int][math]::Ceiling([math]::Max($Box.W, $Box.H) * 0.06)   # 6% 安全边距（部分位置会被 Chrome 裁切）
  $side = [int][math]::Max($Box.W, $Box.H) + $pad * 2
  $big = $Size * 4                                                   # 4 倍超采样
  $scale = [double]$big / $side

  $canvas = New-Object System.Drawing.Bitmap($big, $big, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($canvas)
  try {
    Set-HighQuality -Graphics $g
    $w = [int][math]::Round($Box.W * $scale)
    $h = [int][math]::Round($Box.H * $scale)
    $dest = New-Object System.Drawing.Rectangle([int][math]::Round(($big - $w) / 2), [int][math]::Round(($big - $h) / 2), $w, $h)
    $g.DrawImage($Bitmap, $dest, $Box.X, $Box.Y, $Box.W, $Box.H, [System.Drawing.GraphicsUnit]::Pixel)
  } finally { $g.Dispose() }

  $final = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g2 = [System.Drawing.Graphics]::FromImage($final)
  try {
    Set-HighQuality -Graphics $g2
    $dest2 = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $g2.DrawImage($canvas, $dest2, 0, 0, $big, $big, [System.Drawing.GraphicsUnit]::Pixel)
  } finally { $g2.Dispose() }
  $final.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $final.Dispose()
  $canvas.Dispose()
}

$fullBox = Get-ContentBox -Bitmap $src -GreenOnly $false
$leaf = New-LeafOnlyBitmap -Bitmap $src
$markBox = Get-ContentBox -Bitmap $leaf -GreenOnly $false

try {
  foreach ($size in $sizes) {
    $fullPath = Join-Path $fullDir ("icon$size.png")
    $markPath = Join-Path $markDir ("icon$size.png")
    New-IconPng -Bitmap $src -Box $fullBox -Size $size -OutPath $fullPath
    New-IconPng -Bitmap $leaf -Box $markBox -Size $size -OutPath $markPath
    $chosen = if ($Variant -eq 'mark') { $markPath } else { $fullPath }
    Copy-Item -Path $chosen -Destination (Join-Path $iconDir ("icon$size.png")) -Force
  }

  # ---------------- 预览图：浅色 / 深色背景、两种变体、实际尺寸 ----------------
  $cellH = 176
  $totalW = 24
  $colW = @{}
  foreach ($s in $sizes) { $colW[$s] = [int][math]::Max($s, 104); $totalW += $colW[$s] + 12 }
  $rows = @(
    [pscustomobject]@{ Label = 'full (light)'; Bg = '#f1f3f4'; Fg = '#3c4043'; Dir = $fullDir; Used = ($Variant -eq 'full') },
    [pscustomobject]@{ Label = 'mark (light)'; Bg = '#f1f3f4'; Fg = '#3c4043'; Dir = $markDir; Used = ($Variant -eq 'mark') },
    [pscustomobject]@{ Label = 'full (dark)';  Bg = '#202124'; Fg = '#e8eaed'; Dir = $fullDir; Used = ($Variant -eq 'full') },
    [pscustomobject]@{ Label = 'mark (dark)';  Bg = '#202124'; Fg = '#e8eaed'; Dir = $markDir; Used = ($Variant -eq 'mark') }
  )
  $sheet = New-Object System.Drawing.Bitmap($totalW, ($cellH * $rows.Count), [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $sg = [System.Drawing.Graphics]::FromImage($sheet)
  try {
    Set-HighQuality -Graphics $sg
    $sg.Clear([System.Drawing.Color]::White)
    $labelFont = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Regular)
    $rowIndex = 0
    foreach ($row in $rows) {
      $top = $rowIndex * $cellH
      $bgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($row.Bg))
      $sg.FillRectangle($bgBrush, 0, $top, $totalW, $cellH)
      $fgBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($row.Fg))
      $title = $row.Label + $(if ($row.Used) { '   ← 当前使用' } else { '' })
      $sg.DrawString($title, $labelFont, $fgBrush, 12, ($top + 10))
      $x = 24
      foreach ($s in $sizes) {
        $path = Join-Path $row.Dir ("icon$s.png")
        $img = [System.Drawing.Image]::FromFile($path)
        try {
          $ix = $x + [int][math]::Round(($colW[$s] - $s) / 2)
          $iy = $top + $cellH - 24 - $s
          $sg.DrawImage($img, $ix, $iy, $s, $s)
          $sg.DrawString(("{0}px" -f $s), $labelFont, $fgBrush, ($x + 6), ($top + $cellH - 20))
        } finally { $img.Dispose() }
        $x += $colW[$s] + 12
      }
      $bgBrush.Dispose(); $fgBrush.Dispose()
      $rowIndex++
    }
    $labelFont.Dispose()
  } finally { $sg.Dispose() }
  $sheet.Save((Join-Path $distDir 'icon-preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  $sheet.Dispose()
} finally { $src.Dispose(); $leaf.Dispose() }

Write-Host "✔ 已生成图标（当前变体：$Variant）"
Write-Host "  icons\icon{16,32,48,128}.png  ← 扩展使用"
Write-Host "  变体备份：dist\icon-full\ 、dist\icon-mark\"
Write-Host "  预览图：  dist\icon-preview.png"
Write-Host ("  源图内容区：{0}x{1} @ ({2},{3})   叶子区：{4}x{5} @ ({6},{7})" -f $fullBox.W, $fullBox.H, $fullBox.X, $fullBox.Y, $markBox.W, $markBox.H, $markBox.X, $markBox.Y)
