# dsh-deai-style

DeepSeek Harness 的「去 AI 腔」插件。往系统提示里注入一份风格约束，再给模型一个本地运行的 `deai_scan`
工具，让它能检查自己写的东西有没有套上模板连接词、对偶反转句、加粗小标题列表、空洞夸饰和客服式结尾。

仓库：https://github.com/os60yryz/dsh-deai-style ｜ 版本：1.5.1

## 内容

插件注册三样东西：系统提示段 `deai:style`（默认挂在 persona 之后、全提示词最末层 order 10201）、
全局工具 `deai_scan`、命令行 `deai`（`tools/deai.mjs`，不注册进宿主）。规则库是 34 条正则规则加
12 个统计指标，分用词、句法、语篇语用、格式、结构节奏五类。排版类证据只作观察，不参与定罪。

实测：6 题 × 3 轮共 36 个样本，`deepseek-flash`，AI 腔均分 49.7 → 16.3；第三轮返工后重跑
33.4 → 9.1，6 道题全部落到「轻微」以下。另有 4 条明令分点的题，注入组卡片行 29 → 0。

## 安装

```
plugin_manager action=install_bundle target="github:os60yryz/dsh-deai-style"
```

返回 `restart-required` 表示入口已解析成功，需要完全退出桌面应用再打开，关窗口不算。连不上
github.com 时改用钉 commit 的压缩包地址，升级就换 SHA：

```
plugin_manager action=install_bundle target="https://codeload.github.com/os60yryz/dsh-deai-style/tar.gz/<commit-sha>"
```

不要用插件目录（`link:`）安装。`link:` 是符号链接，Node 按真实路径解析模块，够不到宿主的
`node_modules`，加载时会报 `failed to import`。卸载用 `remove_bundle`。

## 配置

```yaml
- insert:
    - id: deai-style
      name: dsh-deai-style
      config:
        enabled: true        # 总开关，false = 完全回到旧行为
        level: strict        # off | soft | strict（off 等价于 enabled:false）
        position: bottom     # bottom=末尾层(10201) | top=persona 前缀之后(1)
        injectLintTool: true # 是否注册 deai_scan
        extraRules: ""       # 追加到提示词末尾的自定义要求
```

`enabled:false` 或 `level:"off"` 时 `apply()` 直接返回，不注册 section、不注册工具，等于没装。
非法 `level` 回退为 `strict`。`strict` 规则段 893 字符（11 条核心 + 7 条严格档），`soft` 592 字符。

## 使用

会话里说「扫一下」或「改一遍」，模型会调 `deai_scan`。命令行只打分，本地运行、不联网：

```powershell
node tools/deai.mjs scan draft.md            # 分数、命中明细、排版体检
node tools/deai.mjs scan draft.md --json     # 原始 JSON
Get-Content draft.md -Raw | node tools/deai.mjs scan -
```

命令行改写调 `deepseek-flash`，需要 API key；超过 3000 字自动按段落切块，stderr 打一行 `分数 A -> B`：

```powershell
$env:DEEPSEEK_API_KEY = "sk-..."
node tools/deai.mjs fix draft.md --out clean.md
```

## 评分

先按 `sev × min(count, 2)` 汇总权重（重叠命中只算一次），再用饱和曲线转分数：

```
k = 4.5 + 字符数 / 100
分数 = 100 × (1 − e^(−权重 / k))
```

权重为 0 时，排版证据最多给 25 分观察分，节奏类指标最多再加 4 分。分档：≤15 基本没有 AI 腔，
≤35 轻微，≤60 中等，其余明显。长度归一化写在 `k` 里，同一篇文章放大 20 倍分数不变。

## 边界

排版工整不定罪。AI 样本的排版权重（纯列表 3.7、纯表格 4.0、emoji 5.33）与人类样本（干净清单 5.34、
工作日志 4.0、会议纪要 2.0）完全重叠，所以「只有排版、没有语言套话」的回答只拿观察分，进不了中等档。
代价是纯排版的 AI 回答属于刻意不定罪区，人类说明书与技术文档在结构上确实与它不可分。

修辞堆砌是唯一能单独定罪的结构指标。13 篇 2022 年前真人文章上最高 0%，183 篇真人语料上最高 4.3%，
标定样例 22%，中间没有重叠带。

插件不改写已经生成的文本：DSH 的 `agent/assistant-stream` 是只读事件。它是提示加自检，不是强制过滤器。

分数是风格强度，不是作者身份。单条正则没有一条是 AI 独有的，有效性依赖密度归一化与多类证据叠加，
单个命中不能当证据；跨段落的论证结构、观点是否成立，这套规则看不见。

## 测试

```powershell
pwsh -File tests/setup_dev_links.ps1     # 链接宿主 peer 包，期望 SETUP PASS
node tests/checks.mjs                    # 期望 pass=177 fail=0
node tests/corpus.mjs                    # 期望 pass=21 fail=0
python tests/regression_deai_style.py    # 期望 RESULT=PASS（35/35）
```

需要 API key 的效果验证：`ab_test.mjs --repeats 3`（A/B）、`bypass_test.mjs`（明令分点）、
`style_ab.mjs --set long`（提示词对照）、`rewrite_eval.mjs <json>`（改写评估），均以 `VERDICT=PASS` 为过。
`external_validate.mjs` 用来给任意目录的真人文章打分查误报。

## 开发须知

`package.json` 必须包含 `"main"` 并导出 `"./package.json"`，否则宿主加载器读不到清单。本包不声明
`dependencies`：`@deepseek-ai/schemastery` 与 `@deepseek-ai/dsh-tools` 由宿主提供。

```json
{
  "main": "index.js",
  "exports": {
    ".": "./index.js",
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

## 文档

`docs/` 下是范式分析、外部研究综述、标记总表与验收报告。`docs/reviews/` 存三轮红蓝军报告（每轮含
红队攻击、代码缺陷审计、返工处置）以及外部校验、改写策略、修辞标定、插件成本四份专题记录。
