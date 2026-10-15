// 第二轮红队探针 3：定点复现（长度不变性口径 / 提示词绕过 / 规避手法 / 报告误导）
import { lint, renderReport, stripCode } from "../../lib/lint.js";
import { readFileSync } from "node:fs";

const out = {};
const F = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const R = (r) => ({ chars: r.chars, score: r.score, band: r.band, rw: r.ruleWeight, mw: r.metricWeight, hits: r.hits.map((h) => h.id + "x" + h.count) });

/* 1. 官方「长度不敏感」用例到底测的是什么 */
const AI_FIXTURE = F("../../tests/fixtures/ai_style_sample.txt");
out.lenFixture = {
  rawLen: AI_FIXTURE.length,
  x1: lint(AI_FIXTURE).score,
  x2: lint(AI_FIXTURE.repeat(2)).score,
  x5: lint(AI_FIXTURE.repeat(5)).score,
  x20: lint(AI_FIXTURE.repeat(20)).score,
};
// 真实「长文免检」场景：同一段 AI 腔 + 中性填充（round1 probe3 的 out.thin 口径）
const AI_SEG = "作为一个中年人，我不觉得故宫是最标志性的北京。对我来说是胡同口那家早点铺。一般来说，游客不会往那儿去，可那才是日子。";
const FILL = "今天的天气说不上好，云压得很低。我在楼下站了一会儿就上去了。锅里水开了，我把面下进去，搅了两下，盖上盖子。窗外有小孩在喊，听不清喊什么。";
out.lenDiluted = {};
for (const n of [0, 1, 4, 19, 99]) out.lenDiluted["dilute_x" + (n + 1)] = R(lint(AI_SEG + FILL.repeat(n)));

/* 2. 报告误导：0 分文本的 renderReport 全文 */
const CLEAN_STRUCT = `## 结论

先把结论放在前面：这件事值得做，但不要现在做。

## 理由

**时机不对。** 团队刚经历一次大改版，现在启动第二个高风险项目，注意力会被切碎。

**收益不明。** 目前没有数据能说明它能把转化率提高多少，全靠拍脑袋。

## 建议

先做一个两周的小验证，只覆盖一条业务线。跑完再决定是否扩大范围。`;
out.reportZeroFull = renderReport(lint(CLEAN_STRUCT));
out.reportZeroHits = lint(CLEAN_STRUCT).hits.map((h) => `${h.id}/${h.kind}/${h.evidence ?? "-"}x${h.count}/sev${h.sev}`);

/* 3. service-close 定点：为什么单独一句「希望对你有帮助」不命中 */
out.serviceClose = {
  bare: R(lint("希望对你有帮助。")),
  inPara: R(lint("先说结论。\n\n希望对你有帮助。")),
  appendedToStruct: R(lint(CLEAN_STRUCT + "\n\n希望对你有帮助。")),
  variant: R(lint(CLEAN_STRUCT + "\n\n希望这些内容对你有所帮助。")),
  substringCheck: /希望对(你|您)(有所)?帮助/.test(CLEAN_STRUCT + "\n\n希望对你有帮助。"),
};

/* 4. 规避手法：零宽字符插入套话关键词 */
const CLICHE = "首先，我们需要明确目标。其次，拆解任务。综上所述，这是一套行之有效的方法论。感谢大家的阅读。";
out.evasion = {
  plain: R(lint(CLICHE)),
  zwsp: R(lint(CLICHE.replace(/首先/g, "首\u200B先").replace(/综上/g, "综\u200B上").replace(/感谢/g, "感\u200B谢"))),
  thinSpace: R(lint(CLICHE.replace(/首先/g, "首\u2009先").replace(/综上/g, "综\u2009上"))),
  softHyphen: R(lint(CLICHE.replace(/首先/g, "首\u00AD先").replace(/综上/g, "综\u00AD上"))),
  homoglyphColon: R(lint("以下是三种方法\uFF1A\n- 甲\n- 乙\n- 丙")),
};

/* 5. keycap emoji 列表（常见 AI 排版）*/
out.keycap = {
  short: R(lint("1️⃣ 明确目标\n2️⃣ 拆解任务\n3️⃣ 逐项验收")),
  realistic: R(lint(
    `1️⃣ 先把范围收窄。只覆盖一条业务线，两周跑完。\n2️⃣ 再定验收口径。谁来测、怎么算通过，提前写清楚。\n3️⃣ 最后才谈扩大。没拿到数据之前，不要承诺任何时间点。`
  )),
  contrastPlainNumber: R(lint("1. 明确目标\n2. 拆解任务\n3. 逐项验收")),
};

/* 6. 半角英文「Key: value」被当作 colon-definition */
const EN = "Install: npm i\nConfig: edit yaml\nBuild: npm run build\nTest: npm test\nDeploy: npm run deploy\nNotes: read the docs";
out.colonEN = {
  english: R(lint(EN)),
  englishPlusOneRule: R(lint(EN + "\nFirst, we should clarify the goal. In summary, that is the plan.")),
  mixedCN: R(lint("说明：这是第一项\n范围：覆盖全部模块\n时间：两周内完成\n负责人：老张\n交付：可用版本\n风险：依赖第三方")),
};

/* 7. 提示词绕过（静态论证 + 分点指令的后果演示） */
out.promptBypass = {
  strictRulesMentionBullet: /不要列 bullet/.test(F("../../lib/prompt.js")),
  strictOnlyBelow200: /低于 200 字的回答不要分小标题/.test(F("../../lib/prompt.js")),
  // 若用户要求「请用分点列表详细说明」，模型产出形态等价于下面这段；检测器给几分：
  bulletStyleAnswerScore: lint("以下是三种方法：\n- 番茄工作法，25 分钟一个周期\n- 两分钟法则，能立刻做完就立刻做\n- 时间块，把同类任务集中处理").score,
  noOutputGate: "静态阅读 index.js:50-63：apply() 只做 systemPrompt.section() 与 tools.register()，没有任何 llm/stream、assistant-stream 或输出改写钩子",
};

console.log(JSON.stringify(out, null, 1));
