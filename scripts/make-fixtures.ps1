# 一键重建真实 git 输出 fixture：
#   1) 在仓库根创建 .fixture-repo（确定性时间戳、main/feature 分支 + 合并、中文文件名）
#   2) 用 PowerShell 管道（不受本机 DSH 沙箱的“Node 管道 spawn EPERM”限制）抓取原始输出
#   3) 写入 test/fixtures/git-outputs.json（含 NUL / RS 控制字符，JSON 转义保存）
#   4) 删除 .fixture-repo
#
# 用法（需要 PowerShell 7）：pwsh -NoProfile -File scripts/make-fixtures.ps1
# 若执行策略阻止 .ps1：powershell -ExecutionPolicy Bypass -File scripts/make-fixtures.ps1
#
# 说明：隐藏字符（%x00 / %x1e）依赖 git 原样输出，PowerShell 逐行捕获后用
# LF 重新拼接，能完整保留控制字符；fixture 仅用于解析/业务层回归测试。

$ErrorActionPreference = 'Stop'
$root = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
Set-Location $root

$repo = Join-Path $root '.fixture-repo'
if (Test-Path $repo) { Remove-Item -Recurse -Force $repo }
New-Item -ItemType Directory -Path $repo | Out-Null

git -C $repo init -q -b main
git -C $repo config user.name 'Fixture 张三'
git -C $repo config user.email 'fixture@example.com'
git -C $repo config commit.gpgsign false
git -C $repo config core.autocrlf false

function CommitAt([string]$message, [string]$date) {
  $env:GIT_AUTHOR_DATE = $date
  $env:GIT_COMMITTER_DATE = $date
  git -C $repo add -A
  git -C $repo commit -q -m $message
}

[System.IO.File]::WriteAllText((Join-Path $repo 'a.txt'), "line1`nline2`n", [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText((Join-Path $repo 'README.md'), "# demo`n", [System.Text.UTF8Encoding]::new($false))
CommitAt 'chore: 初始提交' '2026-01-01T00:00:00+00:00'
$rootSha = (git -C $repo rev-parse HEAD).Trim()

[System.IO.File]::WriteAllText((Join-Path $repo 'a.txt'), "line1`nline2 changed`nline3`n", [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText((Join-Path $repo '中文 文件.md'), "# 中文文件`n内容`n", [System.Text.UTF8Encoding]::new($false))
CommitAt 'feat: 修改 a.txt 并新增中文文件' '2026-01-02T00:00:00+00:00'
$normalSha = (git -C $repo rev-parse HEAD).Trim()

git -C $repo checkout -q -b feature
[System.IO.File]::WriteAllText((Join-Path $repo 'c.txt'), "feature c`n", [System.Text.UTF8Encoding]::new($false))
CommitAt 'feat: feature 分支新增 c.txt' '2026-01-03T00:00:00+00:00'
$featureSha = (git -C $repo rev-parse HEAD).Trim()

git -C $repo checkout -q main
CommitAt 'feat: main 侧准备合并' '2026-01-04T00:00:00+00:00'
$env:GIT_AUTHOR_DATE = '2026-01-05T00:00:00+00:00'
$env:GIT_COMMITTER_DATE = '2026-01-05T00:00:00+00:00'
git -C $repo merge -q --no-ff feature -m 'merge: 合并 feature 分支'
$mergeSha = (git -C $repo rev-parse HEAD).Trim()

$format = '%H%x00%P%x00%an%x00%ae%x00%at%x00%D%x00%s%x1e'
$showFormat = '%H%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%D%x00%B'

function Capture([string[]]$Arguments) {
  $lines = & git -C $repo @Arguments 2>$null
  if ($null -eq $lines) { return '' }
  return (($lines | ForEach-Object { [string]$_ }) -join "`n")
}

$fixture = [ordered]@{
  gitVersion     = (Capture @('--version'))
  shas           = [ordered]@{ root = $rootSha; normal = $normalSha; feature = $featureSha; merge = $mergeSha }
  toplevel       = (Capture @('rev-parse', '--show-toplevel'))
  status         = (Capture @('-c', 'core.quotepath=false', 'status', '--porcelain=v2', '--branch', '--untracked-files=no'))
  graphLog       = (Capture @('-c', 'core.quotepath=false', 'log', '--branches', '--tags', '--remotes', '--topo-order', '--decorate=full', '--parents', '--max-count', '100', "--format=$format"))
  showRoot       = (Capture @('-c', 'core.quotepath=false', 'show', '-s', '--decorate=full', '--no-show-signature', "--format=$showFormat", $rootSha))
  showNormal     = (Capture @('-c', 'core.quotepath=false', 'show', '-s', '--decorate=full', '--no-show-signature', "--format=$showFormat", $normalSha))
  showMerge      = (Capture @('-c', 'core.quotepath=false', 'show', '-s', '--decorate=full', '--no-show-signature', "--format=$showFormat", $mergeSha))
  diffRootName   = (Capture @('-c', 'core.quotepath=false', 'diff-tree', '-r', '--no-commit-id', '--no-renames', '--name-status', '--root', $rootSha))
  diffRootNum    = (Capture @('-c', 'core.quotepath=false', 'diff-tree', '-r', '--no-commit-id', '--no-renames', '--numstat', '--root', $rootSha))
  diffNormalName = (Capture @('-c', 'core.quotepath=false', 'diff-tree', '-r', '--no-commit-id', '--no-renames', '--name-status', $normalSha))
  diffNormalNum  = (Capture @('-c', 'core.quotepath=false', 'diff-tree', '-r', '--no-commit-id', '--no-renames', '--numstat', $normalSha))
  diffMergeName  = (Capture @('-c', 'core.quotepath=false', 'diff-tree', '-r', '--no-commit-id', '--no-renames', '--name-status', "$mergeSha^1", $mergeSha))
  diffMergeNum   = (Capture @('-c', 'core.quotepath=false', 'diff-tree', '-r', '--no-commit-id', '--no-renames', '--numstat', "$mergeSha^1", $mergeSha))
}

$outDir = Join-Path $root 'test\fixtures'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir 'git-outputs.json'
$json = $fixture | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($outFile, $json, [System.Text.UTF8Encoding]::new($false))

Remove-Item -Recurse -Force $repo
Write-Host "已生成 $outFile（$([System.IO.File]::ReadAllText($outFile).Length) 字符），并已清理 .fixture-repo"
