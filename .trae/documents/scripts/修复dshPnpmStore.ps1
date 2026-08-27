# 修复 dsh profile 的 pnpm store 版本不匹配，并可将 rulebase 插件安装进指定 profile。
# 场景：profile 的 node_modules 由旧 pnpm store(如 v10)链接，当前 pnpm(如 v11)报
#   ERR_PNPM_UNEXPECTED_STORE。
# 依据 pnpm 自身建议：用当前 pnpm 重链接 node_modules（会清空并重装该 profile 依赖）。
# 用法：powershell -ExecutionPolicy Bypass -File 修复dshPnpmStore.ps1
# 可选参数示例：
#   -Profile web -PluginDir O:/mcpFs/dsh-plugin-build/dsh-rules -DshHome G:\SOFTAI\deepseek-harness\Admin\.dsh
param(
  [string]$Profile   = 'web',
  [string]$PluginDir = 'O:/mcpFs/dsh-plugin-build/dsh-rules',
  [string]$DshHome   = 'G:\SOFTAI\deepseek-harness\Admin\.dsh',
  [switch]$SkipAddPlugin
)

$ErrorActionPreference = 'Stop'
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Fail($msg)  { Write-Host "!! $msg" -ForegroundColor Red; exit 1 }

$profileDir = Join-Path $DshHome (Join-Path 'profiles' $Profile)
Step "目标 profile 目录: $profileDir"
if (-not (Test-Path (Join-Path $profileDir 'package.json'))) {
  Fail "未找到 $profileDir\package.json，profile 未初始化。请先执行：dsh --profile $Profile --version（自动初始化）"
}

# 1) 修复 pnpm store：用当前 pnpm 重链接 node_modules。
#    --config.confirmModulesPurge=false：自动确认"移除并重装"（避免交互等待）
#    --config.dangerouslyAllowAllBuilds=true：放行 git 依赖等构建脚本（如 dsh-mcp-manager 的 prepare）
Step "修复 pnpm store（重链接 $Profile 依赖到当前 pnpm store）..."
Push-Location $profileDir
try {
  pnpm install --config.confirmModulesPurge=false --config.dangerouslyAllowAllBuilds=true
  if ($LASTEXITCODE -ne 0) { Fail "pnpm install 失败，退出码 $LASTEXITCODE。" }
} finally { Pop-Location }

if ($SkipAddPlugin) { Step "已跳过插件安装。完成。" ; exit 0 }

# 2) 安装 rulebase 到该 profile（以 link 方式，与 allMemory 一致）
Step "安装插件 rulebase 到 profile '$Profile' ..."
dsh plugin --profile $Profile add "link:$PluginDir"
if ($LASTEXITCODE -ne 0) { Fail "dsh plugin add 失败，退出码 $LASTEXITCODE。" }

# 3) 校验：确认 rulebase 进入 bundles 与依赖
$manifest = Get-Content (Join-Path $profileDir 'package.json') -Raw | ConvertFrom-Json
$inBundles = $manifest.dsh.profile.bundles -contains 'rulebase'
$inDeps    = $null -ne $manifest.dependencies.rulebase
Step "校验：bundles 含 rulebase=$inBundles  依赖含 rulebase=$inDeps"
if (-not ($inBundles -and $inDeps)) { Fail 'rulebase 未正确写入 profile 清单，请手动核查。' }

Step "完成。启动验证：dsh --profile $Profile"
Write-Host "启动后请检查：/plugins/rulebase/client.js 返回 200，且页面 __DSH_BOOT__ 含 \"id\":\"rulebase\"。" -ForegroundColor Yellow