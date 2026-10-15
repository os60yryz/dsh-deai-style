# dsh-deai-style v1.2.0 第三轮代码级缺陷审计（独立审计方）

- 仓库：`D:\GitRepos\dsh-deai-style.git`，package.json `version: "1.2.0"`
- 版本指纹（SHA256 前 16 位）：`lib/ruleset.js` = `AAF52F9F1F07DDF7`，`lib/lint.js` = `4FB9B3A87C8219D7`
- 审计时间：2026-10-15　审计方：第三轮（代码缺陷 + 测试可信度 + 变异测试）
- 实验室产物：`tmp/bug3/`（`probe1.mjs`/`probe2.mjs`/`probe3.mjs` + 输出、`measure.mjs`、`setup_mut.py`、`mut2.py`、`mut_result.json`、`mut2_result.json`）
- 全程未修改 `lib/`、`index.js`、`tests/`、`package.json`、`README.md` 与 `docs/` 现有文件
- 基线（本轮实测）：`node tests/checks.mjs` = `TOTAL pass=126 fail=0`；`node tests/corpus.mjs` = `CORPUS pass=20 fail=0 total=20`；`python tests/regression_deai_style.py` = `TOTAL 35 assertions, 35 PASS, 0 FAIL`

---

## 一、结论速览

缺陷 **11 条**：高 2（H1/H2）、中 4（M1–M4）、低 5（L1–L5）。无崩溃类缺陷；未发现性能回退与内存异常。

第三轮的核心结论：第二轮 12 处改动里，行为层面 8 处真修好（条目 1/3/5/6/8/10/11/12），2 处部分修好（条目 4 围栏、条目 7 scope 行为修好但测试零覆盖），1 处只修了一半并制造出同页自相矛盾的报告（条目 9 → H1）。**更要紧的是 7 条修复路径在 126 条断言与 20 条语料上零覆盖**：把它们逐个改回 v1.1.0 的旧写法，`checks.mjs` 与 `corpus.mjs` 依然全绿（见第三节）。

最严重两条：

1. **H1** `lint("希望对你有帮助。")` → `score=48 / band=medium / analyzed=false`，报告首行打印「48/100（无正文可评）｜正文 8 字，命中片段 1 处（加权 3）」，紧接着写「没有可分析的正文」，**命中明细与改写建议整节消失**。恰好在信号最强的短稿上丢掉工具 description 承诺的两样东西。
2. **H2** v1.2.0 新引入的评分机制（`formatNudge` 的阈值 5 与封顶 25、`metricBonus` 的 `ruleWeight === 0` 门与上限 4、`k` 的长度项、scope 的 `text.length` 坐标）全部零覆盖，7 组变异 0 杀。

---

## 二、逐条缺陷

### H1（高｜正确性·报告）1–9 字的强命中稿被判「无正文可评」，命中明细与改写建议一起丢

- 位置：`lib/lint.js:266`（`analyzed: m.chars >= 10,`）→ `lib/lint.js:310`（读 `r.analyzed`）、`lib/lint.js:313`（首行模板把 `analyzed=false` 渲染成「无正文可评」）、`lib/lint.js:315-318`（`if (!analyzed)` 提前 `return`，丢掉 hits 与 suggestions 两节）
- 复现：`node tmp\bug3\measure.mjs`
- 实测：

| 输入 | chars | score | band | analyzed | 报告里有没有「命中明细/改写建议」 |
| --- | --- | --- | --- | --- | --- |
| `希望对你有帮助。` | 8 | 48 | medium | **false** | 都没有（`shortReportHasHits=false`、`shortReportHasSuggest=false`） |
| `希望对你有帮助` | 7 | 48 | medium | false | 都没有 |
| `感谢你的提问` | 6 | 48 | medium | false | 都没有 |
| `综上所述。` | 5 | 20 | clean | false | 都没有 |
| 同一文本 + 5 字填充 | 13 | 48 | medium | true | 都有 |

`measure.mjs` 输出的完整报告只有两段：

```
AI 腔评分：48/100（无正文可评）｜正文 8 字，命中片段 1 处（加权 3），规则密度 10/千字

没有可分析的正文（整段是代码块、空白或非文本），本次评分不代表文风。
```

- 影响：`index.js:24-27` 的 description 承诺「0-100 的 AI 腔评分、命中明细与改写建议」，而「希望对你有帮助」正是该 description 与注入提示点名的原句。模型拿这个报告自检短稿时，看到的是「无正文可评」，会认为自己没写错——比第二轮 N1 的「0 分 = 看起来干净」更危险，因为这次连分数都是中档。短稿恰恰是客服式结尾、开场感谢最密集的场景。
- 旁证：`tests/checks.mjs:313` / `:314` 只断言 `lint("希望对你有帮助。").score > 0`，对 `analyzed`、`bandLabel`、命中节、建议节一条都没有断言，所以这条路径全绿。
- 建议修法：`analyzed` 只在「`stripCode` 后确实没有可评文本」时为 false（即 `m.chars === 0` 或 `stripCode` 结果去空白后为空），不要用 10 字门槛；`renderReport` 在 `analyzed === false` 时也要么照常输出 hits/suggestions，要么把首行分数换成「不评分」并显式说明「文本过短，仅供观察」，别让「48/100（无正文可评）」这种一句里自打嘴巴的措辞出现。

### M1（中｜口径）`analyzed` 阈值 10 与 `chars` 口径都没有断言，且口径含标点

- 位置：`lib/lint.js:266`；`chars` 定义在 `lib/lint.js:58`（`text.replace(/\s/g, "")`）
- 复现：`node tmp\bug3\measure.mjs`（`analyzedByChars`）
- 实测：chars 8 → false、9 → false、10 → true、11 → true；`chars` 含标点，「。，、！？」= 5、「汉字」= 2。也就是 10 个纯标点会被判「有正文」，而 9 个汉字加一处强指纹规则会被判「无正文」。
- 变异实测：把 `>= 10` 改成 `>= 50` 只杀死 1 条断言（`tests/checks.mjs`「干净中文稿报告写明未命中」），10 到 50 之间没有任何断言钉住；反向（恒 true）杀死 3 条。
- 影响：阈值可自由漂移而不报警；报告里「正文 N 字」的口径也不是中文「字」，调用方按字数理解会偏差。
- 建议修法：阈值改成 `stripCode` 空判定（与 H1 合并），并在报告里写「去空白字符数」而不是「字」。

### M2（中｜文档漂移）README 的规则库规模与代码差 2/4 条，且没有门禁

- 位置：`README.md:11`（「**34 条正则规则 + 6 个统计指标**」）vs `lib/ruleset.js` 实际导出
- 复现：`node tmp\bug3\measure.mjs` → `RULES.length = 32`、`METRICS.length = 10`（`METRICS` 里 `evidence: "format"` 7 条、`"rhythm"` 3 条）
- 影响：这条数字同时出现在 README 的开篇卖点里；`tests/checks.mjs:32` 只断言 `RULES.length >= 25`、`:51` 只断言 METRICS 结构齐全，所以数量漂移永远不会被发现。
- 建议修法：README 改成 32 + 10，或把断言升级成精确值（`=== 32` / `=== 10`）并在 README 里只引用一处。

### M3（中｜死字段，第二轮 N6 未处置）`METRICS[].threshold` 10 个字段仍无人读

- 位置：`lib/ruleset.js:273/282/291/300/309/318/327/340/349/359`
- 复现：`grep -n threshold lib/*.js`（ripgrep）→ 命中全部落在 `ruleset.js`，其中 `:366-369` 是 `scale(ratio, threshold, cap)` 的形参；`lib/lint.js` 全文没有 `threshold`
- 影响：改这 10 个数字不改变任何行为，制造「阈值调过」的假象；第二轮已记为 N6，本轮复测仍在。
- 建议修法：让 `measure()` 用 `metric.threshold`（或让 `lint` 把 `m.threshold` 传给 measure），否则删字段并注明常量位置。

### M4（中｜证据）`round2-fix.md` 的四反引号修复数字自相矛盾

- 位置：`docs/reviews/round2-fix.md:28`
- 原文：「四反引号样本 65 → **58**（代码不再计分）」——58 分是「中等 AI 腔」，与「不再计分」冲突；同一行 `~~~` 样本记的是 `57 → 0`。
- 影响：该样本未入库（`tests/` 里没有对应 fixture），无法复跑核对；修好与否只能靠断言 `tests/checks.mjs:327`（`stripCode` 层面，确实通过）。这条属于报告可信度问题，不是代码缺陷。
- 建议修法：把该样本收进 `tests/corpus/` 或 probe 脚本，附上前后分数；把 58 的来源（是否残留正文）写清。

### L1（低｜契约）`bandOf` 对非有限数的口径与 `renderReport` 相反（第二轮 N7 未处置）

- 位置：`lib/lint.js:11-12`（`BANDS.find((b) => score <= b.max)`）
- 实测（`tmp/bug3/probe2.out.txt`）：`bandOf(NaN)` → `heavy`、`bandOf(Infinity)` → `heavy`、`bandOf(-Infinity)` → `clean`、`bandOf(-1)` → `clean`；而 `renderReport` 把非有限数归 0（`lib/lint.js:306` 的 `Math.round(NaN)` 经 `Math.min/max` 得 0）。
- 影响：`lint()` 内部 score 恒在 0–100，只影响直接调 `bandOf` 的消费者。
- 建议修法：`bandOf` 开头 `if (!Number.isFinite(score)) return BANDS[0]`，与 renderReport 对齐。

### L2（低｜文档措辞）`maxSuggestions` 的钳位方向与文档描述不符

- 位置：`lib/lint.js:251-252`
- 复现：`node tmp\bug3\probe2.mjs`（`maxSuggestions` 段）
- 实测：`undefined`/`null`/`NaN`/`"3"`/`1e9`/`0`/`-0`/`Infinity`/`true`/`[]`/`{}` → 6（受可用建议数限制实际 4 条）；`3.7` → 3；**`-1` → 1、`-3.5` → 1**。`docs/reviews/round2-fix.md:32` 写的是「非法/非正数退回默认值，并钳到 `[1, 50]`」——`-1` 走的是钳位不是默认值，`0` 与 `-1` 因此走向不同（0 → 6 条，-1 → 1 条）。
- 影响：行为本身已修好（不会再出现 0 条建议，`tests/checks.mjs:309` 有下界断言），只是文档措辞与实现不一致。
- 建议修法：文档改「非有限值退回默认 6；其余按 `Math.max(1, min(50, trunc))` 钳位」，或让 `0`/负数统一走默认值。

### L3（低｜健壮性）`stripCode` 仍有 3 种形态不剥离，CRLF 让表格比例失效

- 位置：`lib/lint.js:36-55`（围栏只认 `^[ \t]*(`{3,}|~{3,})`）、`lib/lint.js:15`（`TABLE_RE` 无 `m` 标志，逐行 `test`）
- 复现：`node tmp\bug3\probe1.mjs`
- 实测（残留 = 未剥离的代码/正文）：

| 形态 | 期望 | 实测 |
| --- | --- | --- |
| 引用块围栏 `> ```\n> 综上所述\n> ``` ` | 剥离 | **不剥离**，残留 `>  ```\n> 综上所述\n>  ``` `（三反引号被行内代码正则吃成两处单反引号） |
| 跨行行内代码 `` 前`code\nmore`后 `` | 剥离 | **不剥离**，原样返回 |
| 4 空格缩进代码块（无围栏） | 剥离或降权 | 不剥离（与第二轮结论一致，可接受） |
| 同一张 3 行 Markdown 表格（LF） | `tableLines=3`、`metricWeight=4` | 正确 |
| 同一张表（CRLF） | 同上 | `tableLines=1`、`metricWeight=1.34`——中间行带 `\r`，`[ \t]*$` 不匹配 |

- 影响：`> ``` ` 与跨行行内代码会让代码正文进入散文计分（第二轮 N3 的同类问题只修了 `~~~` 与四反引号）；CRLF 稿件（Windows 复制粘贴的常见形态）表格比例被低估约 2/3，纯表格样本可能因此掉到 `formatNudge` 阈值 5 以下而完全不计分。
- 建议修法：围栏前缀允许 `[ \t]*(> ?)*`；行内代码允许跨行（或先按行剥离再对残留做一次 `` /[^`]*/ `` 全局清理）；`TABLE_RE` 改成 `^[ \t]*\|.*\|[ \t]*\r?$` 或在入口统一 `\r\n` → `\n`。

### L4（低｜未处置的第二轮项）N9/N10/N11 原样存在

- `lib/plan.js:10/13`（`enabled: c.enabled !== false`）：`normalizeConfig({ enabled: 0 }).enabled === true`（第二轮 N9）
- `lib/plan.js:22-26/34`：`planRegistrations({}, undefined)` 抛 `TypeError`；`getSectionOrder` 返回 `NaN` 时 order 静默变 `NaN`（第二轮 N10）
- `index.js:39-44`：`output.schema` 仍是 `{ type: "object", additionalProperties: true }` 空壳，没有声明 `score/band/chars/hits/suggestions`（第二轮 N11）
- 影响：宿主路径有 `z.boolean()` 与 schema 挡着，直接调用 `lib/` 的消费者没有防护；输出契约缺失。
- 建议修法：`Boolean(c.enabled ?? true)`（或同时接受 `0`/`"false"`）；`planRegistrations` 加 `Number.isFinite` 守卫并回退固定 order；把 `lint()` 的返回结构写进 `output.schema`。

### L5（低｜误报面）零宽归一化把 ZWJ 家族 emoji 计成 4 个字符

- 位置：`lib/lint.js:19`（`ZERO_WIDTH_RE` 含 `\u200D` ZWJ）→ `lib/lint.js:66`（`emojiCount`）
- 复现：`node tmp\bug3\probe1.mjs`
- 实测：`👨‍👩‍👧‍👦` 单字符文本 → `chars=8`、`emoji-density × 1.33` 命中；×3 → `emoji-density × 2`。即 1 个家庭 emoji 就被算成 4 个 emoji，越过 `emojiCount >= 3` 的密度阈值。对照：`1️⃣`、`🇨🇳`、`❤️`、`👩‍💻` 单字符 → 0 分 0 命中（本轮修复目标达成）。
- 影响：家庭 emoji / 职业 emoji 序列（ZWJ 连接）被高估 2–4 倍，属归一化引入的新误报面；单条低严重度，但和 `emoji-marker` 相关的边界值得记一笔。
- 建议修法：删 ZWJ 前先按「扩展字素簇」计数，或在 `emojiCount` 用 `Intl.Segmenter`（Node 22 可用）切簇；至少要 `emojiCount -= ZWJ 个数`。

---

## 三、变异测试矩阵

方法：把 `index.js`/`lib/`/`tests/`/`package.json` 复制到 `tmp\bug3\mut\<变异名>\`（`node_modules\@deepseek-ai` 建 junction），注入单点变异后分别跑 `node tests/checks.mjs` 与 `node tests/corpus.mjs`，统计变红的断言。脚本：`tmp\bug3\setup_mut.py`（12 组）、`tmp\bug3\mut2.py`（5 组）；结果：`tmp\bug3\mut_result.json`、`tmp\bug3\mut2_result.json`。

基线 `mut00_orig` / `m2_00_orig`：checks `pass=126 fail=0`、corpus `pass=20 fail=0`。

| # | 变异（位置） | checks 杀死 | corpus 杀死 | 被杀断言 |
| --- | --- | --- | --- | --- |
| mut01 | `lib/lint.js:229-231` `formatNudge` 阈值 `>= 5` → `>= 0` | **0** | 0 | — |
| mut02 | `lib/lint.js:229-231` 封顶 `Math.min(25, …)` → `Math.min(100, …)` | **0** | 0 | — |
| mut03 | `lib/lint.js:233` 去掉 `ruleWeight === 0` 门（恒 `Math.min(4, metricWeight)`） | **0** | 0 | — |
| mut04 | `lib/lint.js:144-157` `mergeSpans` 恒返回未合并数组 | 1 | 0 | checks:337「行首加粗标签不重复计分（rw=8）」 |
| mut05 | `lib/lint.js:132/135` scope 用去空白字数而非 `text.length` | **0** | 0 | — |
| mut06 | `lib/lint.js:169-178` `dedupe` 分支失效 | 1 | 0 | checks:334「同一黑话复读按词去重计数」 |
| mut07 | `lib/ruleset.js:218` `service-close` 去掉裸「有」分支 | 1 | 0 | checks:313「service-close 命中『希望对你有帮助』」 |
| mut08 | `lib/lint.js:266` `analyzed` 恒 true | 3 | 0 | checks:123 / :124 / :341 |
| mut09 | `lib/lint.js:214` `k = 4.5 + chars/100` → 常量 `4.5` | **0** | 0 | — |
| mut10 | `lib/lint.js:36-55` 去掉零宽归一化 | 1 | 0 | checks:332「零宽字符不能绕过规则」 |
| mut11 | `lib/ruleset.js:248` `uplift-close` 恢复裸 `希望(能\|可以\|你)` | **0** | 0 | — |
| mut12 | `lib/lint.js:306` `renderReport` 分数不夹取 | 1 | 0 | checks:361「renderReport 钳位异常分数」 |
| m2_01 | `lib/lint.js:234-237` `score` 恒 0 | 9 | 8 | AI 样例 ≥60、区分度 ≥45、标定两条、长度不敏感、service-close ×2、纯排版不再恒 0、零宽 |
| m2_02 | `lib/lint.js:234-237` `score` 恒 100 | 12 | 12 | 人写 ≤15 ×3、空文本、纯代码、区分度、标定、性能 800ms、纯排版封顶 25、行首 emoji 不定罪、两条边界记录 |
| m2_03 | `lib/lint.js:266` `analyzed: m.chars >= 10` → `>= 50` | 1 | 0 | checks「干净中文稿报告写明未命中」 |
| m2_04 | `lib/lint.js:233` `Math.min(4, metricWeight)` → `Math.min(100, …)` | **0** | 0 | — |
| m2_05 | `lib/lint.js:255` `if (suggestions.length >= limit) break;` → `if (true) break;` | 4 | 0 | checks:309、报告含改写建议、工具 execute 尊重 maxSuggestions、maxSuggestions 非法值 |

合计：**17 次变异，杀死 checks 断言 34 条、corpus 断言 20 条**（逐变异累计）。

其它两项量化：

- **恒真（分数无关）断言 = 107/126**（`score` 恒 0、恒 100 与基线三者都通过的集合）。第二轮记的是 93/103；本轮占比从 90% 降到 85%，但恒真的绝对条数反而更多。真正约束分数大小的只有 19 条（含 9 条「恒 0 会红」、12 条「恒 100 会红」，有 2 条重叠）。
- **corpus.mjs 对 12 组细粒度变异全部 0 杀**：20 条标注语料只锁「人写 ≤30 / AI ≥40」两个方向，没有任何一条样本落在 `formatNudge` 阈值、合并、去重、scope 坐标等机制的边界上。它在「粗粒度恒 0/恒 100」下会红（8/12），属粗尺。

**零覆盖路径清单（7 条，改回旧版全套测试仍全绿）**：

1. `formatNudge` 阈值 `>= 5`（mut01）
2. `formatNudge` 封顶 `Math.min(25, …)`（mut02）——`tests/checks.mjs:318` 用 `outlineOnly`（formatWeight=8 → nudge 16）比对，封顶改到 100 时它仍然是 16，永远测不到；`probe2` 另造的重排版样本（metricWeight 17.84/18.74/18.97/19.53）在封顶 100 下会得 36–39 分并进入「中等」档，正是这条改动想防的事。
3. `lib/lint.js:233` 的 `ruleWeight === 0` 门（mut03）——第二轮「HUMAN-LONG 43 → 15」那类修复没有留下任何断言。
4. scope 的 `text.length` 坐标（mut05）——`tests/checks.mjs:339` 用了前置 100 换行，但 `lint` 入口第 160 行的 `trim` 已把换行吃掉，两种坐标在该样本上等价，所以断言测不到这个修复。
5. `k = 4.5 + chars/100` 的长度项（mut09）——没有一条断言覆盖「同一命中随文本变长而分数下降」的曲线。
6. `uplift-close` 删除裸 `希望(能|可以|你)`（mut11）——全库没有一条断言引用该样本。
7. `Math.min(4, metricWeight)` 的节奏上限（m2_04）——没有样本同时具备「真实规则命中」与「重排版」。

---

## 四、第二轮处置的逐条复测

`round2-fix.md` 第二节的 12 处改动，逐条给结论（依据：探针实测 + 变异杀死数）：

| # | 改动 | 结论 | 依据 |
| --- | --- | --- | --- |
| 1 | `service-close` 补裸「有」 | **真修好** | `lint("希望对你有帮助。")` 命中 service-close；mut07（改回旧正则）杀死 1 条断言。但同一样本触发 H1 |
| 2 | 新增 `formatNudge` | **真修好，但两条边界零覆盖** | 纯排版样本 0 → 16 分（`probe2` 实测）；mut01/mut02 均 0 杀 |
| 3 | `emoji-marker` 降为 format + 键帽/国旗识别 | **真修好** | `1️⃣`/`🇨🇳` 可识别（checks:322/:323）；行首 emoji 日志 ≤15 分；残留 ZWJ 计数问题（L5） |
| 4 | `stripCode` 按行扫描 + 围栏长度配对 | **部分修好** | `~~~`、四反引号、` ``` ` 内嵌 ```` `、缩进围栏、CRLF 均正常（probe1）；引用块围栏、跨行行内代码、缩进代码块仍未剥离（L3）；文档数字自相矛盾（M4） |
| 5 | `colonLines` 要求冒号前有汉字 | **真修好** | 4 行半角键值对 0 命中（checks:330） |
| 6 | 零宽字符归一化 | **真修好** | mut10 杀死 1 条；插 `\u200b`/`\u200d`/软连字符均照常命中；引入 ZWJ emoji 计数高估（L5） |
| 7 | scope 改用 `text.length` + 入口 trim | **行为修好，测试零覆盖** | `measure.mjs` 实测：垫 100 换行前后都命中 `platitude-open`+`transition-cliche`（chars 45 一致）；mut05 0 杀 |
| 8 | `maxSuggestions` 钳 `[1,50]` | **真修好** | 不再出现 0 条建议，checks:309 有下界；文档措辞不符（L2） |
| 9 | 返回值新增 `analyzed`，纯代码稿不再长得像「干净」 | **只修了 `chars === 0` 的一头，制造 H1** | 纯代码稿 `analyzed=false` 正确（checks:341）；1–9 字强命中稿同样被判「无正文可评」并丢掉命中/建议两节 |
| 10 | `renderReport` 钳位 + 0 分文案 | **真修好** | mut12 杀死 1 条（checks:361）；`renderReport({score:0, hits:[…]})` 含「未计分观察」 |
| 11 | `buzzword` 加 `dedupe` | **真修好** | 复读 3 次 `count === 1`；mut06 杀死 1 条 |
| 12 | `uplift-close` 删裸「希望」 | **无法验证** | 无任何断言引用该样本，mut11 0 杀；`lib/ruleset.js:248` 正则确实已无裸「希望」 |

`round2-bug.md` 的 N1–N12 台账：N1 部分（H1）、N2 修好但零覆盖、N3 部分（L3）、N4 修好（L2 措辞）、N5 部分（`format` 现在参与 `formatNudge` 出口，`rhythm` 仍无分支）、**N6 未修（M3）**、**N7 未修（L1）**、N8 修好、**N9/N10/N11 未修（L4）**、N12 修好（`tests/regression_deai_style.py:100` 已把 `tmp` 加入跳过清单，本轮跑 35/35 无假 FAIL）。

测试可信度那条（第二轮「93/103 条对分数不敏感」）：本轮是 **107/126 恒真**，绝对条数更多；`round2-fix.md:81` 对此的答复是「刻意以行为/结构断言为主」，但第三节的 7 条零覆盖说明代价已经落到评分机制本身——新加的三个机制（受限排版出口、节奏加成门、长度饱和曲线）里，没有一个被断言钉住。

---

## 五、文档与实现不符处

| 位置 | 文档写的 | 实测 |
| --- | --- | --- |
| `README.md:11` | 34 条正则规则 + 6 个统计指标 | `RULES.length=32`、`METRICS.length=10`（`measure.mjs`） |
| `README.md:44` | strict 规则段 802 字符、soft 470 字符 | 一致（不含工具提示行 802，带工具提示 861；soft 470） |
| `README.md:117-119` | checks 126、corpus 20、regression 35/35 | 一致 |
| `docs/验收报告.md:314-316` | 126/126、20/20、35 项 PASS | 一致 |
| `docs/验收报告.md:298` | `maxSuggestions` 钳到 `[1,50]` | 一致；但 `round2-fix.md:32` 写的「非法/非正数退回默认值」不符（-1 → 1 条，见 L2） |
| `docs/reviews/round2-fix.md:28` | 四反引号样本 65 → 58「代码不再计分」 | 58 分是「中等 AI 腔」，与「不再计分」矛盾，且样本未入库无法复跑（M4） |
| `index.js:24-27` | description 承诺「命中明细与改写建议」 | 1–9 字强命中稿两者都不输出（H1） |
| `docs/验收报告.md:308` | 纯排版 AI 回答 0 → 16（不进中等档） | 一致（16 分 / slight）；但封顶值本身零覆盖（第三节第 2 条） |

---

## 六、未能证明有问题的部分

1. **性能无回退**（`tmp/bug3/probe3.mjs`，best-of-3，ms）：10 万换行 LF **7.5**、CRLF（20 万字符）**7.5**、10 万字符单行 `a` **0.4**、10 万汉字单行 **8.8**、5 万表格行（60 万字符）**59.5**、5 万表格行 CRLF（65 万字符）**102.1**、5 万次「此外，」**22.1**、2 万个 `**加粗**` **11.2**、2000 个未闭合围栏块 **0.7**、2 万行行首 emoji **19.3**。全部低于 `checks.mjs:294` 的 800ms 门限，无超线性。
2. **`collectSpans` 的 `new RegExp` 开销**：每条规则每调用重建一次（32 条），实测 `reTimes`/`lintShort`/`reAll` 三组都在 0.1ms 测量下限以下（记 0）；无缓存必要，也未见 `lastIndex` 残留。
3. **`dedupe` 复杂度**：同词复读 n=2000/10000/40000 → 0.8/3.7/16.7ms，全不同词 → 0.8/4.4/18.6ms，近线性，无退化。
4. **并发/共享可变状态**：`lib/` 下没有顶层 `let`/`var`（grep 无命中），规则正则每次 `new RegExp`，`EMOJI_ALL_RE` 只在 `String.match` 里用（会重置 `lastIndex`），`TABLE_RE`/`EMOJI_START_RE` 无 `g` 标志。同一进程内连续/并发调用没有共享可变状态，未复现跨调用串味。
5. **`renderReport` 与工具入口的异常面**：`renderReport(undefined/null/{})` 不抛错（`checks.mjs:300-308` 通过）；lint 对非字符串输入经 `String(text ?? "")` 兜底；`execute` 没有 try/catch，但没构造出能让它抛异常的输入路径。
6. **内存**：10 万字符正文 heap 增量 ≈ 2.0MB、40 万字符 ≈ 7.0MB（无 `--expose-gc`，粗略值）；没有发现 >10 万字符输入下的异常分配。
7. **`bandOf` 与 `k` 的单调性**：`k = 4.5 + chars/100 > 0` 恒成立，`ruleScore` 随 chars 单调下降、随 ruleWeight 单调上升，无 NaN/Infinity 泄漏（`coverage` 有 `m.chars > 0` 守卫）。
8. **`ab_test.mjs` 未实跑**：需要 `DEEPSEEK_API_KEY` 且要联网，本轮禁令下无法验证；上一轮已记录其缺 key 时显式 FAIL，不静默通过。

---

## 附：复现命令

```
cd D:\GitRepos\dsh-deai-style.git
node tmp\bug3\measure.mjs          # H1 复现、规则数、提示词长度、N2 复测
node tmp\bug3\probe1.mjs           # stripCode 形态 / 零宽 / emoji / CRLF 表格
node tmp\bug3\probe2.mjs           # 评分边界、formatNudge 跳变、k 曲线、bandOf
node tmp\bug3\probe3.mjs           # 性能与内存
python tmp\bug3\setup_mut.py       # 12 组变异（outputs mut_result.json）
python tmp\bug3\mut2.py            # 5 组变异（outputs mut2_result.json）
node tests\checks.mjs              # 基线 126/126
node tests\corpus.mjs              # 基线 20/20
python tests\regression_deai_style.py   # 基线 35/35
```
