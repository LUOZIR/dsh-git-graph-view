# 回退安装：把 dsh-git-graph-view 手动装进 desktop profile（不改动任何现有插件）。
#
# 前置：已在本目录执行过 npm pack，产出 dsh-git-graph-view-0.1.0.tgz。
# 用法（在本仓库根）：
#   powershell -ExecutionPolicy Bypass -File scripts/install-profile.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/install-profile.ps1 -Tgz .\dist\dsh-git-graph-view-0.1.0.tgz
#   powershell -ExecutionPolicy Bypass -File scripts/install-profile.ps1 -Uninstall
#
# 做的事：
#   1) 备份 profile package.json；
#   2) 把 tgz 复制到 profile\vendor\；
#   3) package.json 增加依赖 + dsh.profile.bundles 条目；
#   4) 解包 tgz 到 profile\node_modules\dsh-git-graph-view\；
#   5) 打印校验结果与「必须完全重启 DSH」的提示。
# 不做：不运行 pnpm（避免联网/重装现有依赖）；不重启 DSH。
#
# 回滚：-Uninstall 会移除依赖/bundle 条目、删除 node_modules 目录、保留 vendor tgz 与备份；
#       若需要连备份一起还原，用 package.json.bak-ggv-<时间戳> 覆盖 package.json。

param(
  [string]$ProfileDir = $(if ($env:DSH_HOME) { Join-Path $env:DSH_HOME 'profiles\desktop' } else { Join-Path $env:USERPROFILE '.dsh\profiles\desktop' }),
  [string]$Tgz = '',
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$repoRoot = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
$pluginName = 'dsh-git-graph-view'
$pkgPath = Join-Path $ProfileDir 'package.json'
$moduleDir = Join-Path $ProfileDir ('node_modules\' + $pluginName)

if (-not (Test-Path $pkgPath)) {
  throw "找不到 profile package.json：$pkgPath（确认 DSH Desktop 至少启动过一次）"
}

function Assert-Node() {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { throw '未找到 node（需要 Node 20+ 来安全修改 JSON 与校验）' }
  return $node.Source
}
$nodeExe = Assert-Node

if ($Uninstall) {
  & $nodeExe (Join-Path $repoRoot 'scripts\patch-profile.mjs') $ProfileDir 'dsh-git-graph-view-0.1.0.tgz' --remove
  if (Test-Path $moduleDir) { Remove-Item -Recurse -Force $moduleDir }
  Write-Host ''
  Write-Host '已卸载。请完全退出并重新启动 DeepSeek Harness 生效。' -ForegroundColor Yellow
  Write-Host '若要彻底还原：用 profile\package.json.bak-ggv-<时间戳> 覆盖 package.json。'
  exit 0
}

if ([string]::IsNullOrWhiteSpace($Tgz)) {
  $candidate = Get-ChildItem -Path $repoRoot -Filter 'dsh-git-graph-view-*.tgz' -File |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $candidate) { throw '未找到 tgz：请先在本目录执行 npm pack，或用 -Tgz 指定路径' }
  $Tgz = $candidate.FullName
}
if (-not (Test-Path $Tgz)) { throw "找不到 tgz：$Tgz" }
$tgzName = Split-Path -Leaf $Tgz

# 1) 复制 tgz 到 vendor
$vendorDir = Join-Path $ProfileDir 'vendor'
New-Item -ItemType Directory -Force -Path $vendorDir | Out-Null
Copy-Item -LiteralPath $Tgz -Destination (Join-Path $vendorDir $tgzName) -Force
Write-Host "[install] 已复制 $tgzName 到 $vendorDir"

# 2) 改 package.json（内部会备份）
& $nodeExe (Join-Path $repoRoot 'scripts\patch-profile.mjs') $ProfileDir $tgzName
if ($LASTEXITCODE -ne 0) { throw 'patch-profile.mjs 失败' }

# 3) 解包到 node_modules（tar 是 Windows 10+ 自带）
$tmpDir = Join-Path $env:TEMP ('ggv-install-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
try {
  tar -xzf $Tgz -C $tmpDir
  $src = Join-Path $tmpDir 'package'
  if (-not (Test-Path (Join-Path $src 'package.json'))) { throw 'tgz 里没有 package/package.json' }
  if (Test-Path $moduleDir) { Remove-Item -Recurse -Force $moduleDir }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $moduleDir) | Out-Null
  Copy-Item -Recurse -Force -LiteralPath $src -Destination $moduleDir
} finally {
  Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
}
Write-Host "[install] 已安装到 $moduleDir"

# 4) 校验
$installedPkg = Get-Content (Join-Path $moduleDir 'package.json') -Raw | ConvertFrom-Json
$profilePkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
$bundles = @($profilePkg.dsh.profile.bundles)
$problems = @()
if ($installedPkg.name -ne $pluginName) { $problems += 'node_modules 里的包名不对' }
if (-not (Test-Path (Join-Path $moduleDir 'cordis.patch.yml'))) { $problems += '缺少 cordis.patch.yml' }
foreach ($file in @('lib\index.js', 'lib\client.js')) {
  if (-not (Test-Path (Join-Path $moduleDir $file))) { $problems += "缺少 $file" }
}
if (-not $profilePkg.dependencies.$pluginName) { $problems += 'profile 依赖里没有插件' }
if ($bundles -notcontains $pluginName) { $problems += 'dsh.profile.bundles 里没有插件' }

# 客户端启动标记（host apply 时写入），重启后可用于确认
$marker = Join-Path $env:TEMP 'dsh-git-graph-view-boot.json'

if ($problems.Count -gt 0) {
  Write-Host ''
  Write-Host ('校验失败：' + ($problems -join '；')) -ForegroundColor Red
  Write-Host '已安装文件仍在；可执行 -Uninstall 回滚。'
  exit 1
}

Write-Host ''
Write-Host '✅ 校验通过：依赖、bundle 条目、node_modules 文件齐全。' -ForegroundColor Green
Write-Host ''
Write-Host '下一步：' -ForegroundColor Yellow
Write-Host '  1. 完全退出 DeepSeek Harness（托盘退出，确认进程结束）；'
Write-Host '  2. 重新启动；'
Write-Host '  3. 打开任意会话，标签栏应出现「Git 图谱」；'
Write-Host "  4. 重启后可检查启动标记：$marker"
Write-Host ''
Write-Host '若启动失败：用 scripts\install-profile.ps1 -Uninstall 回滚（或还原 package.json.bak-ggv-*）。'
