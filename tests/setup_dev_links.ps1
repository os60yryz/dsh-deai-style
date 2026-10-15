# dsh-deai-style 开发期模块解析垫片（可重复运行，幂等）
#
# 背景：插件 index.js 里 `import z from "@deepseek-ai/schemastery"`。
# 装在 DSH profile 里时（~/.dsh/profiles/<p>/node_modules/）能向上解析到这些包；
# 但在工作区源码目录里直接 `node tests/checks.mjs` 会 ERR_MODULE_NOT_FOUND。
# 本脚本在插件目录建 node_modules/@deepseek-ai 的目录联接（Junction）指到 profile 的
# 同名目录，使本地单测与真实运行时使用同一份依赖。node_modules 不会被 pnpm pack 打进
# tarball（package.json 的 files 白名单同样排除了它），因此交付物不受影响。
#
# 用法：pwsh -File tests\setup_dev_links.ps1
$ErrorActionPreference = 'Stop'

$pkgRoot = Split-Path -Parent $PSScriptRoot
$target = 'C:\Users\zhenz\.dsh\profiles\node_modules\@deepseek-ai'
if (-not (Test-Path -LiteralPath $target)) {
    throw "profile 的 @deepseek-ai 目录不存在：$target（先确认 DSH profile 已安装依赖）"
}

$nm = Join-Path $pkgRoot 'node_modules'
if (-not (Test-Path -LiteralPath $nm)) {
    New-Item -ItemType Directory -Path $nm | Out-Null
    Write-Host "created $nm"
}

$link = Join-Path $nm '@deepseek-ai'
if (Test-Path -LiteralPath $link) {
    $item = Get-Item -LiteralPath $link -Force
    Write-Host "exists $link -> $($item.Target)"
} else {
    New-Item -ItemType Junction -Path $link -Target $target | Out-Null
    Write-Host "linked $link -> $target"
}

# 解析自检：能否找到 schemastery 与 dsh-tools
foreach ($name in @('@deepseek-ai/schemastery', '@deepseek-ai/dsh-tools')) {
    $probe = Join-Path $link ($name.Split('/')[-1])
    if (Test-Path -LiteralPath $probe) {
        Write-Host "OK   $name"
    } else {
        Write-Host "MISS $name"
        exit 1
    }
}
Write-Host 'SETUP PASS'
