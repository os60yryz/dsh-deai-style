# dsh-deai-style v1.1.0 第二轮代码级缺陷审计（独立审计方）

- 仓库：`D:\GitRepos\dsh-deai-style.git`，commit `854d40a`，版本 v1.1.0
- 审计时间：2026-10-15　审计方：第二轮（代码缺陷 + 测试可信度），与红队职责不同
- 证据脚本：`tmp/bug2/probe1.mjs`（D1-D7 复测）、`tmp/bug2/probe2.mjs`（超线性压测）、`tmp/bug2/probe3.mjs`（口径/静默失败/边界）、`tmp/bug2/setup_mut.py` + `tmp/bug2/analyze_mut.py`（变异测试）、`tmp/bug2/mut_summary.txt`、`tmp/bug2/probe3.json`
- 全程未修改 `index.js`、`lib/`、`tests/`、`package.json`、`docs/` 现有文件

---

## 一、结论速览

新确认缺陷 **12 条**：高 0、中 4（N1/N2/N3/N4）、低 8（N5-N12）。
第一轮 7 条复测：**5 条确认修复**（D1/D3/D4/D5/D6）、**2 条部分残留**（D2 长度稀释仍在、D7 只覆盖类型未覆盖数值域）。
合计需处理 **14 条**。

最严重的三条：

1. **N1 静默通过面**（`lib/lint.js:130-196`）：无正文可分析时（纯代码稿、`null`、`{}`、空串）一律返回 `score=0` + `band=clean`（「基本没有 AI 腔」），与"草稿很干净"同形。实测 `lint("```python\ndef f():\n    return 1\n```")` → `score 0 / chars 0 / band clean`。
2. **N2 统计口径与 scope 判定不一致**（`lib/lint.js:31` vs `103/107`）：`chars` 是去空白字符数，而开场/结尾规则用**原始字符串下标**跟它比。同一段 84 字文本前置 100 个换行后，`platitude-open` 从命中变不命中，`chars` 全程 84。
3. **N3 `stripCode` 漏删 `~~~` 围栏**（`lib/lint.js:19`）：`~~~` 包裹的纯代码块被当正文打分，实测把含套话的代码块判成 **57 分 / medium**；同类漏删还有引用块内围栏、跨行行内代码、4 空格缩进代码块。

**测试可信度（第四条）结论：`tests/checks.mjs` 的 103 条断言里，93 条对 `score` 完全不敏感**（把 `lib/lint.js:192-195` 的 score 改成恒 0 或恒 100，这 93 条全过）。恒返 0 时仍有 98/103 通过；把 `lib/lint.js:166` 的 `mergeSpans(spans)` 改成不合并，**103/103 全过**——重叠命中只算一次这个核心机制零覆盖。

---

## 二、第一轮 7 条缺陷复测结果

| 编号 | 第一轮声称（round1-fix.md） | 本轮实测 | 是否属实 |
| --- | --- | --- | --- |
| D1（高） | 表格行正则 `\s` 跨行回溯 O(n²)，10 万换行 7078ms → 改 `[ \t]` 后 20ms | `lint("\n".repeat(100000))` = **22.5ms**（原 7078ms，提速 314×）；probe1 全部性能项 < 120ms（`unclosedFences2000`=10.1ms） | 属实 |
| D2（高） | 分子封顶 + 分母线性 → 越长分越低；改饱和曲线后 ×1/×2/×5/×20 = 100/100/100/100 | 密集 AI 样例 ×1/×2/×5/×20 = **100/100/100/100**（chars 84→1680）✅；**但稀疏命中仍被长度稀释**：同 1 处「此外，」58 字 → **18 分**，10258 字 → **1 分**（`k = 4.5 + chars/100`，lint.js:173）。round1-fix.md §5.3 记的是"10258 字 5 分"，与实测 1 分不符 | 部分属实（长文稀释仍在，且报告数字不实） |
| D3（中） | `let-us` 前瞻 `(?=[^\p{Script=Han}])` 导致「让我们来看看」全漏 | `lint("让我们来看看这个方案。")` → `let-us` 命中 **3 处**，score 48 | 属实 |
| D4（中） | `both-sides` 第三分支多一个「还」 | `"这个方案既快又稳。"` → **0 命中**；`"一方面效率高，另一方面维护成本也高。"` → both-sides×1 + transition-cliche×1（双计，间距不重叠，属预期） | 属实 |
| D5（低） | 未闭合围栏不剥离 | `stripCode("正文\n```\ncode here")` → `"正文"`，score 0：确实剥离了；但剥离方式是**吞掉围栏之后的全文**（见 N3） | 属实（附带新问题） |
| D6（低） | 字符类含裸 `\uFE0F` | 裸 VS16 单字符样本 → **score 0**，不再触发 `emoji-marker` | 属实 |
| D7（低） | `renderReport` 对异常入参抛错 | 12 种畸形入参（`null`/`undefined`/`42`/`"x"`/`[]`/`{}`/`NaN`/分数为负…）**均不抛错**；但 `renderReport({score:1e9})` → `1000000000/100（明显 AI 腔）`，未夹取 | 部分属实（类型面修好，数值域未覆盖，见 N8） |

---

## 三、新确认缺陷

### N1（中）无正文可分析时与"干净"同形，静默放行

- 位置：`lib/lint.js:130-196`（全流程无 `m.chars > 0` 守卫）、`lib/lint.js:131`
- 现象：`lint()` 对纯代码稿、非字符串、空白文本一律 `score=0`、`band=clean`（标签「基本没有 AI 腔」），调用方无法区分"没有 AI 腔"与"没分析到任何正文"。
- 最小复现与实测（`tmp/bug2/probe3.mjs`）：
  - `lint("```python\ndef f():\n    return 1\n```")` → `score 0, chars 0, band clean`
  - `lint(null)` / `lint(undefined)` / `lint("")` / `lint("   ")` / `lint([])` → `score 0, band clean`
  - `lint({})` → `chars 14`（`"[object Object]"` 被当正文），`score 0`
- 风险：`deai_scan` 报告会显示「正文 0 字／基本没有 AI 腔」，模型据此认为草稿没问题。工具入口有 schema 校验挡住非字符串（见排除项），但库 API 与渲染层不设防。
- 修法：`chars === 0` 时返回显式状态（如 `band: "unknown"` / `ok:false` / 报告写「未分析到正文」），并在 `renderReport` 输出警告行。

### N2（中）`chars` 口径与 scope 原始下标不一致，前导空白改变判定

- 位置：`lib/lint.js:31`（`const chars = text.replace(/\s/g, "").length;`）对 `lib/lint.js:103`（`const limit = Math.max(60, Math.min(200, chars * 0.2));`）、`lib/lint.js:107`（`const from = chars * 0.65;`）
- 现象：`limit`/`from` 由"去空白字数"算出，却拿去和**原始字符串下标** `m.index` 比较。前导空行/空白越多，开场规则越早失效；结尾规则的方向相反（空白越多，判定为"结尾"的原始区间越靠前，误判面变大）。
- 最小复现（`tmp/bug2/probe3.mjs`）：`ai1` = 「这是一个非常好的问题！首先，我们需要明确目标。…」（84 字）→ `platitude-open` 命中；`"\n".repeat(100) + ai1` → **不命中**，`chars` 两边都是 84，而短语 raw 下标 100 > `limit`（= max(60, min(200, 16.8)) = 60）。
- 修法：scope 判定改用"去空白后的下标"（先构造 compact 文本再取 offset），或把 `limit`/`from` 换算到原始坐标（用 `text.length` 而非 `chars`）。
- 备注：现有测试全部用不带前导空白的样例，覆盖为零。

### N3（中）`stripCode` 漏删多形态代码，代码块被当正文打分

- 位置：`lib/lint.js:19-49`（围栏判定只认行首 ` ``` `）
- 现象与实测（`tmp/bug2/probe3.json` 的 `stripCode` 段，值=去空白后残留字符数）：

| 形态 | 原文长度 | 剥离后残留 | 是否有分数影响 |
| --- | --- | --- | --- |
| `~~~py\nprint(1)\n~~~` | 19 | 16（未删） | 是 |
| `~~~\n这是一个非常好的问题！\n首先，我们要明确目标。\n~~~` | 32 | 28 → **score 57 / medium** | 是（纯代码块被判中等 AI 腔） |
| `> ```\n> 这是一个非常好的问题！\n> ``` ` | 26 | 16（未删） | 潜在（本例因 `>` 前缀未触发行首锚定） |
| `前一句`code\nmore`后一句` | 17 | 16（跨行行内代码未删） | 潜在 |
| `    const x = 1;\n    console.log(x);` | 37 | 24（缩进代码块未删） | 潜在 |

- 反向问题：`"这是一个非常好的问题！首先我们要明确目标。\n```\ncode\n"` → `chars 21`，围栏之后的全部正文被吞掉（未闭合围栏 = 后半篇不参与评分）。
- 修法：围栏正则支持 `~{3,}` 与 `[ \t]*(> ?)*` 前缀；行内代码允许跨行；未闭合围栏只剥离到文末时给出显式提示而非静默截断评分范围。

### N4（中）`maxSuggestions` 无下界，负值静默吞掉全部建议

- 位置：`index.js:34-37`（`type: "integer"`，无 `minimum`）、`lib/lint.js:206`（`Math.max(0, Math.trunc(opts.maxSuggestions))`）
- 现象：`maxSuggestions: -1` 不报错，钳成 0 → 报告顶部给「78/100（明显 AI 腔）」，底部**完全没有「改写建议」小节**（`hasSuggestSection=false`，报告直接以命中明细结尾）。调用方拿到高分却拿不到任何可操作建议，且无任何提示。
- 实测：`maxSuggestions: 1e9` → 3 条（全部给出）；`2.7` → 2 条；`-1` → 0 条且建议小节消失。
- 修法：schema 加 `minimum: 0`（或 1）；`limit === 0` 时报告显式写「改写建议：已按参数关闭」。

### N5（低）`evidence` 字段只有 `"strong"` 被逻辑消费

- 位置：`lib/ruleset.js:259-353`（format×6 / strong×1 / rhythm×3）、`lib/lint.js:162`（原样透出）、`lib/lint.js:181`（仅判 `=== "strong"`）
- 现象：`lib/*.js` 全文对 `evidence` 只有这两处引用，`"format"` 与 `"rhythm"` 不参与任何分支；而 `ruleset.js:259` 的注释声称 format「本身即 AI 生成痕迹，可独立成立」，代码里能独立定罪的只有 `strong`（lint.js:189-190）。注释与实现不一致。
- 修法：要么让 format 也参与独立定罪（并实测误报），要么改注释；或把该字段降级为纯元数据并在类型上标注。

### N6（低）`METRICS[].threshold` 是死字段

- 位置：`lib/ruleset.js:267/276/285/294/303/312/321/334/343/353`（10 个阈值）
- 现象：`lib/lint.js` 全文不含 `threshold` 字样（grep 无命中），阈值实际硬编码在各自 `measure()` 闭包内；改 `threshold` 数值不改变任何行为，制造"调过阈值"的假象。
- 修法：让 `lint` 用 `metric.threshold` 参与计算，或删字段并注明常量位置。

### N7（低）`bandOf` 边界与 NaN 口径

- 位置：`lib/lint.js:11-12`（`BANDS.find((b) => score <= b.max)`）
- 实测：`bandOf(15)`→clean、`bandOf(35)`→slight、`bandOf(60)`→medium（边界值归**低一档**，与 `BANDS` 的 `max` 语义一致，属设计）；`bandOf(NaN)`→heavy、`bandOf(Infinity)`→heavy、`bandOf(-1)`→clean。与 `renderReport`（`lib/lint.js:257` 把非有限数归 0）口径相反。
- 说明：`lint()` 内部 `score` 恒在 0-100，故只影响直接调用 `bandOf` 的消费者；列此以备契约统一。

### N8（低）`renderReport` 不夹取 score 数值域

- 位置：`lib/lint.js:257-262`
- 实测：`renderReport({score: 1e9})` → `AI 腔评分：1000000000/100（明显 AI 腔）`；`{score:-5}` → 负数原样渲染。
- 修法：`score` 也用 `Math.max(0, Math.min(100, …))` 夹取（与 `chars` 的 `Number.isFinite` 守卫并列）。

### N9（低）`normalizeConfig` 只认字面 `false`

- 位置：`lib/plan.js:10`（`enabled: c.enabled !== false`）、`lib/plan.js:13`（`injectLintTool: c.injectLintTool !== false`）
- 实测：`normalizeConfig({enabled: 0}).enabled === true`、`{enabled: "false"}` → true、`{injectLintTool: 0}` → true。
- 说明：宿主路径有 `index.js:14-20` 的 `z.boolean()` 先校验，直接调用 `lib/plan.js` 的消费者无防护。修法：`!== false && c.enabled !== 0 && c.enabled !== "false"` 或显式 `Boolean(c.enabled ?? true)` 并加类型断言。

### N10（低）`planRegistrations` 入参无守卫，order 可能为 NaN

- 位置：`lib/plan.js:22-26`（`orders.personaPrefix` / `orders.personaSuffix` 直接解引用）、`lib/plan.js:34`（`base + 1`）
- 实测：`planRegistrations({}, undefined)` → **抛 TypeError**；宿主 `ctx.systemPrompt.getSectionOrder("不存在的名字")` 返回 `NaN` 时，`base + 1` 得到 `NaN` 作为 section order 静默下传（`JSON.stringify` 显示为 `null`，不报错）。
- 修法：入参校验 + `Number.isFinite(base)` 检查，非法时回退到固定 order 并告警。

### N11（低）工具 `output.schema` 是空壳

- 位置：`index.js:39-44`（`schema: { type: "object", additionalProperties: true }`）
- 现象：没有声明 `score/band/chars/hits/suggestions` 任何字段，等于没有输出契约；`render` 直接吃 `execute` 的返回值，`execute` 一旦返回 `undefined`，`renderReport` 内部的类型分支才会兜（D7 只修了 `renderReport` 内部）。`parameters.maxSuggestions` 同样无 `minimum`（见 N4）。
- 修法：把 `lint()` 的返回结构写进 `output.schema`。

### N12（低）回归套件 B2 断言扫描范围含 `tmp/`，临时产物即假 FAIL

- 位置：`tests/regression_deai_style.py`（B2「换行为 LF」断言）
- 实测：我写入 `tmp/bug2/` 两个 CRLF 临时文件后，`python tests/regression_deai_style.py` → `TOTAL 35 assertions, 34 PASS, 1 FAIL`，`FAILED: B2 换行为 LF :: ['tmp\\bug2\\b1_full.txt','tmp\\bug2\\probe3.json']`；把这两个文件转成 LF 后重跑 → **35 PASS / 0 FAIL**。
- 说明：断言本身没错，但它把工作区里任何非受控文件纳入判定，任何人跑完临时脚本都会看到假 FAIL。修法：限定 `git ls-files` 列表或排除 `tmp/`、`node_modules/`。

---

## 四、测试可信度审计

### 4.1 变异测试（`tmp/bug2/setup_mut.py`，复制仓库后注入变异，各跑 `node tests/checks.mjs`）

| 变异 | 位置 | 结果 |
| --- | --- | --- |
| mut0 未变异 | — | pass=103 fail=0 |
| mut1 score 恒 0（永远判"干净"） | `lib/lint.js:192-195` | **pass=98 fail=5** |
| mut2 score 恒 100（永远判"AI 腔"） | 同上 | **pass=96 fail=7** |
| mut3 suggestions 恒空 | `lib/lint.js:209` | pass=100 fail=3 |
| mut4 取消重叠区间合并（`mergeSpans(spans)` → `spans`） | `lib/lint.js:166` | **pass=103 fail=0** |

- **恒真（分数无关）断言 = 93 条**（mut1 ∩ mut2 ∩ mut0）。把整个评分函数改成常量，这 93 条全部照过。
- 典型恒真样例：
  - 「长度不敏感：极差 <=15（实际 0）」——样本是密集 AI 文，×20 时分数已饱和在 100，恒返 0/恒返 100 都不影响该断言成立。真实稀疏场景极差是 **17**（58 字 18 分 → 10258 字 1 分），无用例覆盖。
  - 「规则库条目 >= 25」「规则 id 唯一」「规则字段齐全」「结果字段齐全」「结构指标字段齐全」「分档表 4 档」——纯结构式，与扫描能力无关。
  - 「Config 存在」「apply 是函数」「section 文本非空」「开：注册 1 个工具」「关：零注册」等——配置/生命周期式，评分归零不影响。
- **mut4（取消合并）= 103/103 全过**：没有任何断言覆盖"重叠命中只算一次"。改坏 `mergeSpans`（例如返回不合并的数组）不会让测试变红，只会让分数虚高。
- 只有 5 条断言能在"恒返 0"下失败（即真正约束了评分方向）：AI 样例分数 >= 60、区分度 >= 45、标定强指纹分数高于口语变体、AI 科普腔样例不漏报、×1/×2/×5/×20 均 >= 70。
- 只有 3 条断言能在"suggestions 恒空"下失败：建议条数受 maxSuggestions 限制（实际 0）、报告含改写建议、工具 execute 尊重 maxSuggestions（实际 0）。

### 4.2 第一轮声称修掉的测试问题的复测

| 声称（round1-fix.md） | 复测 |
| --- | --- |
| `checks.mjs` 的 `<= 2`/`<= 3` 恒真 → 加下界 `>= 1` | **属实**：mut3 下这两条断言 FAIL（实际 0），说明下界真的在起作用 |
| `checks.mjs` 人写样例「命中 <= 1 条」恒真 → 加 `&& score < 35` | 未见反例（人类样例在 mut2 恒 100 下失败） |
| `regression_deai_style.py` 用例数下界 60 → 100（现 103） | **属实**：`node tests/checks.mjs` 实测 `TOTAL pass=103 fail=0`，> 下界；但下界只防整体缩水，不防"断言还在但恒真"（见 4.1） |
| `ab_test.mjs` 无基线高分样本时判据空过 | **未实测**（需 `DEEPSEEK_API_KEY` + 联网，题目禁联网）。可见的一点：缺 key 时它显式 `FAIL` 并 `exit 1`，不会静默通过 |

### 4.3 其它套件实跑

- `node tests/checks.mjs` → `TOTAL pass=103 fail=0`
- `node tests/corpus.mjs` → `CORPUS pass=20 fail=0 total=20`（A4 加粗小标题列表 86 heavy、A8 开场致谢 53 medium，20 条全部达标）
- `python tests/regression_deai_style.py` → 清理临时产物后 `TOTAL 35 assertions, 35 PASS, 0 FAIL`（见 N12）

---

## 五、排除项（查过但确认无问题）

1. **性能/超线性**：`tmp/bug2/probe2.mjs` 19 种形状 × 规模 [12.5k, 25k, 50k, 100k]，耗时全部近线性（8 倍规模 ≈ 11~12 倍耗时，最大绝对值 113ms）；**无超线性增长**，D1 的 O(n²) 未在任何形状复现。`probe1` 单点：10 万换行 22.5ms、2000 个未闭合围栏块 10.1ms，其余形状（5 万表格行、10 万字符单行 `|`、2 万个 `**b**`、5 万 emoji、5 万重复标点）同为百毫秒级。
2. **正则 `g` 标志与 `lastIndex`**：所有规则正则均带 `g`（checks 断言「规则正则均带 g 标志」），同一条规则连续调用 3 次命中数一致，无 `lastIndex` 残留。
3. **规则 id 唯一**：`RULES` 无重复 id（checks 断言 + 人工核对）。
4. **除零/NaN 泄漏**：`scale` 的 `ratio/threshold` 无非有限输入（`Math.max(chars,150)`、`Math.max(chars,300)`、`k = 4.5 + chars/100` 均 > 0）；`coverage` 有 `m.chars > 0` 守卫（lint.js:200）；实测 `chars = 0` 时不产生 `NaN`/`Infinity`。
5. **工具入口的输入校验**：`defineTool` 对非 string 的 `text`、非整数的 `maxSuggestions` 会拒绝（`index.js:28-38`），N1/N4 的静默面被挡在工具之外（库 API 仍暴露）。
6. **关闭路径零注册**：`enabled:false` 与 `level:"off"` 均使 `planRegistrations` 返回 `null`，`index.js:57` 提前 return；checks 断言「关：零注册」通过；`ctx.effect` 注册与清理（`index.js:59/61`，标签 `deai-style.section()` / `deai-style.tool()`）成对，无重复注册。
7. **`renderReport` 类型健壮性**：12 种畸形入参不抛错（D7 修的这部分有效）。

---

## 六、未做的部分

1. `tests/ab_test.mjs` 未实跑：需要 `DEEPSEEK_API_KEY` 且要联网调用 LLM 打分，题目明确要求不联网；"无基线高分样本时判据空过"这一点只做了静态判断，未构造极端输入实测。
2. 压力上界只到 10 万单元（probe2 最大规模），未做 40 万/百万级与并发多实例压测。
3. 25+ 条规则的正则**语义**正确性（漏报/误报的内容面）未逐条验证——属红队职责，本轮只覆盖性能、口径、边界与结构面。
4. 未在真实 DSH 宿主中加载插件验证（未启动 GUI）；`plan`/`effect` 结论来自 `tests/checks.mjs` 的 ctx 桩与源码阅读。
5. `docs/reviews/round1-bug.md` 原文未逐条比对，只按任务给出的 D1-D7 摘要复测。
