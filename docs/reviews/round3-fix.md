# 第三轮返工记录（v1.2.0 → v1.3.0）

靶子版本：v1.2.0（`lib/ruleset.js` SHA256 前缀 `AAF52F9F`）。
输入：`round3-red.md`（24,029 B，11 条失守）、`round3-bug.md`（24,369 B，11 条缺陷 + 17 组变异）。
基线：`checks` 126/126、`corpus` 20/20、`regression` 35/35。
返工后：`checks` **154/154**、`corpus` **20/20**、`regression` **35/35**、变异测试 **8/8 全杀**。

---

## 一、本轮的核心：文档说「排版不定罪」，代码却在定罪

### 症状

`README.md:155-159` 与 `docs/验收报告.md:332` 写着「排版是观察信号，用词与句式才是定罪证据」。
但 `lib/ruleset.js` 里五条 `cat:"fmt"` 的正则规则（`bold-label-line` sev3、`bold-start-line` sev2、
`bold-inline-label` sev2、`bold-heading` sev2、`arrow-symbol` sev1）**没有 `evidence` 字段**，
全部直接累加进 `ruleWeight` —— 只有 `METRICS` 才有证据分层。

红队探针：`RULES.filter(r => r.evidence !== undefined)` 返回空数组。
后果：**两条 `**注意**：xxx` 就把 31 字的人写说明文字顶到 60 分（中等 AI 腔）**。

### 误报实测（第三轮 FP3-01）

| 人类样本 | 加粗标签数 | 返工前分数 |
|---|---|---|
| 技术文档 | 1 / 2 / 3 | 29 / 47 / 61 |
| 产品说明书 | 2 / 4 | 52 / 75 |
| 周报 | 2 | 52 |
| 同长度但去掉冒号 | 2 / 4 | 0 ~ 14 |

这条同时证伪了 `round2-fix.md` 与验收报告 §10.2 的「人写 FP 最大 33 分、0 条 ≥36」——
该缺陷自 v1.1.0 起就存在，第二轮只测了没有加粗标签的样本。

### 处置

1. 五条 fmt 规则全部加 `evidence: "format"`，`lib/lint.js` 的规则循环按
   `rule.evidence === "format"` 分流到 `formatSpans`，与定罪区间分开 `mergeSpans`，
   只进 `formatWeight`（受 `formatNudge` 约束：≥5 才有分，封顶 25）。
2. 新增 `card-ratio` 指标（`cat:"fmt"`, sev3, `evidence:"format"`）：衡量「整篇几乎只剩
   `- **标签**：内容` 卡片行」的比例，`chars ≥ 120 且 cardLines ≥ 3` 时才计算。
   **它同样只进观察档**——因为红队实测人类说明书、产品简介、技术文档同样是纯卡片结构，
   与 AI 样本在结构上不可分。
3. `checks.mjs` 新增断言 14.1：`RULES.filter(r => r.cat === "fmt").every(r => r.evidence === "format")`。
   变异测试 M22（去掉 `bold-label-line` 的 evidence）→ 2 条断言变红。

### 代价（明确记录）

纯排版的 AI 回答不再被定罪。`tests/corpus/ai_zh.json` 的 A4（加粗小标题列表，
即坊间说的「DeepSeek 最强格式指纹」）返工前 79 分，现在 **25 分（轻微）**，
其 `min` 阈值由 40 下调为 20，`note` 改写为「刻意边界：人类说明书/产品简介同构，只能作观察信号」。

**这不是妥协失败，而是三轮攻击后得到的事实**：`- **标签**：内容` 在人类技术写作里同样常见，
任何据此定罪的阈值都必然误伤。真正能区分的只有语言层（套话、反转句、客服结尾）与
「整篇只剩卡片、一句完整叙述都没有」——后者也已经在人类文档里被找到反例。

---

## 二、其余失守的逐条处置

| 编号 | 问题 | 处置 |
|---|---|---|
| FN3-01 | `service-close` 的 `以上就是(本次\|这篇\|今天)` 放走「以上就是我的回答。」（9 字 = 0 分） | 正则放宽为裸 `以上就是` |
| FN3-02 | `希望对(你\|您)(有所\|有)?帮助` 不允许插词，放走「希望这些内容对你有帮助。」（12 字 = 0 分） | 改为 `希望[^\n。！？]{0,6}对(你\|您)(有所\|有)?帮助` |
| REP3-01 / FN3-03 | `analyzed = chars >= 10`：9 字强信号稿得 48 分却标 `analyzed=false`，报告同一行打印「48/100（无正文可评）」并丢掉全部命中与建议 | `lib/lint.js` 改为 `analyzed: m.chars > 0`；`renderReport` 的 `analyzed` 判据同时要求 `chars > 0`；命中行加 `[定罪]/[观察]` 标注 |
| FP3-02 | `abstract-noun-stack` 无去重，「维度上」×5 可刷到 65 分 | 加 `dedupe: true`（与 `buzzword` 同策略：按不同词计数） |
| FP3-03 | `stripCode` 漏掉四空格缩进代码块与 `> ``` ` 引用块内围栏（均 65 分 heavy，且两种代码块 `analyzed` 口径冲突） | 围栏正则允许前置引用块标记 `^(?:[ \t]*>[ \t]*)*`；新增缩进代码块剥离（排除嵌套列表项）；行内代码改为跨行匹配 `/`[^`]*`/gs` |
| REP3-03 | `README.md:11`「34 条正则规则 + 6 个统计指标」实测为 32 + 11 | README 更正，并加断言 14.2/14.3 做数量门禁 |
| REP3-04 | 第二轮新增的「卡片结构禁令」只在 `STRICT_EXTRA`，`soft` 档拿不到；且 `CORE.slice(0, 10)` 连核心第 10 条一起丢掉 | 该条移入 `CORE`（核心第 11 条），`soft` 改为 `[...CORE]`；`strict` 严格档变为 12–16 条 |
| L1 | `bandOf(NaN)` 落到 heavy，与 `renderReport` 把 NaN 当 0 分的口径相反 | `bandOf` 对非有限值返回 clean 档 |
| CRLF | 行尾 `\r` 使 `TABLE_RE` 的 `$` 锚点失效、CRLF 表格识别不到 | `stripCode` 入口加 `.replace(/\r\n?/g, "\n")` |

## 三、测试可信度：把 7 条零覆盖路径补上

第三轮缺陷审计对 v1.2.0 做了 17 组变异，**7 条零覆盖**（改成 v1.1.0 的旧写法，
`checks.mjs` 与 `corpus.mjs` 仍全绿）：`formatNudge` 阈值 5、`formatNudge` 封顶 25、
`metricBonus` 的 `ruleWeight===0` 门、`metricBonus` 上限 4、`k` 的长度项、
`scope` 用 `text.length` 作坐标、`uplift-close` 删裸「希望」。
另外恒真/弱断言 107/126（第二轮 93/103），真正约束分数大小的只有 19 条。

`tests/checks.mjs` 新增第 14 组共 28 项（14.1–14.28），其中 14.28 是一条复合断言：

```js
// 8 段等长自然段 + 1 处 transition-cliche（rw=1，rhythmWeight=10）
check("14.28 节奏重、定罪轻时不上分",
  rhythmHeavy.ruleWeight === 1 && rhythmHeavy.rhythmWeight >= 8 && rhythmHeavy.score <= 18,
  ...);
```

现状 16 分；`metricBonus` 上限改成 40 → 22 分；`k` 去掉长度项 → 24 分。一条断言同时杀死两个变异体。

### 变异测试台

`tmp/mut3/run_mutations.py`：对 `lib/*.js` 做正则替换变异 → 跑 `checks.mjs` 与 `corpus.mjs`
→ 统计 FAIL → 用原始字节还原 → 最后自证还原后仍全绿。结果写入 `tmp/mut3/mut_result.json`。

| 变异 | 结果 |
|---|---|
| M1 `formatNudge` 阈值 5 → 0 | KILL（1 条断言） |
| M3 `formatNudge` 封顶 25 → 100 | KILL（1 条） |
| M4 去掉 `metricBonus` 的 `ruleWeight===0` 门 | KILL（1 条） |
| M4b `metricBonus` 上限 4 → 40 | KILL（1 条，断言 14.28） |
| M9 `k` 去掉长度项 | KILL（1 条，断言 14.28） |
| M14 `emoji-marker` 升回 `strong` | KILL（3 条） |
| M16 `uplift-close` 加回裸「希望(能\|可以\|你)」 | KILL（1 条） |
| M22 `bold-label-line` 去掉 evidence（回到 v1.2.0 行为） | KILL（2 条） |

**变异测试本身踩的两个坑（记录以免重犯）**：
1. 断言样本里「希望」必须落在结尾作用域内（`scope:"closing"` 取 `start >= text.length * 0.65`），
   最初 36 字的样本把「希望」放在 index 23，恰好被过滤掉，变异体存活。
2. 变异要真实：最初把旧分支写成 `希望(能|可以)`，而样本是「希望**你**能喜欢」——
   `你` 插在中间，变异体根本不匹配，于是「存活」是假象。改成 `希望(能|可以|你)` 后才真正验证。

## 四、仍未解决

1. **提示词绕过率未实测**：第三轮的两位子代理都无法真调模型（工具壳内凭据被擦除），
   「用户明确要求分点列表时，核心第 11 条守不守得住」只能靠真模型 A/B 回答。
2. **`METRICS[].threshold` 是死字段**：11 个指标都写进了阈值常数，但 `measure()` 各自硬编码，
   文档性的 `threshold` 不参与计算（不影响行为，属可读性债）。
3. **`corpus.mjs` 对细粒度变异 0 杀**：它只有 20 条样本、每类一个阈值，设计上就是粗尺子；
   细粒度回退由 `checks.mjs` 第 14 组负责。
4. **`plan.js` 的三个既有小问题**（N9/N10/N11：`level` 白名单与 `position` 回退的边角）未处置。
5. **没有真实人写的「AI 腔样本集」**：所有 AI 样本都是本项目自造的，存在「用自己造的样本
   验证自己的检测器」的循环；唯一的外部标尺是 `tests/corpus/` 的 20 条人工标注。

## 五、结论

第三轮的攻击面与前两轮已经不同：红队不再能打穿设计（未打穿 7 组，含 1MB 文本 65ms、
ZWJ 归一化、四反引号与 CRLF 剥离、性能无回退），找到的问题集中在
**「文档承诺与实现不符」**与**「测试无法证明修复真实存在」**两类。
这两类都在本轮闭合：实现被改成与承诺一致，28 条新断言 + 8 组变异杀死把承诺焊死。
