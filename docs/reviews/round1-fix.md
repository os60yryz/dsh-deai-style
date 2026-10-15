# 第一轮「优化」记录（对红队与缺陷审计的处置）

- 日期：2026-10-16
- 基线版本：v1.0.3（`lib/ruleset.js` SHA256 前缀 `5EEF41C5775DD821`）
- 修正后版本：v1.1.0
- 输入报告：[round1-red.md](round1-red.md)（红队攻击，12 条失守 + 14 条规则级缺陷 + 5 条设计级质疑）、[round1-bug.md](round1-bug.md)（代码级缺陷审计，7 条）
- 复现脚本（已入库，在仓库根目录运行）：`tests/red1/probe{1,2,3}.mjs`、`tests/bug1/probe{1,2,3}.mjs`，输出写在当前目录的 `out*.json`（已在 `.gitignore`）；另有 `tests/corpus.mjs`、`tests/checks.mjs`。

## 一、评分模型（两条高缺陷的根因）

红队与审计各自独立打中了同一个点：**旧分数是「规则权重密度 + 结构指标加成」，而两者都被长度和计数封顶污染。**

旧公式（v1.0.3）：

```js
ruleWeight = Σ sev * min(count, 2)          // lint.js:103 计数封顶
density    = ruleWeight * 1000 / max(chars, 300)   // lint.js:107 分母线性增长
ruleScore  = 100 * density / (density + 20)
metricBonus = min(10, metricWeight * 1.5)   // lint.js:109 结构指标可独立定罪
score = ruleScore + metricBonus
```

新公式（v1.1.0，`lib/lint.js`）：

```js
K = 4.5 + chars / 100
ruleScore = ruleWeight === 0 ? 0 : 100 * (1 - Math.exp(-ruleWeight / K))   // 饱和，不再线性稀释
metricBonus = ruleWeight === 0 ? 0 : Math.min(4, metricWeight)             // 只能加成，封顶 4
strongScore = (ruleWeight === 0 && strongWeight > 0) ? 100*(1-exp(-strongWeight/K)) : 0
score = max(ruleScore, strongScore) + metricBonus
```

三处关键改动及理由：

1. **饱和曲线代替线性密度**：`1 - e^(-w/K)` 是凹函数，命中数增长时分数快速逼近上限，不再被长度线性摊薄。同一份 AI 样例 ×1/×2/×5/×20 的分数由 `98/93/76/43` 变为 `100/100/100/100`；`lint("\n".repeat(100000))` 由 7078ms 降到 20ms 的另一半原因见下。
2. **结构指标降为加成**：`metricBonus` 必须有语言证据（`ruleWeight > 0`）才生效，封顶由 10 降到 4。红队 `HUMAN-LONG`（278 字人写随笔、零 AI 腔词）由 **43 分降到 15 分**——正是这一条在旧版里把工整的人写文本推过了 35 分线。
3. **计数封顶放宽**：`min(count, 2)` → `min(count, 3)`（`lib/lint.js` 与 `tests/checks.mjs` 的 `weightOf` 同步），避免「同一模板重复 90 次」与「出现 2 次」同权。

## 二、`evidence` 分层：什么可以独立定罪

第一轮修完后又出现一组新误报（换灯泡步骤清单 52 分、会议纪要 52 分、加粗强调 36 分），根因是「排版工整 = AI」这个假设本身不成立——人类写步骤清单和数据表同样工整。于是给指标加 `evidence` 字段，只有 `strong` 能独立成立：

| evidence | 指标 | 能否在没有语言证据时独立定罪 |
| --- | --- | --- |
| `strong` | `emoji-marker`（行首 emoji 当项目符号 ≥2 次） | 能。把 emoji 当 bullet 用在正文回答里，人类极少这么做 |
| `format` | `bold-density`、`bullet-ratio`、`heading-ratio`、`table-ratio`、`colon-definition`、`emoji-density` | 不能，只加成 |
| `rhythm` | `emdash-density`、`sentence-burstiness`、`paragraph-uniform` | 不能，只加成 |

`colon-definition` 与 `emoji-marker` 由 `RULES`（正则）改为 `METRICS`（比例指标）：它们靠计数而不靠单次出现，避免「一处加粗 64 分」「一个 emoji 25 分」的三重计分。

## 三、逐条处置

### 3.1 红队 12 条失守（判据：误报须 <36 分，漏报须 ≥20 分）

| 编号 | 样例 | v1.0.3 | v1.1.0 | 处置 |
| --- | --- | --- | --- | --- |
| FP-01 | 「作为一个中年人…标志性…一般来说」58 字 | 57 | 18 | 删 `translationese` 的 `作为一个` 分支、删 `significance-filler` 的 `标志性` |
| FP-02 | 「白菜、萝卜和土豆」 | 25 | 0 | `triadic-list` 要求各项 ≥5 字 |
| FP-03 | 人写议论文「首先/其次」 | 40 | 33 | `transition-cliche` sev 3→1 |
| FP-04 | 换灯泡步骤清单 | 23 | 0 | `bullet-ratio` 降为只加成 |
| FP-05 | 会议纪要行首标签 | 25 | 0 | `colon-definition` 改比例指标并要求冒号后是短解释 |
| FP-06 | 「体系的问题」 | 14 | 18 | `abstract-noun-stack` sev 降到 1，不再扩大 |
| FP-07 | 聊天里两个 ✅ | 40 | 0 | 见 3.3 D6：`emoji-marker` 要求行首 + 不单用裸 VS16 |
| FP-08 | 「等等」 | 14 | 18 | `enumerate-all` 保持 sev 1 |
| FP-10 | 「作为一个中国人」 | 33 | 0 | 同 FP-01 |
| HUMAN-LONG | 人写 278 字随笔 | 43 | 15 | `sentence-burstiness`/`paragraph-uniform` 降为只加成 |
| FN-01 | 纯 Markdown 表格 | 0 | 0 | **刻意保留**：见第五节 |
| FN-12 | 纯列表 AI 回答 | 23 | 0 | **刻意保留**：见第五节 |

### 3.2 红队 8 条漏报（12 条里除 FN-01/FN-04/FN-12 外）

| 编号 | 样例 | v1.0.3 | v1.1.0 | 处置 |
| --- | --- | --- | --- | --- |
| FN-02 | 「以上就是…感谢大家的阅读」 | 0 | 70 | `service-close` 去掉主语限制并补上「以上就是…感谢阅读」类收尾声明 |
| FN-03 | 「让我们一起来聊聊」 | 0 | 46 | 删 `let-us` 的 `(?=[^\p{Script=Han}])` 前瞻 |
| FN-05 | 「✨…👉」 | 0 | 56 | emoji 白名单改为 `\p{Extended_Pictographic}` |
| FN-06 | 「第一，明确目标；第二，…」 | 0 | 56 | `transition-cliche` 增补 `第[一二三四五六]` |
| FN-07 | 「不是做得更快；而是做得更少」 | 0 | 71 | `not-x-but-y` 允许跨一个标点 |
| FN-08 | 无冒号 `- **性能** 提升 30%` | 10 | 95 | `bold-label-line` 允许行首加粗标签后接空格 |
| FN-09 | 1760 字重复模板词 | 38 | 100 | 计数封顶放宽 + 饱和曲线 |
| FN-10 | 时代开场 + 升华结尾 | 63 | 63 | 保持 |
| FN-11 | `**核心结论**：` | 69 | 83 | 去重后仍强命中 |

### 3.3 缺陷审计 7 条

| 编号 | 位置 | 问题 | 处置 |
| --- | --- | --- | --- |
| D1（高） | `lib/lint.js:20` | 表格行正则 `^\s*\|.*\|\s*$` 的 `\s` 跨行回溯，10 万换行 7078ms | 正则改 `[ \t]` 并逐行判定；`stripCode` 重写。实测 10 万换行 7078ms → 20ms |
| D2（高） | `lib/lint.js:103/107/108` | 分子封顶 + 分母线性 → 文本越长分越低 | 饱和曲线替代线性密度；×20 由 43 → 100 |
| D3（中） | `lib/ruleset.js:141` | `let-us` 前瞻要求「让我们」后不是汉字，实际全漏 | 删前瞻 |
| D4（中） | `lib/ruleset.js:76` | `both-sides` 第三分支多一个「还」，`既快又稳` 漏报、正常口语误报 | 只保留「一方面…另一方面」 |
| D5（低） | `lib/lint.js:16-20` | 未闭合围栏不剥离（得 33 分） | 围栏须独占行开头，未闭合剥到文末；实测 33 → 0 |
| D6（低） | `lib/ruleset.js:162` | 字符类含裸 `\uFE0F`，单独出现即 25 分 | 改 `\p{Extended_Pictographic}` 并有 `u` 标志 |
| D7（低） | `lib/lint.js:155-176` | `renderReport` 对异常入参抛 TypeError；`maxSuggestions:-1` 静默返回 0 | 加类型守卫与改写建议；`maxSuggestions` 钳到 0 |

### 3.4 测试可信度（红队与审计都点了名）

| 问题 | 处置 |
| --- | --- |
| `tests/checks.mjs:76/240` 的 `<= 2`、`<= 3` 恒真（实现恒返 0 条也过） | 加下界：`>= 1 && <= 2`、`>= 1 && <= 3` |
| `tests/checks.mjs:74` `人写样例命中 <= 1 条` 恒真 | 加 `&& score < 35` |
| `tests/regression_deai_style.py:190` 用例数下界只有 60 | 提到 100（现 103），套件缩水即 FAIL |
| 完全没有长度维度与性能用例 | 新增第 12 组：长度不敏感（×1/×2/×5/×20 均 ≥70、极差 ≤15）、性能（10 万换行 <800ms）、未闭合围栏、表格不再删空、`renderReport` 异常入参、`maxSuggestions` 非法值 |
| `tests/ab_test.mjs:211-217` 在无基线高分样本时判据空过 | 新增「基线存在 ≥35 的高分样本」前置判据，并新增「逐样本达标率 ≥80%」——均值会把个别轮次失守掩盖掉（红队据此证伪了原验收报告的「逐条全部达标」） |

## 四、`stripCode` 重写要点

旧实现把表格整段删空（纯表格回答 `chars=0 score=0`），且围栏配对不稳。新实现：

1. 围栏须**独占行开头**（`^[ \t]*``` `），未闭合则剥到文末；
2. 表格**保留内容**，只在 `computeMetrics` 里计入 `tableLines`，由 `table-ratio` 指标处理；
3. 行内代码、引用块只做轻量处理，不删正文。

## 五、刻意保留的三个边界（不打算修）

1. **纯表格 / 纯列表回答不判 AI 腔（FN-01、FN-12）**。红队指出「纯 Markdown 表格 AI 回答得 0 分」属实，但人类写数据表、写步骤清单同样整齐，仅凭排版无法区分。给排版定罪必然换来成片误报（第一轮实测：换灯泡步骤 52 分、会议纪要 52 分）。**取舍**：宁可漏掉「只有排版没有语言特征」的样本，也不误伤格式工整的人类文本。这类样本如果同时带套话，仍会被规则命中。
2. **四项顿号排比不判（FN-04）**。「需要时间、需要耐心、需要方法、需要运气」和人类修辞「苹果、香蕉和橘子」结构相同，`triadic-list` 无法区分，只在出现「和/与/及」连接的三段式时命中。
3. **稀疏命中的分数仍随长度略降**（固定 1 处套话：58 字 18 分 → 10258 字 5 分）。这是饱和曲线的代价，也是**期望行为**：一篇万字长文里孤立出现一个「此外」，不该被判成 AI 腔。真正需要防的「长文整体免检」已由第一节的 ×20 用例覆盖（100 分）。

## 六、验证结果

| 套件 | 结果 |
| --- | --- |
| `node tests/checks.mjs` | **TOTAL pass=103 fail=0**（新增 8 条长度/性能/鲁棒性断言） |
| `python tests/regression_deai_style.py` | **RESULT=PASS**（35 assertions，用例数下界提到 100） |
| `node tests/corpus.mjs` | **CORPUS pass=20 fail=0**（12 条人写 ≤30 + 8 条 AI 腔 ≥40） |
| 红队探针 `tmp/red1/` | 误报最高 33（FP-03），12 条失守中 9 条已修复，3 条为上述刻意边界 |
| 缺陷探针 `tmp/bug1/` | D1 7078ms→20ms；D2 ×20 43→100；D5 33→0；D6/D7 见 3.3 |

## 七、仍未处理（诚实记录）

1. **无输出侧兜底**：`index.js` 只做 system prompt 注入 + 工具注册，模型可以被「请用分点列表详细说明」这类指令绕过（`tmp/red1/out3.json` 的 `promptHasNoOutputGate: true`）。host 的 `agent/assistant-stream` 是 emit 事件，无法改写助手输出；要做输出侧拦截只能走 `llm/stream` 包装，风险与收益待第二轮评估。
2. **打分口径自证循环**：同一套 `RULES` 同时充当干预依据、度量尺和验收判据。人写语料最高 30 分、注入组均值 16.3 分的对比只能说明「规则命中的东西变少了」，不能独立证明「更像人写」。
3. **阈值 35 无外部标定**，仍是工程取值。
4. **`deai_scan` 的 token 开销未计量**。
5. 本轮的 A/B 复跑结果见 `docs/验收报告.md`。
