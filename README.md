# dsh-deai-style（DeepSeek 专属「去 AI 风格」插件）

仓库：https://github.com/os60yryz/dsh-deai-style

把「去 AI 腔」风格约束注入系统提示，并提供一个 `deai_scan` 打分工具，让模型能检查自己刚写的回答
是不是又套上了模板连接词、对偶反转句、加粗小标题列表、空洞夸饰和客服式结尾。

- 本机实测（6 题 × 3 轮 = 36 样本，`deepseek-flash`）：AI 腔平均分 **49.7 → 16.3（−67.2%）**；
  第三轮返工后重跑为 **33.4 → 9.1（−72.8%）**，6 道题全部从「中等/明显 AI 腔」降到「轻微/基本没有」。
  另有一项**提示词绕过测试**：4 条明确要求「分点列表」的题，注入组产出 **0** 个
  `- **小标题**：` 卡片行（基线 29 个），均分 31.8 → 7.5。数据与判定见
  [docs/验收报告.md](docs/验收报告.md)。
- 规则库规模：**32 条正则规则 + 11 个统计指标**，分「用词／句法／语篇语用／格式／结构节奏」五类。
  其中**排版类证据只作观察信号（上限 25 分），不参与定罪**——三轮红蓝军实测表明人类技术文档、
  说明书、周报的加粗标签密度与 AI 回答完全重叠（见下方「能力边界」）。

## 它解决什么

详见 [docs/AI语言范式分析.md](docs/AI语言范式分析.md)。一句话：默认的书面语习惯（对齐训练 + 高分回答模板）
在人类日常交流里极少出现，密集出现时读者会立刻感到「这是 AI 写的」。本插件把这份「黑名单 + 正向要求」
作为同一层系统提示注入，并给出可量化的自检手段。

外部研究综述见 [docs/研究现状.md](docs/研究现状.md)，中英标记对照见 [docs/标记总表.csv](docs/标记总表.csv)。

## 注册内容

| 类型 | 名称 | 位置 |
| --- | --- | --- |
| 系统提示 section | `deai:style` | `order = getSectionOrder("DEPLOYMENT_PERSONA_SUFFIX") + 1`（默认 10201，即全提示词最末层） |
| 工具 | `deai_scan` | 全局工具注册表 |

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

- **关（`enabled:false` 或 `level:"off"`）= 旧行为**：`apply()` 直接返回，不注册 section、不注册工具。
- 非法 `level` 回退为 `strict`；缺省 config 全部走默认值。
- `strict` 规则段 802 字符（11 条核心 + 5 条严格档，不含工具提示行）；`soft` 612 字符（仅核心 11 条）。

## 安装

装进 DSH profile，首选直接从 GitHub 拉：

```
plugin_manager action=install_bundle target="github:os60yryz/dsh-deai-style"
```

pnpm 会以 codeload 上的仓库 tarball 解出一份**真实目录**。返回 `"application":"restart-required"`
表示入口已解析成功，**重启宿主**（完全退出 DSH 桌面应用再打开，不是关窗口）后生效。

本地改动想立刻装，用 tarball，效果等价（同样是真实目录）：

```powershell
cd <本仓库>
pnpm pack --pack-destination .\tmp          # tmp/ 已在 .gitignore
```
```
plugin_manager action=install_bundle target="<本仓库>\tmp\dsh-deai-style-1.2.0.tgz"
```

- 卸载：`plugin_manager action=remove_bundle target="dsh-deai-style"`，重启后生效。
- 本机目标 profile 是 **desktop**（Electron 应用独占管理，`dsh --profile desktop --dump-config` 不可用）。

### 当 `github:` 安装报连接超时

`install_bundle` 在解析 `github:` 规格前会先做一次 **5 秒**的 `github.com` 连通性探测。本机网络下
`github.com` 的 HTTPS 经常连不上（实测 20 秒超时），而 `codeload.github.com` 正常（约 4 秒），
于是 `github:` 规格会稳定报 `dsh: connection to github.com timed out after 5000ms`（`failedAt: spec-host`），
**即使 `git push` / `git ls-remote` 能正常工作**。此时改用 codeload 的固定 commit 压缩包地址即可：

```
plugin_manager action=install_bundle target="https://codeload.github.com/os60yryz/dsh-deai-style/tar.gz/<commit-sha>"
```

它同样是「从 GitHub 安装」，而且因为钉住 commit 反而更可复现；要升级就换 `<commit-sha>`。
pnpm 仍会尊重 `package.json` 的 `files` 白名单，`docs/` 与 `tests/` 不会进 profile。

### 不要用插件目录（`link:`）安装

实测以目录安装时宿主报 `deai-style (dsh-deai-style): failed to import`、`application = failed`：
`link:` 是符号链接，Node 按真实路径解析模块，够不到 profile 的 `node_modules`。原因与修复过程见
[docs/验收报告.md](docs/验收报告.md) 第六节。

### 打包前的必备字段（踩过的坑）

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

> 本包不声明 `dependencies`：`@deepseek-ai/schemastery` 与 `@deepseek-ai/dsh-tools` 由
> `~/.dsh/profiles/node_modules/@deepseek-ai/*`（junction）解析，禁止在 profile 里手工写依赖。

## 验证

新克隆后先跑一次垫片脚本，把 `node_modules/@deepseek-ai` 链接到本机 profile 的同名目录
（`node_modules` 不入库，`files` 白名单也把它排除在包外）：

```powershell
cd <本仓库>
pwsh -File tests\setup_dev_links.ps1     # 期望 SETUP PASS
node tests\checks.mjs                    # 结构 + 区分度 + 开关行为 + 标定回归 + 长度/性能 + 三轮红蓝军回归 + 外部校验回归，期望 TOTAL pass=167 fail=0
node tests\corpus.mjs                    # 20 条标注语料（12 人写 ≤30 分 + 8 AI 腔 ≥40 分），期望 CORPUS pass=20 fail=0
python tests\regression_deai_style.py    # 功能开关回归，期望 RESULT=PASS (35/35)

# 效果验证（需要 DEEPSEEK_API_KEY，见 AGENTS.md §28 凭据注入）
$env:DEEPSEEK_API_KEY = [Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY','User')
node tests\ab_test.mjs --repeats 3       # 6 题 × 3 轮 × 2 组，期望 VERDICT=PASS（v1.3.0 实测 −72.8%）
node tests\bypass_test.mjs              # 用户明令「分点列表」时是否守得住，期望 VERDICT=PASS（实测卡片行 29 → 0）
node tests\style_ab.mjs --set long --repeats 3   # 两组提示词的对照实验（量的是排版密度，不是分数）
node tests\rewrite_eval.mjs D:\path\my_messages.json --top 6   # 拿真实回复做改写评估，期望 VERDICT=PASS
```

- `checks.mjs`：语法、无 BOM/LF、清单结构、规则库自检、检测器区分度（AI 样例 ≥70、人写样例 ≤20）、
  开/关两套断言、`defineTool` 参数编译、工具 `execute`/`render`，**标定回归**（强/弱反转变体分离、
  `explainer-frame` 命中、科普腔不再漏报），**长度与性能**（同一 AI 样例 ×1/×2/×5/×20 均 ≥70 分且极差 ≤15、
  10 万换行在 800ms 内完成、未闭合围栏被剥离、表格不再被删空），以及**第二轮红蓝军回归** 21 项
  （`service-close` 裸「有」、纯排版受限出口、emoji 键帽与国旗、四反引号/`~~~` 围栏、半角键值对、
  零宽字符规避、黑话去重、重叠命中只算一次、opening 作用域不受前置换行影响、`analyzed` 字段、
  报告自洽，以及用断言锁住三条「刻意不定罪」的排版边界），以及**第三轮红蓝军回归** 28 项
  （排版证据必须全部标 `evidence:"format"`、规则/指标数量门禁、`formatNudge` 阈值与封顶、
  节奏加成上限、`k` 的长度归一化、9 字强信号稿的 `analyzed`、CRLF 表格、引用块围栏、
  四空格缩进代码、跨行行内代码、抽象名词复读只计一次、卡片禁令进核心档），以及**外部校验回归** 4 项
  （自问自答不得跨行、`enumerate-all` 不得拿「等等」定罪）。
- `external_validate.mjs`：给任意目录下的文章打分并汇总，用来做**外部标尺**——拿 2022 年前（ChatGPT
  之前）的真人文章检验误报，见 [docs/reviews/external-validation.md](docs/reviews/external-validation.md)。
- `score_my_output.mjs`：给会话记录里助手写过的正文打分，用来检查**我自己**的输出。
- `style_ab.mjs`：两组提示词的对照实验，指标取自 `lint().layout`（箭头密度、加粗密度、行首加粗标签、
  卡片行、偏密标记）。三轮实测结论是**往提示词里加文风规则量不出稳定效果**，记在
  [docs/reviews/output-strategy.md](docs/reviews/output-strategy.md)。
- `rewrite_eval.mjs`：拿真实回复当输入，让模型按一份改写策略重写，再量前后差。12 条实测排版指标被打平
  （箭头 51→1、行首加粗标签 24→0、偏密样本 12/12→0/12），是这份输出策略唯一的正面证据。
- `corpus.mjs`：`tests/corpus/{human_zh,ai_zh}.json` 里 20 条人工标注语料，只用 `lib/lint.js` 打分并比对
  各自的 `max`/`min` 阈值。它是独立于规则标定过程的外部标尺，用来发现「改规则把尺子也改了」。
- `regression_deai_style.py`：A–G 七组 35 项断言，含「关 = 旧行为」与边界（非法 level、`injectLintTool:false`）。
- `measure_plugin_cost.mjs`：量插件每次请求多花多少 token（对照前缀 + `usage.prompt_tokens`），
  以及工具调用一次的往返开销。结论：固定 872 token/请求（段 542 + 工具 schema 330），
  折算进缓存后约占有效输入的 0.62%，见 [docs/reviews/plugin-cost.md](docs/reviews/plugin-cost.md)。
- `ab_test.mjs`：6 题 × N 轮 × 两组，输出 `ab_result.json` 与逐条对照，并按验收口径（平均分下降 ≥50%、
  基线 ≥35 分的题目全部 <35、**逐样本达标率 ≥80%**）自动打印 `VERDICT=PASS|FAIL`。可用 `--min-drop-pct` /
  `--target` / `--high-bar` 调整。

## 红蓝军审查记录

`docs/reviews/` 保存了三轮「质疑—优化—测试」的原始报告与返工记录：

| 文件 | 内容 |
|---|---|
| `round1-red.md` | 第一轮红队攻击报告：12 条失守、14 条规则级缺陷、5 条设计级质疑 |
| `round1-bug.md` | 第一轮代码级缺陷审计：7 条缺陷（含 O(n²) 正则与长文漏报） |
| `round1-fix.md` | 第一轮的逐条处置、评分模型改动理由、刻意保留的边界 |
| `round2-red.md` | 第二轮红队报告：12 条失守（5 误报 / 4 漏报 / 3 口径）+ 9 组未打穿 |
| `round2-bug.md` | 第二轮代码级缺陷审计：7 类缺陷 + 测试可信度（断言对分数不敏感） |
| `round2-fix.md` | 第二轮的逐条处置、**为什么「纯排版」不能单独定罪**（含 AI/人类排版权重重叠数据） |
| `round3-red.md` | 第三轮红队报告：11 条失守（3 误报 / 3 漏报 / 4 口径 / 1 测试可信度）+ 7 组未打穿 |
| `round3-bug.md` | 第三轮缺陷审计：11 条缺陷（高 2）+ 17 组变异测试（7 条零覆盖路径） |
| `round3-fix.md` | 第三轮的逐条处置、文档与实现不一致的根因、**排版证据全面降为观察档**的决定与代价 |
| `external-validation.md` | 外部校验：15 篇 2022 年前真人文章 0 篇越线；两处误报已修；**我自己的输出排版层面仍很 AI** |
| `output-strategy.md` | 针对「我自己怎么写」的优化：64 条自有正文的体检、提示词路线被否的三轮实验、定稿的七条改写策略与收敛判据 |

探针脚本已入库：`tests/red1/`、`tests/bug1/`、`tests/red2/`、`tests/bug2/`；
变异测试台在 `tmp/mut3/run_mutations.py`（8 组变异，全部被断言杀死）。

### 一条重要的能力边界

**排版工整本身不是定罪证据。** 第二轮实测的排版权重里，AI 样本（纯列表 3.7 / 纯表格 4.0 / emoji 5.33）
与人类样本（干净清单 5.34 / 工作日志 4.0 / 会议纪要 2.0）完全重叠，所以「只有排版、没有任何语言套话」的回答
只会得到一个 ≤25 分的观察分，不会进「中等 AI 腔」。

第三轮把这条原则落到了实现：`cat:"fmt"` 的五条正则规则（`bold-label-line`、`bold-start-line`、
`bold-heading`、`bold-inline-label`、`arrow-symbol`）原先**仍然直接计入定罪权重**——两条 `**注意**：`
就能把 31 字人写说明顶到 60 分，人类技术文档 1/2/3 条加粗标签 = 29/47/61 分、说明书 2/4 条 = 52/75 分。
现在它们与 `card-ratio`（「整篇几乎只剩卡片行」）一起只进 `formatWeight`，由 `checks.mjs` 的
14.1 断言锁死。代价明确：**纯排版的 AI 回答（如 `tests/corpus/ai_zh.json` 的 A4）属于刻意不定罪区，
只给 25 分观察分**——因为人类说明书、产品简介、技术文档与它在结构上不可分。

同理，DSH 的 `agent/assistant-stream` 是只读事件，插件**无法**改写助手已生成的文本——它是提示 + 自检，不是强制过滤器。

已知边界与未解决问题汇总在 `docs/验收报告.md` 第八、九、十一节。

> ⚠️ 请勿对插件目录执行 `Get-ChildItem -Recurse`：开发用的 `node_modules\@deepseek-ai` 是 junction，
> 其内部 `cordis → cordis-plugin-include → cordis` 会形成无限深的目录链（已两次因此卡住命令）。
