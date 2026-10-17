#!/usr/bin/env pwsh
<#
  净屏 · 广告拦截 — 打包脚本
  把扩展运行所需的文件打包成 zip（可直接上传 Chrome 应用商店），
  排除开发/测试相关目录（tools、README、dist）。

  用法： pwsh tools/pack.ps1            # 生成 dist/adshield-<版本>.zip
#>
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

$manifestPath = Join-Path $Root 'manifest.json'
$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $manifest.version

$distDir = Join-Path $Root 'dist'
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
$zipPath = Join-Path $distDir "adshield-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$exclude = @('tools', 'dist', 'node_modules', '.git', '.vscode')
$items = Get-ChildItem -Path $Root -Force | Where-Object {
  $exclude -notcontains $_.Name -and $_.Name -notlike '*.zip' -and $_.Name -notlike 'README*.md'
}

# 品牌原图只用于生成图标（tools/make-icons.ps1），运行时不读取，不进包
$sourceArtwork = Join-Path $Root 'icons\jingping.png'

$staging = Join-Path ([System.IO.Path]::GetTempPath()) ("adshield-pack-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging | Out-Null

foreach ($item in $items) {
  Copy-Item -Path $item.FullName -Destination $staging -Recurse -Force
}

if (Test-Path $sourceArtwork) {
  $stagedArtwork = Join-Path $staging 'icons\jingping.png'
  if (Test-Path $stagedArtwork) { Remove-Item $stagedArtwork -Force }
}

Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item $staging -Recurse -Force

$size = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Write-Host "✔ 已生成 $zipPath  ($size KB)"
Write-Host "  版本：$version  规则档：$((Get-ChildItem (Join-Path $Root 'rules')).Count) 个"
