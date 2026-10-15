# dsh-deai-style 缺陷审计（第一轮）

审计对象：`D:\GitRepos\dsh-deai-style.git`（源码只读，未改动任何实现文件）
审计方式：只读静态复核 + 临时探针实测（`tmp/bug1/probe1.mjs`、`probe2.mjs`、`probe3.mjs`）
基线：`node tests/checks.mjs` = 95 PASS / 0 FAIL；`python tests/regression_deai_style.py` = 35 PASS / 0 FAIL（两者本轮都在缺陷存在的前提下全绿，见第四章）
环境：Node v24.19.0，Windows，cwd = 仓库根

## 一、结论速览

确认缺陷 7 条：**高 2、中 2、低 3**。

| 编号 | 位置 | 严重度 | 一句话 |
| --- | --- | --- | --- |
| D1 | `lib/lint.js:20` | 高 | 表格行正则 `^\s*\|.*\|\s*$` 在空白行密集输入上二次回退，8 万换行要 4.5 秒 |
| D2 | `lib/lint.js:103,107,108` | 高 | 同一风格密度下分数随文本变长单调衰减，长文系统性漏报（同文重复 20 倍：98 → 43） |
| D3 | `lib/ruleset.js:141` | 中 | `let-us` 只在「让我们」后紧跟非汉字时命中，中文正文里最常见的形态全漏 |
| D4 | `lib/ruleset.js:76` | 中 | `both-sides` 第三分支多一个「还」，hint 声称覆盖的「既…又…」两段式漏报 |
| D5 | `lib/lint.js:16-20` | 低 | 未闭合代码围栏不剥离，代码内容按散文计分 |
| D6 | `lib/ruleset.js:162` | 低 | `emoji-marker` 字符类含裸 `\uFE0F`，单独出现即误报 25 分 |
| D7 | `lib/lint.js:155-176`、`index.js:22-48` | 低 | `renderReport` 对形状异常的 value 直接抛 TypeError；`maxSuggestions` 负值静默返回 0 条建议 |

分数上下界本身没问题：3000 例随机 fuzz + 2000 例对抗拼装，`score` 恒为 [0,100] 整数，无 NaN/Infinity；`Math.min(100, ...)`（`lib/lint.js:110`）挡住了上溢。除零方面 `lib/lint.js:25`（`Math.max(chars,150)`）、`:107`（`Math.max(m.chars,300)`）、`lib/ruleset.js:321`（`Number.isFinite`）三处都兜住了，`sentenceCv`/`paragraphCv` 在 n=1 / 全等值下返回 0，实测未产生 NaN。工具契约、配置 schema、`order` 计算、`package.json` 与 `cordis.patch.yml` 自洽性均未发现问题（见第三章与第一章末尾）。

## 二、确认缺陷清单

### D1（高）空白行密集输入触发二次回退

- 位置：`lib/lint.js:20`
  ```js
  .replace(/^\s*\|.*\|\s*$/gm, " "); // 表格行
  ```
- 最小复现（pwsh，cwd = 仓库根）：
  ```
  node --input-type=module -e 'const {lint}=await import("./lib/lint.js"); for (const n of [20000,40000,80000]) { const t=Date.now(); lint("\n".repeat(n)); console.log(n, (Date.now()-t)+"ms"); }'
  ```
- 期望：空/近空白输入应当毫秒级返回 0 分（`lint("")`、`lint("   ")` 都是 0ms）。
- 实际：`20000 → 291ms`、`40000 → 1126ms`、`80000 → 4536ms`；`"\n".repeat(100000)` 实测 **7078ms**。CRLF 粘贴同样触发：`"\r\n"×40000`（8 万字符）`= 4501ms`；带缩进的空白行 `"  \n"×20000`（8 万字符）`= 2362ms`。单独测量该正则：`10000 → 70ms`、`20000 → 294ms`、`40000 → 1141ms`，每翻倍耗时 ×4，是干净的 O(n²)。对照：5 万字的正常段落文档（无连续空白区）只要 3ms。
- 根因：`m` 模式下 `^\s*` 里的 `\s` 包含 `\n`，可以从行首一路吞掉后面所有换行，随后 `\|` 匹配失败再逐字符回退；每个行首位置重复一次，代价是「连续空白长度」的平方。`\s*$` 同理。
- 修复建议：把 `\s` 收窄成不含换行的 `[ \t]`，即 `/^[ \t]*\|.*\|[ \t]*$/gm`；并在 `stripCode` 前面加长度闸门（例如先 `if (t.length > 200000)` 只做围栏剥离）。改完必须把「空白行洪水」用例补进 `tests/checks.mjs`。

### D2（高）分数随文本长度衰减，长文漏报

- 位置：`lib/lint.js:103`、`lib/lint.js:107-108`
  ```js
  if (h.kind === "rule") ruleWeight += h.sev * Math.min(h.count, 2);   // :103 每条规则最多计 2 次
  const density = (ruleWeight * 1000) / Math.max(m.chars, 300);         // :107 分母是全文正文字数
  const ruleScore = ruleWeight === 0 ? 0 : (100 * density) / (density + 20); // :108
  ```
- 最小复现：
  ```
  node --input-type=module -e 'import("node:fs").then(async fs=>{const L=await import("./lib/lint.js");const ai=fs.readFileSync("tests/fixtures/ai_style_sample.txt","utf8");for(const n of [1000,4000,20000]){const s=ai.repeat(Math.ceil(n/ai.length)).slice(0,n);const r=L.lint(s);console.log("len="+n,"weighted="+r.weighted,"density="+r.density,"score="+r.score)}})'
  ```
- 期望：把同一段 AI 腔文字重复 N 遍，每千字的 AI 腔密度不变，分数应当基本不变。
- 实际：

  | 文本长度 | chars | weighted | density | score |
  | --- | --- | --- | --- | --- |
  | 1000 | 938 | 74 | 72.49 | 88 |
  | 2000 | 1875 | 74 | 36.27 | 74 |
  | 4000 | 3752 | 74 | 18.12 | 58 |
  | 20000 | 18756 | 74 | 3.63 | 25 |

  同一份样例直接 `lint(ai)` = 98，`lint(ai.repeat(2))` = 93，`×5` = 76，`×20` = **43**；分数跨越了分档边界。也就是说一篇 2 万字、通篇 AI 腔的稿子拿 25 分（会被判成干净），而它的前 938 字拿 88 分。
- 根因：分子 `ruleWeight` 因为 `Math.min(h.count, 2)` 与规则条数有界而饱和（上表恒为 74），分母 `m.chars` 随长度线性增长，两者叠加使 `density ≈ 常数/长度`。`lib/ruleset.js:271,298,307,315` 的 metric 又各自用 `m.per1000` 做了第二次密度归一，两套归一化互相叠加。指标本身不是密度，是「总命中量 / 全文长度」。
- 修复建议：二选一。(a) 让分子也线性：把 `Math.min(h.count, 2)` 改成按 `per1000` 计（`h.count / m.per1000`），或先把 `ruleWeight` 除以 `per1000` 再进 `density`；(b) 承认这是「总量」指标，改用固定分母窗口（如按段落/窗口取最大值）。无论选哪条，都要补一个「同密度、不同长度」的标定用例并写进 `tests/checks.mjs`。

### D3（中）`let-us` 与 hint 不符，中文形态全漏

- 位置：`lib/ruleset.js:141`
  ```js
  re: /让(我们|咱们)(?=[^\p{Script=Han}])/gu,
  ```
  hint 写的是「『让我们…』是英文 Let's 直译，中文口语里不说」。
- 最小复现：
  ```
  node --input-type=module -e 'const {lint}=await import("./lib/lint.js"); for (const t of ["让我们来看看这个方案。","让我们来分析一下。","让我们 look at this。","让我们，一起做。"]) console.log(JSON.stringify(t), JSON.stringify(lint(t).hits.map(h=>h.id)))'
  ```
- 期望：hint 声称检测「让我们…」，四种写法都该命中（至少前两种）。
- 实际：`"让我们来看看这个方案。"` → `[]`（score 0）；`"让我们来分析一下。"` → `[]`；`"让我们 look at this。"` → `["let-us"]`；`"让我们，一起做。"` → `["let-us"]`。
- 根因：前瞻 `(?=[^\p{Script=Han}])` 要求「让我们」后面**不是**汉字。而中文正文里这个模板后面必然跟汉字，等于把规则的靶子排除了；它实际只在「让我们 + 英文/标点」时命中。若这是刻意收窄（只抓中英混排），则 hint 必须改写成「让我们」后接非汉字的情形，否则使用者/模型会以为它覆盖了中文常见形态。
- 修复建议：改成正例优先的 `/(让我们|咱们)(?=来|一起|看看|分析|思考|探讨)/`，或直接去掉前瞻并放宽 FP 容忍度；无论哪种都要把 hint 改到与实现一致，并补 `checks.mjs` 标定用例。

### D4（中）`both-sides` 三分支多一个「还」，两段式漏报

- 位置：`lib/ruleset.js:76`
  ```js
  re: /(既有[^。；\n]{0,20}(也|又)有|一方面[^。；\n]{0,40}另一方面|既[^。；\n]{0,12}又[^。；\n]{0,12}还)/g,
  ```
  hint：「『既…又…』的两面陈述常等于没表态；说清哪一面更重。」
- 最小复现：
  ```
  node --input-type=module -e 'const {lint}=await import("./lib/lint.js"); for (const t of ["既方便又便宜。","既快又稳。","既有优点也有缺点。","既方便又便宜还好用。"]) console.log(JSON.stringify(t), JSON.stringify(lint(t).hits.map(h=>h.id)))'
  ```
- 期望：hint 点名的「既…又…」两段式应命中。
- 实际：`"既方便又便宜。"` → `[]`；`"既快又稳。"` → `[]`；`"既有优点也有缺点。"` → `["both-sides"]`；`"既方便又便宜还好用。"` → `["both-sides"]`（因为第三个分支末尾要求「还」）。命中的两条都不是「既…又…」两段式。
- 根因：第三分支写成 `既…又…还`（三段式），把两段式排除了；第一分支只认「既有…也有/又有」。
- 修复建议：第三分支去掉尾部 `还`，改为 `既[^。；\n]{0,12}又[^。；\n]{0,12}(?:还|就|也)?`，并补一条「既方便又便宜」正例。

### D5（低）未闭合代码围栏不剥离

- 位置：`lib/lint.js:16-20`（`stripCode` 只用成对的 `/```[\s\S]*?```/g`、`/~~~[\s\S]*?~~~/g`）
- 最小复现：
  ```
  node --input-type=module -e 'const {lint}=await import("./lib/lint.js"); console.log("未闭合", lint("```js\nconst a = 进行深入分析;\n").score, "已闭合", lint("```js\nconst a = 进行深入分析;\n```\n").score)'
  ```
- 期望：围栏里的内容不算散文，两种写法同分。
- 实际：未闭合 → `33`（命中 `translationese`），已闭合 → `0`。`"```js\n进行深入分析"`（无尾随换行）同样 33。四反引号围栏 ```` ````js … ```` ```` 能被正确剥离（0 分）。
- 根因：成对正则匹配不到未闭合围栏，整段代码留在正文里。
- 修复建议：先做一次围栏配对扫描，遇到奇数个围栏就把最后一个围栏之后的内容整体替换掉。真实触发场景是模型输出被 `max_tokens` 截断，末尾代码块常常没闭合，此时 `deai_scan` 会对着自己的代码报散文命中。

### D6（低）`emoji-marker` 把裸变体选择符当成 emoji

- 位置：`lib/ruleset.js:162`
  ```js
  re: /[\u2705\u274C\u26A0\uFE0F\u{1F4A1}\u{1F680}\u{1F4CC}\u{1F525}\u{1F31F}\u{1F4C8}\u{1F3AF}]/gu,
  ```
- 最小复现：
  ```
  node --input-type=module -e 'const {lint}=await import("./lib/lint.js"); for (const c of ["\uFE0F","\u200D","\u200C","\u200B"]) { const r=lint("文字"+c+"文字"); console.log(JSON.stringify(c), r.score, JSON.stringify(r.hits.map(h=>h.id))); }'
  ```
- 期望：单独的变体选择符不是 emoji 标记，不该命中。
- 实际：`\uFE0F` → score 25，命中 `emoji-marker`；ZWJ/‌ZWNJ/ZWSP 不命中。
- 根因：字符类里 `\uFE0F`（VS16）单独成项。它本意是让「✅️」这类「基字符 + VS16」也算命中，但没有任何前缀约束，孤立出现（IME 残留、CJK 兼容序列、半截 emoji）就会误报。
- 修复建议：把 VS16 从独立的单字符集合里拿掉，改为显式列出需要的「基字符 + 可选 VS16」组合，例如 `/[\u2705\u274C\u26A0]\uFE0F?|[\u{1F4A1}...]/gu`。

### D7（低）`renderReport` 无防御 + `maxSuggestions` 负值静默

- 位置：`lib/lint.js:155-176`（`renderReport` 直接读 `result.score`、`Object.entries(result.byCategory)`、`h.samples.length`）；`index.js:22-48`（`maxSuggestions` 只声明 `type:"integer"`）
- 最小复现：
  ```
  node --input-type=module -e 'const {renderReport}=await import("./lib/lint.js"); for (const v of [undefined, {}, {score:1,byCategory:null,hits:[{id:"a"}]}]) { try { renderReport(v); console.log("ok"); } catch (e) { console.log("THROW", e.message); } }'
  ```
- 期望：渲染器对缺字段的 value 输出降级文本，或至少抛一条能读懂的错。
- 实际：`renderReport(undefined)` → `TypeError: Cannot read properties of undefined (reading 'score')`；`renderReport({})` → `TypeError: Cannot convert undefined or null to object`；`byCategory: null` → 同样错。另外 `deai_scan` 传 `maxSuggestions: -1` 时 `execute` 正常返回，但建议列表静默为空（`lint` 侧把负值夹到 0），schema 没有 `minimum`，模型拿不到任何提示。
- 可达性说明：当前只有 `index.js:38-44` 的 `output.render` 会调用它，而 value 由 `execute` 产出、形状固定，所以这条在正常链路上不可达；这是防御缺失，不是现网故障。一旦有人把 `renderReport` 用作工具（如直接读 JSONL 报告）就会崩。
- 修复建议：`renderReport` 开头补齐默认值（`const r = result ?? {}`，`hits ?? []`，`byCategory ?? {}`），`samples` 用 `?? []`；工具参数加 `minimum: 0` 或把负值显式报错。

## 三、疑似但未证实

1. **`normalizeConfig` 不校验类型**（`lib/plan.js`）：`normalizeConfig({enabled:"false"})` 返回 `enabled:true`，`{level:123}` 回落 `strict`，`{injectLintTool:0}` 变 `true`。这都是真值判断，没有类型检查。但真实加载路径上 Cordis 会先用导出的 `Config` 校验：实测 `Config({enabled:"false"})` 抛 `$.enabled expected boolean but got false`（`level:123`、`extraRules:123` 同样抛），所以非法类型到不了 `normalizeConfig`。要证实「配置能带着错类型进来」必须跑完整 dsh 加载链路，超出本次只读审计范围，因此不列为确认缺陷。附带观测：schemastery 这条报错把字符串 `"false"` 打印成 `false`，看起来像「值就是布尔 false」，对排查有误导，但这不是本插件能改的。
2. **`ctx.effect` 的注销是否真的生效**：已确认 `ctx.systemPrompt.section()` 与 `ctx.tools.register()` 都返回 disposer（宿主 `packages/core/system-prompt/src/index.ts:454-463`、`packages/core/tools/src/index.ts:1063` 的 `register(...): () => void`），而 `index.js:59,61` 正是把回调返回值交给 `ctx.effect`，写法正确。但「插件卸载后 section 与工具确实消失」没有在真实 cordis 生命周期里跑过，无法证实。
3. **section 名 `deai:style` 冲突**：宿主 `section()` 在同一层重名会抛（`packages/core/system-prompt/src/index.ts:446-453` 的注释明示「duplicates within one layer … throw」），名字固定为 `deai:style`。本机其它插件是否已占用该名字，需要枚举 profile 里全部插件才能确定，本轮未做，无法证实冲突存在。
4. **孤代理对 / 缺 `/u` 的影响**：只有 `emoji-marker` 与 `let-us` 带 `u`，其余 23 条规则无 `u`。用孤代理 `"\uD83D"` 实测 `score=0`、无异常；没能构造出「缺 `/u` 导致实际错误匹配」的例子，故不列缺陷，仅记为待观察。
5. **嵌套/交错围栏**：`stripCode` 是单遍剥离，``` 与 ~~~ 混用、代码正文里含 ``` 的情形没有穷尽测试，可能有与 D5 同源的漏剥，本轮只确认了「未闭合」一例。
6. **`ab_test.mjs` 的退出码**：见第四章末尾，判定段被跳过时的退出码没有实测（那需要跑真实 API，本轮禁网）。

## 四、测试可信度评估

### 有效的断言

- `tests/checks.mjs` 的绝大多数是真的：规则 id 唯一（:33）、正则都带 `g`（:47）、分档边界（:106）、`stripCode` 三例含 `null`（:110-112）、`renderPrompt` 三档与 `extraRules`（:128-137）、`planRegistrations` 的开关回落（:147-156），以及 **:174-230 用 mock ctx 真的调用了 `apply()`** 并断言注册数量、section 名/order/文本长度、effect 标签 —— 这一段确实覆盖了 `index.js` 的主路径，不是自证 mock。
- `tests/regression_deai_style.py` 的 F、G 两组是端到端真断言：`order=10201`（:215）、`soft+top` 的 `order=1`（:220）、关开关零注册（:218-219）、AI 样例 ≥60（:245）、人写样例 ≤15（:246）、区分度 ≥45（:247）、三条指纹命中（:250-251）。E1/E2 用子进程退出码加 `TOTAL pass=/fail=` 正则（:185-188），可信。
- mock 的 schema 与真实 `defineTool` 编译结果一致：本轮用真实 `apply()` + mock ctx 取出工具对象，实测 `parameters = {"type":"object","properties":{"text":…,"maxSuggestions":{"type":"integer"}},"required":["text"]}`、`output.schema = {"type":"object","additionalProperties":true}`，与 `checks.mjs:245` 的断言吻合，**没有发现 mock 与真实编译产物的分歧**。

### 空转或过弱的断言

- `tests/checks.mjs:76`：`lint(ai,{maxSuggestions:2}).suggestions.length <= 2`。实现若恒返回 0 条建议也照样 PASS；应断言 `=== 2`。`:237` 同病（`<= 3`）。
- `tests/checks.mjs:161-162`（`apply` 是函数、`Config` 存在）：import 成功即恒真，无信息量。
- `tests/regression_deai_style.py:178`（D9：`raw.strip() not in ("[]","")`）：任何非空 patch 文件都成立，恒真。真正的风险（数组里少写条目导致注册落空）没测。
- `tests/checks.mjs:74`：人写样例 `hits.length <= 1`，而人写样例只有 296 字节，这条宽到发现不了新规则误伤。
- `tests/checks.mjs:209-211` 只断言 effect 标签数为 2、标签含 section/tool；mock 的 `effect` 不校验 disposer 语义，注销路径无人测。

### 缺失的关键用例（每条都对得上本轮的真缺陷）

- 没有任何**长度维度**用例 → 漏掉 D2（同密度下分数随长度衰减）。
- 没有**空白行洪水**的性能或时长用例 → 漏掉 D1（O(n²)）。
- 围栏只测了成对闭合（`checks.mjs:110` 用 `edge_code_only.txt`），无未闭合/截断用例 → 漏掉 D5。
- `emoji-marker` 无反例（非 emoji 的 `\uFE0F`、ZWJ）→ 漏掉 D6。
- 标定用例只覆盖 `not-x-but-y` / `explainer-frame` / `transition-cliche`（`checks.mjs:256-264`）；`both-sides`、`let-us` 这两条 hint 与实现不一致的规则完全没有正例覆盖 → 漏掉 D3、D4。
- 无 `renderReport` 异常形状用例，无 `maxSuggestions` 取 `0/-1/非整数` 的边界断言（`checks.mjs` 只测了 `<= 2`）→ 漏掉 D7 的一半。

### `tests/ab_test.mjs` 的判定逻辑

- :211-217：「基线高分样本（≥ high-bar）全部降到 < target」这条判据写作 `highFail = high.filter(p => !(p.deaiMean < TARGET))`，`ok: highFail.length === 0`。当 `high` 为空（没有任何题目的基线均分 ≥ 35，本插件第一轮报告里就有基线 5 分的题）时，这条**恒真空过**，只剩「平均分下降 ≥ min-drop-pct」一条撑着，可以对毫无区分度的改动给出 `VERDICT=PASS`。detail 里虽然会打印「高分样本 无」，但机器判定不看它。建议改成 `ok: high.length > 0 && highFail.length === 0`，或把样本不足单独判为 UNKNOWN 而不是 PASS。
- :197-228：`verdict.pass` 只在 `if (base && deai)` 分支里赋值，一旦所有请求失败或 `--repeats 0` 导致 rows 为空，整段判定被跳过，stdout 里连 `VERDICT=` 行都没有。以「退出码 0」或「没有 FAIL 行」为通过条件的 CI 会把它当成功。建议无论如何都打印 `VERDICT=UNKNOWN/FAIL`。
- `--min-drop-pct` / `--target` / `--high-bar` 无取值校验：`Number("abc") → NaN` 会让所有比较为假（fail-safe，尚可），但 `--min-drop-pct -100` 会让第一条判据恒 PASS。建议加范围断言。
- 该脚本的其余部分是真实的：:29-31 的默认阈值、按题均值汇总、:201-210 的 drop 百分比都是实算，不是自证。

### 第一章末尾那些「未发现问题」的实测依据

- 工具契约：用真实 `apply()` 取到工具后实测 `execute(undefined/null/{}/{text:123}/{text:null})` 全部抛 `ToolArgsError: invalid arguments: …`（可读），`maxSuggestions: 1.5/"3"` 抛「must be an integer」，`output.render` 对正常 value 返回 1 个 text 块。`execute` 内部不做防御（直接读 `args.text`），但包装层先校验，模型侧看到的是可读错误，不算缺陷。
- 数值：3000 例随机中英混排 fuzz，`score` 全为 [0,100] 整数、无 NaN/Infinity；2000 例对抗拼装最高 100，未越界。
- `planRegistrations` 的 order：`position:"top"` → 1，默认 `bottom` → 10201，与 `tests/regression_deai_style.py:215,220` 一致。
- `extraRules` 走字符串拼接而非模板插值：实测 `renderPrompt({level:"soft",extraRules:"禁止 {{foo}} 与 {{ bar }}。"})` 原样保留 `{{foo}}`/`{{ bar }}`，没有二次求值风险。
- `g` 标志状态泄漏：`lib/` 下没有 `exec(`/`test(` 调用（全部用 `match`/`matchAll`/`replace`），运行一轮 `lint` 后枚举所有 `RULES[i].re.lastIndex` 全为 0，无泄漏。
- 一次跑完 `lint()` 后 `RULES[i].re.lastIndex === 0`；`stripCode(null) === ""`；`lint("")`/`"   "`/`"\t\t"`/`"，。！？"`/单字符 全部 0 分 0 命中 0 异常。

## 附：本轮产出的临时文件

- `tmp/bug1/probe1.mjs`：边界输入、大输入计时、3000 例 fuzz、规则行为对照、`renderReport`/配置 schema/工具契约。
- `tmp/bug1/probe2.mjs`：逐个候选正则计时定位 D1、规则 source/hint 核对、裸零宽字符、围栏变体、`both-sides` 变体。
- `tmp/bug1/probe3.mjs`：分数上界对抗拼装、CRLF 空白行计时。
