# dsh-deai-style

DeepSeek Harness 的「去 AI 腔」插件。往系统提示里注入一份风格约束，再给模型一个 `deai_scan` 工具，
让它能检查自己刚写的东西有没有套上模板连接词、对偶反转句、加粗小标题列表、空洞夸饰和客服式结尾。

仓库：https://github.com/os60yryz/dsh-deai-style
当前版本：1.5.1

## 它解决什么

默认的书面语习惯——对齐训练加上高分回答模板——在人类日常交流里很少出现。密集出现时，读者几乎
立刻能感到「这是 AI 写的」。插件把一份黑名单和对应的正向要求作为同一层系统提示注入，并给出可量化
的自检手段。

规则库是 34 条正则规则加 12 个统计指标，分「用词 / 句法 / 语篇语用 / 格式 / 结构节奏」五类。
排版类证据只作观察信号，不参与定罪，理由见下方「能力边界」。

效果：6 题 × 3 轮共 36 个样本，模型 `deepseek-flash`，AI 腔均分 49.7 → 16.3（−67.2%）；第三轮
返工后重跑 33.4 → 9.1（−72.8%），6 道题全部从「中等 / 明显 AI 腔」降到「轻微 / 基本没有」。
另外做了一组提示词绕过测试：4 条明确要求「分点列表」的题，注入组产出 0 个 `- **小标题**：` 卡片行
（基线 29 个），均分 31.8 → 7.5。数据与判定见 [docs/验收报告.md](docs/验收报告.md)。

## 注册内容

| 类型 | 名称 | 位置 |
| --- | --- | --- |
| 系统提示 section | `deai:style` | `order = getSectionOrder("DEPLOYMENT_PERSONA_SUFFIX") + 1`（默认 10201，全提示词最末层） |
| 工具 | `deai_scan` | 全局工具注册表 |
| 命令行 | `deai` | `tools/deai.mjs`，不注册进宿主，有 `scan` 与 `fix` 两个子命令 |

## 安装

在 DeepSeek Harness 里装一次，重启宿主后生效：

```
plugin_manager action=install_bundle target="github:os60yryz/dsh-deai-style"
```

返回 `"application": "restart-required"` 表示入口已解析成功，需要完全退出桌面应用再打开，
关窗口不算。

宿主解析 `github:` 规格时可能连不上 github.com。这时改用仓库的压缩包地址，钉住 commit
反而更可复现：

```
plugin_manager action=install_bundle target="https://codeload.github.com/os60yryz/dsh-deai-style/tar.gz/<commit-sha>"
```

它同样是「从 GitHub 安装」，升级就换 `<commit-sha>`。pnpm 会按 `package.json` 的 `files`
白名单取文件，`docs/` 与 `tests/` 不会进 profile。

不要用插件目录（`link:`）安装。`link:` 是符号链接，Node 按真实路径解析模块，够不到宿主的
`node_modules`，加载时会报 `failed to import`。原因与排查过程见 [docs/验收报告.md](docs/验收报告.md) 第六节。

卸载：`plugin_manager action=remove_bundle target="dsh-deai-style"`。

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

`enabled:false` 或 `level:"off"` 时 `apply()` 直接返回，不注册 section、不注册工具，也就是
完全回到没装插件的样子。非法 `level` 回退为 `strict`，缺省 config 全部走默认值。

`strict` 规则段 893 字符，11 条核心约束加 7 条严格档，不含工具提示行；`soft` 592 字符，只有核心 11 条。

## 使用

直接在会话里说「扫一下」或「改一遍」，模型会调 `deai_scan` 打分（本地运行，不花钱），需要改写时
按输出策略重写再复扫。

命令行只打分，同样本地、不联网：

```powershell
node tools/deai.mjs scan draft.md            # 人读报告：分数、命中明细、排版体检
node tools/deai.mjs scan draft.md --json     # 原始 JSON，给脚本用
Get-Content draft.md -Raw | node tools/deai.mjs scan -   # 从管道读
```

命令行改写，调 `deepseek-flash`，需要 API key：

```powershell
$env:DEEPSEEK_API_KEY = "sk-..."
node tools/deai.mjs fix draft.md --out clean.md
```

改写指令取自 `lib/rewrite.js`，与 `tests/rewrite_eval.mjs` 共用同一份。超过 3000 字会自动按段落
切块分发，跑完在 stderr 打一行 `分数 A -> B`，正文写进 `--out` 指定的文件，不给 `--out` 就打 stdout。

## 评分

先按规则汇总权重（`sev × min(count, 2)`，重叠命中只算一次），再用饱和曲线转成分数：

```
k = 4.5 + 字符数 / 100
分数 = 100 × (1 − e^(−权重 / k))
```

权重为 0 时，只剩排版证据最多给 25 分观察分，节奏类指标最多再加 4 分。分档：≤15 基本没有 AI 腔，
≤35 轻微，≤60 中等，其余为明显。长度归一化写进 `k` 里，同一篇文章放大 20 倍分数不变。

## 能力边界

排版工整本身不是定罪证据。第二轮实测的排版权重里，AI 样本（纯列表 3.7 / 纯表格 4.0 / emoji 5.33）
与人类样本（干净清单 5.34 / 工作日志 4.0 / 会议纪要 2.0）完全重叠，所以「只有排版、没有任何语言套话」
的回答只会拿到 ≤25 分的观察分，不会进「中等 AI 腔」。

第三轮把这条原则落到了实现：五条 `cat:"fmt"` 的正则规则原先仍然直接计入定罪权重，两条 `**注意**：`
就能把 31 字的人写说明顶到 60 分；人类技术文档 1/2/3 条加粗标签分别是 29/47/61 分，说明书 2/4 条
是 52/75 分。现在它们与 `card-ratio` 一起只进 `formatWeight`，由 `checks.mjs` 的 14.1 断言锁死。
代价明确：纯排版的 AI 回答（`tests/corpus/ai_zh.json` 的 A4）属于刻意不定罪区，只给 25 分观察分，
因为人类说明书、产品简介、技术文档与它在结构上不可分。

修辞堆砌走的是另一条路——量到了上限。`rhetoric-pileup` 在 13 篇 2022 年前真人文章上最高 0%，
在 183 篇真人语料上最高 4.3%（多为「像…一样」的明喻，词表刻意不收），而用于标定的样例是 22%。
差 5 倍以上，中间没有重叠带，所以它进 `strong` 档，可以单独把一篇 3300 字的文章从 11 分推到 40 分。
这条规则同时有两个限制：整篇少于 12 句不做统计，命中少于 5 句不算。标定数据与逐篇命中见
[docs/reviews/rhetoric-calibration.md](docs/reviews/rhetoric-calibration.md)。

还有一条结构性限制：DSH 的 `agent/assistant-stream` 是只读事件，插件无法改写助手已经生成的文本。
它是提示加自检，不是强制过滤器。

## 测试

```powershell
pwsh -File tests/setup_dev_links.ps1     # 把宿主里的 peer 包链接进 node_modules，期望 SETUP PASS
node tests/checks.mjs                    # 结构、区分度、开关行为、标定、性能、红蓝军回归，期望 pass=177 fail=0
node tests/corpus.mjs                    # 21 条人工标注语料，期望 pass=21 fail=0
python tests/regression_deai_style.py    # 功能开关回归，期望 RESULT=PASS（35/35）
```

需要 API key 的效果验证：

```powershell
$env:DEEPSEEK_API_KEY = "sk-..."
node tests/ab_test.mjs --repeats 3       # 6 题 × 3 轮 × 2 组，期望 VERDICT=PASS
node tests/bypass_test.mjs               # 明令分点时是否守得住，期望 VERDICT=PASS（卡片行 29 → 0）
node tests/style_ab.mjs --set long --repeats 3   # 两组提示词对照，量排版密度
node tests/rewrite_eval.mjs path/to/my_messages.json --top 6   # 拿真实回复做改写评估
```

`checks.mjs` 覆盖结构、规则库自检、开关两套行为、`defineTool` 参数编译、工具 `execute` / `render`，
以及三轮红蓝军和外部校验的回归断言。`corpus.mjs` 用 12 条人写（≤30 分）与 9 条 AI 腔（≥40 分）
的人工标注语料打分，是独立于规则标定过程的外部标尺，用来发现「改规则把尺子也改了」。
`external_validate.mjs` 给任意目录下的文章打分并汇总，拿 2022 年前（ChatGPT 之前）的真人文章
检验误报。`style_ab.mjs` 与 `rewrite_eval.mjs` 用于验证「提示词路线」和「改写路线」各自是否有效，
结论记在 [docs/reviews/output-strategy.md](docs/reviews/output-strategy.md)。
`measure_plugin_cost.mjs` 量插件每次请求多花多少 token，结论是固定 872 token（提示段 542 + 工具
schema 330），折算进缓存后约占有效输入的 0.62%，见 [docs/reviews/plugin-cost.md](docs/reviews/plugin-cost.md)。

## 打包要求

`package.json` 必须包含 `"main"` 并导出 `"./package.json"`，否则宿主加载器读不到清单：

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

本包不声明 `dependencies`：`@deepseek-ai/schemastery` 与 `@deepseek-ai/dsh-tools` 由宿主提供，
不要在 profile 里手工写依赖。

## 文档

| 文件 | 内容 |
|---|---|
| [docs/AI语言范式分析.md](docs/AI语言范式分析.md) | 语言范式拆解：哪些写法是 AI 标签、为什么 |
| [docs/研究现状.md](docs/研究现状.md) | 外部研究综述 |
| [docs/标记总表.csv](docs/标记总表.csv) | 中英标记对照表 |
| [docs/验收报告.md](docs/验收报告.md) | 三轮验收的数据、判定与已知边界 |
| `docs/reviews/round1-red.md` | 第一轮红队攻击报告：12 条失守、14 条规则级缺陷、5 条设计级质疑 |
| `docs/reviews/round1-bug.md` | 第一轮代码级缺陷审计：7 条缺陷（含 O(n²) 正则与长文漏报） |
| `docs/reviews/round1-fix.md` | 第一轮的逐条处置、评分模型改动理由、刻意保留的边界 |
| `docs/reviews/round2-red.md` | 第二轮红队报告：12 条失守（5 误报 / 4 漏报 / 3 口径）+ 9 组未打穿 |
| `docs/reviews/round2-bug.md` | 第二轮代码级缺陷审计：7 类缺陷 + 测试可信度 |
| `docs/reviews/round2-fix.md` | 第二轮的逐条处置、为什么纯排版不能单独定罪 |
| `docs/reviews/round3-red.md` | 第三轮红队报告：11 条失守 + 7 组未打穿 |
| `docs/reviews/round3-bug.md` | 第三轮缺陷审计：11 条缺陷 + 17 组变异测试 |
| `docs/reviews/round3-fix.md` | 第三轮的逐条处置、文档与实现不一致的根因 |
| `docs/reviews/external-validation.md` | 外部校验：15 篇 2022 年前真人文章 0 篇越线，两处误报已修 |
| `docs/reviews/output-strategy.md` | 生成侧的优化：提示词路线被否的三轮实验、定稿的改写策略与收敛判据 |
| `docs/reviews/rhetoric-calibration.md` | 修辞堆砌的标定：真人语料上限 4.3%，样例 22%，所以允许单独定罪 |
| `docs/reviews/plugin-cost.md` | 插件固定开销的实测与折算 |

## 已知问题

检测器给出的分数是风格强度，不是作者身份。一个爱写拟人科普的真人作者同样会被 `rhetoric-pileup`
打中，这是刻意的：它判的是这段文字读起来像不像 AI 写的。

仍然存在的盲区：单条正则没有一条是 AI 独有的，有效性依赖密度归一化与多类证据叠加，所以单个命中
不能当作证据；跨段落的论证结构、观点是否真的成立，这套规则一样看不见。
