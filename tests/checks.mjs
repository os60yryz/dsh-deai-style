// dsh-deai-style 单元检查（node ESM）
// 覆盖：规则库自检 / 检测器区分度与边界 / 提示词渲染 / 注册计划 / mock ctx 开关两套断言 / 工具执行
// 用法：node tests/checks.mjs   （退出码 0 = 全 PASS）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { RULES, METRICS, CATEGORY_LABELS } from "../lib/ruleset.js";
import { lint, bandOf, stripCode, renderReport, BANDS } from "../lib/lint.js";
import { renderPrompt, LEVELS } from "../lib/prompt.js";
import { planRegistrations, normalizeConfig, SECTION_NAME, TOOL_NAME } from "../lib/plan.js";
import { apply, inject, name as pluginName, Config } from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (f) => readFileSync(join(here, "fixtures", f), "utf8");

let pass = 0;
let fail = 0;
const lines = [];
function check(label, ok, detail) {
  if (ok) {
    pass += 1;
    lines.push(`PASS ${label}`);
  } else {
    fail += 1;
    lines.push(`FAIL ${label}${detail === undefined ? "" : ` :: ${detail}`}`);
  }
}

// ---------- 1. 规则库自检 ----------
const ruleIds = RULES.map((r) => r.id);
check("规则库条目 >= 25", RULES.length >= 25, RULES.length);
check("规则 id 唯一", new Set(ruleIds).size === ruleIds.length);
check(
  "规则字段齐全",
  RULES.every(
    (r) =>
      typeof r.id === "string" &&
      CATEGORY_LABELS[r.cat] !== undefined &&
      r.sev >= 1 &&
      r.sev <= 3 &&
      r.re instanceof RegExp &&
      typeof r.hint === "string" &&
      r.hint.length > 0,
  ),
);
check("规则正则均带 g 标志", RULES.every((r) => r.re.flags.includes("g")));
check(
  "结构指标字段齐全",
  METRICS.length >= 5 &&
    METRICS.every((m) => typeof m.id === "string" && CATEGORY_LABELS[m.cat] !== undefined && m.sev >= 1 && m.sev <= 3 && typeof m.measure === "function"),
);

// ---------- 2. 检测器区分度 ----------
const ai = fixture("ai_style_sample.txt");
const human = fixture("human_style_sample.txt");
const code = fixture("edge_code_only.txt");
const aiR = lint(ai);
const humanR = lint(human);
const emptyR = lint("");
const codeR = lint(code);
const gap = aiR.score - humanR.score;
const weightOf = (h) => h.sev * Math.min(h.count, 3);

check(`AI 样例分数 >= 60（实际 ${aiR.score}）`, aiR.score >= 60);
check(`人写样例分数 <= 15（实际 ${humanR.score}）`, humanR.score <= 15);
check(`区分度 >= 45（实际 ${gap}）`, gap >= 45);
check("空文本 = 0 分且无命中", emptyR.score === 0 && emptyR.hits.length === 0);
check(`纯代码样例 <= 10 分（实际 ${codeR.score}）`, codeR.score <= 10);
check("AI 样例命中加粗列表指纹", aiR.hits.some((h) => h.id === "bold-label-line"));
check("AI 样例命中反转句", aiR.hits.some((h) => h.id === "not-x-but-y"));
check("AI 样例命中客服结尾", aiR.hits.some((h) => h.id === "service-close"));
check("AI 样例命中结构指标", aiR.hits.some((h) => h.kind === "metric"));
check(`人写样例命中 <= 1 条且低于 35 分（实际 ${humanR.hits.length} 条 / ${humanR.score} 分）`, humanR.hits.length <= 1 && humanR.score < 35);
check("结果字段齐全", typeof aiR.band === "string" && typeof aiR.bandLabel === "string" && !!aiR.counts && !!aiR.byCategory && Array.isArray(aiR.suggestions));
{
  const limited = lint(ai, { maxSuggestions: 2 }).suggestions.length;
  check(`建议条数受 maxSuggestions 限制（实际 ${limited}）`, limited >= 1 && limited <= 2);
}
check("命中按加权严重度降序", aiR.hits.every((h, i) => i === 0 || weightOf(aiR.hits[i - 1]) >= weightOf(h)));
check("分数为 0-100 整数", Number.isInteger(aiR.score) && aiR.score >= 0 && aiR.score <= 100);

// ---------- 2b. 典型开场/结尾套话必须命中 ----------
const openerCases = [
  ["这是一个非常好的问题！", "platitude-open"],
  ["好问题！我们先看数据。", "platitude-open"],
  ["感谢你的提问。", "grateful-open"],
  ["在当今这个快速发展的时代，", "era-opener"],
  ["随着人工智能的发展，", "era-opener"],
  ["如果还有其他问题，欢迎再来。", "service-close"],
];
for (const [sample, rid] of openerCases) {
  check(`开场/结尾套话命中 ${rid} :: ${sample}`, lint(sample).hits.some((h) => h.id === rid));
}
check("正常句子不误伤 platitude-open", !lint("这个问题的答案取决于载荷。").hits.some((h) => h.id === "platitude-open"));
check("正常句子不误伤 era-opener", !lint("他把车送去修了。").hits.some((h) => h.id === "era-opener"));

// ---------- 3. 分档边界 ----------
const bandCases = [
  [0, "clean"],
  [15, "clean"],
  [16, "slight"],
  [35, "slight"],
  [36, "medium"],
  [60, "medium"],
  [61, "heavy"],
  [100, "heavy"],
];
check("分档边界正确", bandCases.every(([s, k]) => bandOf(s).key === k));
check("分档表 4 档", BANDS.length === 4);

// ---------- 4. 代码剥离 ----------
check("stripCode 去代码块", !stripCode(code).includes("def normalize"));
check("stripCode 去行内代码", !stripCode('前 `x = 1` 后').includes("x = 1"));
check("stripCode 对 null 安全", stripCode(null) === "");

// ---------- 5. 报告渲染 ----------
const aiReport = renderReport(aiR);
const emptyReport = renderReport(emptyR);
check("报告含评分", aiReport.includes(`${aiR.score}/100`));
check("报告含命中明细", aiReport.includes("命中明细"));
check("报告含改写建议", aiReport.includes("改写建议"));
check("空稿报告写明「没有可分析的正文」", emptyReport.includes("没有可分析的正文"));
check("空稿 analyzed=false（区别于「写得干净」）", emptyR.analyzed === false);
check("干净中文稿报告写明未命中", renderReport(lint("今天下午三点在楼下便利店买了瓶水。")).includes("未命中任何规则"));
check("报告为非空纯文本", typeof aiReport === "string" && aiReport.length > 80);

// ---------- 6. 提示词渲染 ----------
const offPrompt = renderPrompt({ level: "off" });
const soft = renderPrompt({ level: "soft", toolName: null });
const strict = renderPrompt({ level: "strict", toolName: TOOL_NAME });
const strictNoTool = renderPrompt({ level: "strict", toolName: null });
check("level=off 渲染为空串", offPrompt === "");
check("strict 含核心约束", strict.includes("不用模板连接词") && strict.includes("不是X，而是Y"));
check("soft 不含 strict 扩展", !soft.includes("自然段优先"));
check("strict 含 strict 扩展", strict.includes("自然段优先"));
check("soft 条款数少于 strict", soft.split("\n").length < strict.split("\n").length);
check("toolName 生效时出现工具名", strict.includes(TOOL_NAME));
check("toolName 为 null 时不出现工具名", !strictNoTool.includes(TOOL_NAME));
check("extraRules 追加到末尾", renderPrompt({ level: "soft", extraRules: "少用感叹号。" }).trimEnd().endsWith("少用感叹号。"));
check("空白 extraRules 不追加", !renderPrompt({ level: "soft", extraRules: "   " }).includes("补充要求"));
check("LEVELS 三档", JSON.stringify(LEVELS) === JSON.stringify(["off", "soft", "strict"]));

// ---------- 7. 注册计划 ----------
const orderMap = { personaPrefix: 0, personaSuffix: 10200 };
check(
  "默认配置",
  JSON.stringify(normalizeConfig(undefined)) === JSON.stringify({ enabled: true, level: "strict", position: "bottom", injectLintTool: true, extraRules: "" }),
);
check("非法 level 回落 strict", normalizeConfig({ level: "bogus" }).level === "strict");
check("非法 position 回落 bottom", normalizeConfig({ position: "middle" }).position === "bottom");
check("enabled:false -> null", planRegistrations({ enabled: false }, orderMap) === null);
check("level:off -> null", planRegistrations({ level: "off" }, orderMap) === null);
const planBottom = planRegistrations({}, orderMap);
const planTop = planRegistrations({ position: "top" }, orderMap);
check("默认挂在 persona suffix 之后", planBottom.section.order === 10201, planBottom.section.order);
check("position=top 挂在 persona prefix 之后", planTop.section.order === 1, planTop.section.order);
check("section 名固定为 deai:style", planBottom.section.name === SECTION_NAME && SECTION_NAME === "deai:style");
check("section 文本非空", planBottom.section.text.length > 200, planBottom.section.text.length);
check("injectLintTool:false 不注册工具", planRegistrations({ injectLintTool: false }, orderMap).tool === false);
check("injectLintTool:false 文本不含工具名", !planRegistrations({ injectLintTool: false }, orderMap).section.text.includes(TOOL_NAME));

// ---------- 8. 插件导出形状 ----------
check("插件名 = deai-style", pluginName === "deai-style");
check("inject 声明 systemPrompt/tools", JSON.stringify(inject) === JSON.stringify(["systemPrompt", "tools"]));
check("apply 是函数", typeof apply === "function");
check("Config 存在", Config !== undefined && Config !== null);
let configOk = false;
try {
  const c = Config({});
  configOk = c.level === "strict" && c.enabled === true && c.injectLintTool === true;
} catch {
  configOk = false;
}
check("Config 解析出默认值", configOk);

// ---------- 9. mock ctx 开关两套断言 ----------
function makeCtx() {
  const calls = { effects: [], sections: [], tools: [] };
  const orders = { DEPLOYMENT_PERSONA_PREFIX: 0, DEPLOYMENT_PERSONA_SUFFIX: 10200 };
  const ctx = {
    effect(cb, label) {
      calls.effects.push(label);
      const cleanup = cb();
      return typeof cleanup === "function" ? cleanup : () => {};
    },
    systemPrompt: {
      getSectionOrder(n) {
        return orders[n] ?? 0;
      },
      section(s) {
        calls.sections.push(s);
        return () => {};
      },
    },
    tools: {
      register(t) {
        calls.tools.push(t);
        return () => {};
      },
    },
  };
  return { ctx, calls };
}

const onCase = makeCtx();
apply(onCase.ctx, { enabled: true, level: "strict" });
check("开：注册 1 个 section", onCase.calls.sections.length === 1, onCase.calls.sections.length);
check("开：section 名 = deai:style", onCase.calls.sections[0]?.name === SECTION_NAME);
check("开：section order = 10201", onCase.calls.sections[0]?.order === 10201, onCase.calls.sections[0]?.order);
check("开：注册 1 个工具", onCase.calls.tools.length === 1, onCase.calls.tools.length);
check("开：工具名 = deai_scan", onCase.calls.tools[0]?.name === TOOL_NAME);
check("开：section 文本非空", (onCase.calls.sections[0]?.text ?? "").length > 200);
check("开：effect 标签 2 个", onCase.calls.effects.length === 2, onCase.calls.effects.join(","));
check("开：effect 标签含 section()", onCase.calls.effects.some((l) => String(l).includes("section")));
check("开：effect 标签含 tool()", onCase.calls.effects.some((l) => String(l).includes("tool")));

const offCase = makeCtx();
apply(offCase.ctx, { enabled: false });
check("关（enabled:false）：零注册", offCase.calls.effects.length === 0 && offCase.calls.sections.length === 0 && offCase.calls.tools.length === 0);

const offCase2 = makeCtx();
apply(offCase2.ctx, { level: "off" });
check("关（level:off）：零注册", offCase2.calls.effects.length === 0 && offCase2.calls.sections.length === 0 && offCase2.calls.tools.length === 0);

const softTop = makeCtx();
apply(softTop.ctx, { level: "soft", position: "top", injectLintTool: false });
check("soft+top：order = 1", softTop.calls.sections[0]?.order === 1);
check("soft+top：不注册工具", softTop.calls.tools.length === 0);
check("soft+top：文本无工具名", !(softTop.calls.sections[0]?.text ?? "").includes(TOOL_NAME));
check("soft+top：文本含核心约束", (softTop.calls.sections[0]?.text ?? "").includes("不用模板连接词"));

const noConfig = makeCtx();
apply(noConfig.ctx, {});
check("无 config：走默认（开）", noConfig.calls.sections.length === 1 && noConfig.calls.tools.length === 1);

// ---------- 10. 工具执行端到端 ----------
const scanTool = onCase.calls.tools[0];
const toolOut = await scanTool.execute({ text: ai, maxSuggestions: 3 });
const toolBlocks = scanTool.output.render({ text: ai }, toolOut);
check("工具 execute 返回 lint 结果", typeof toolOut?.score === "number" && toolOut.band === aiR.band);
check(`工具 execute 尊重 maxSuggestions（实际 ${toolOut.suggestions.length}）`, toolOut.suggestions.length >= 1 && toolOut.suggestions.length <= 3);
check("工具 render 返回单个文本块", Array.isArray(toolBlocks) && toolBlocks.length === 1 && toolBlocks[0].type === "text");
check("工具 render 文本含评分", String(toolBlocks[0]?.text ?? "").includes(`${toolOut.score}/100`));
check("工具 description 非空", typeof scanTool.description === "string" && scanTool.description.length > 20);
check(
  "工具参数编译为 JSON Schema（text 必填）",
  scanTool.parameters?.type === "object" && Array.isArray(scanTool.parameters?.required) && scanTool.parameters.required.includes("text"),
);
check("工具参数含 maxSuggestions（integer）", scanTool.parameters?.properties?.maxSuggestions?.type === "integer");

// ---------- 11. 标定回归：区分强弱变体与补充规则 ----------
// 背景：第一轮 A/B（6 样本）均值达标但逐条不达标，根因是检测器同时误报与漏报——
// 把「不是X，是Y」这种正常汉语口语按 3 分罚（p5 只降到 45），却放过一整段典型 AI 科普腔（p2 只得 5 分）。
// 以下断言把当时的标定结论锁死，防止后续改动悄悄回退。
const fullForm = lint("这不是效率问题，而是组织能力的问题。");
const liteForm = lint("戒不掉不是因为意志力差，是这东西本来就被造出来对付自控力的。");
const explainer = lint("短视频难以戒掉，核心在于它精准击中了大脑的奖励机制。此外，算法会不断推送你感兴趣的内容。");
const idsOf = (r) => r.hits.map((h) => h.id);

check("标定：带「而是」的平行结构命中 not-x-but-y", idsOf(fullForm).includes("not-x-but-y"));
check("标定：带「而是」不误命中 lite 变体", !idsOf(fullForm).includes("not-x-but-y-lite"));
check("标定：不带「而是」的口语反转命中 lite 变体", idsOf(liteForm).includes("not-x-but-y-lite"));
check("标定：不带「而是」不算强指纹", !idsOf(liteForm).includes("not-x-but-y"));
check("标定：lite 变体严重度 = 1", liteForm.hits.find((h) => h.id === "not-x-but-y-lite")?.sev === 1);
check("标定：强指纹评分高于口语变体", fullForm.score > liteForm.score, `${fullForm.score} vs ${liteForm.score}`);
check("标定：explainer-frame 命中「核心在于」", idsOf(explainer).includes("explainer-frame"));
check("标定：transition-cliche 命中「此外」", idsOf(explainer).includes("transition-cliche"));
check("标定：AI 科普腔样例不再漏报", explainer.score >= 20, explainer.score);

// ---------- 12. 长度维度 / 性能 / 鲁棒性 ----------
// 第一轮缺陷审计（docs/reviews/round1-bug.md）的 D1（性能）与 D2（长度单调漏报）：
// 旧公式 hypothesis 下同一份 AI 样例 ×1=98 ×2=93 ×5=76 ×20=43，长文实际免检；
// 旧的表格行正则 `^\s*\|.*\|\s*$` 会跨行回溯，10 万换行要 7 秒。
const { stripCode: stripFn, renderReport: renderFn } = await import("../lib/lint.js");

const aiOnce = lint(ai).score;
const aiX2 = lint(ai.repeat(2)).score;
const aiX5 = lint(ai.repeat(5)).score;
const aiX20 = lint(ai.repeat(20)).score;
const aiScores = [aiOnce, aiX2, aiX5, aiX20];
check(
  `长度不敏感：同一 AI 样例 ×1/×2/×5/×20 均 >=70（实际 ${aiScores.join("/")}）`,
  aiScores.every((s) => s >= 70),
);
check(
  `长度不敏感：极差 <=15（实际 ${Math.max(...aiScores) - Math.min(...aiScores)}）`,
  Math.max(...aiScores) - Math.min(...aiScores) <= 15,
);

const t0 = performance.now();
const floodScore = lint("\n".repeat(100000)).score;
const floodMs = performance.now() - t0;
check(`性能：10 万换行在 800ms 内完成（实际 ${floodMs.toFixed(0)}ms）`, floodMs < 800 && floodScore === 0);

check("未闭合围栏的代码被剥离", !stripFn("```js\nconst secret = 1;\n").includes("secret"));
check("闭合围栏的代码被剥离", !stripFn("```js\nconst secret = 1;\n```\n正文").includes("secret"));
check("表格内容不再被整段删空", stripFn("| 方案 | 优点 |\n| --- | --- |\n| A | 快 |").includes("方案"));

let renderThrew = false;
try {
  renderFn(undefined);
  renderFn(null);
  renderFn({});
} catch {
  renderThrew = true;
}
check("renderReport 对异常入参不抛错", !renderThrew);
check("maxSuggestions 非法值退回默认条数（不留空建议）", lint(ai, { maxSuggestions: -1 }).suggestions.length >= 1);

// ---------- 13. 第二轮红蓝军回归（round2-red.md / round2-bug.md 的发现） ----------
// 13.1 第二轮 FN2-01：工具 description 点名的原句「希望对你有帮助」居然 0 分
check("service-close 命中「希望对你有帮助」", lint("希望对你有帮助。").score > 0);
check("service-close 命中「希望对您有所帮助」", lint("希望对您有所帮助。").score > 0);
// 13.2 第二轮 FN2-02：整篇只有排版、零套话的 AI 回答恒得 0 分 → 受限出口（≥5 才给分，封顶 25）
const outlineOnly = lint("# 标题一\n\n## 标题二\n\n**要点 A** 内容 A。\n\n**要点 B** 内容 B。\n");
check(`纯排版 AI 回答不再恒为 0（实际 ${outlineOnly.score}）`, outlineOnly.score > 0);
check(`纯排版封顶 25，永不进「中等」档（实际 ${outlineOnly.score}）`, outlineOnly.score <= 25 && outlineOnly.band !== "medium");
const humanSteps = lint("- 把灯泡拧下来\n- 换上新的\n- 装回灯罩\n");
check(`人类步骤清单不被排版定罪（实际 ${humanSteps.score}）`, humanSteps.score <= 15);
// 13.3 第二轮 FP2-01/FN2-03：emoji 两头都错（人类日志被定罪、键帽与国旗检测不到）
check("emoji 识别键帽 1️⃣", lint("1️⃣ 第一点\n2️⃣ 第二点\n3️⃣ 第三点\n").metricWeight > 0);
check("emoji 识别区域指示符 🇨🇳", lint("🇨🇳 中国\n🇺🇸 美国\n").metricWeight > 0);
check(`行首 emoji 不再单独定罪（人类工作日志，实际 ${lint("✅ 修好了\n🔥 明天继续\n📌 记得同步\n").score}）`, lint("✅ 修好了\n🔥 明天继续\n📌 记得同步\n").score <= 15);
// 13.4 第二轮 BUG2-01/02：四反引号与 ~~~ 围栏泄漏
check("~~~ 围栏被剥离", !stripCode("~~~\n综上所述，感谢大家的阅读。\n~~~\n").includes("综上所述"));
check("四反引号围栏内的三反引号不闭合", !stripCode("````\n```\n综上所述\n```\n````\n").includes("综上所述"));
// 13.5 第二轮 FN2-03：半角英文键值对被当成「名词：解释」
const kvText = lint("Key: value\nName: test\nAge: 20\nDesc: sample\n");
check("半角英文键值对不算 colon-definition", !kvText.hits.some((h) => h.id === "colon-definition"));
// 13.6 第二轮 FN2-04：插零宽字符定向规避
check("零宽字符不能绕过规则", lint("首\u200b先，明确目标。综上\u200b所述。").score > 0);
// 13.7 第二轮 FP2-02：同一个黑话复读三遍不该是 3 倍罪
check("同一黑话复读按词去重计数", lint("数字化转型，数字化转型，数字化转型。").hits.find((h) => h.id === "buzzword")?.count === 1);
// 13.8 第二轮 N 项：重叠命中只算一次（把 mergeSpans 关掉原本 103/103 仍过）
const boldLabelText = lint("- **核心结论**：不是不想，而是做不到。");
check(`行首加粗标签不重复计分（rw=${boldLabelText.ruleWeight}）`, boldLabelText.ruleWeight <= 6);
// 13.9 第二轮 N2：scope 用原始下标，不能被前置换行挤掉
check("前置换行不影响 opening 作用域命中", lint(`${"\n".repeat(100)}这是一个非常好的问题，我们来聊聊。`).hits.some((h) => h.id === "platitude-open"));
// 13.10 第二轮 N1：纯代码稿不能长得像「写得很干净」
check("纯代码稿 analyzed=false", lint("```python\ndef f():\n    return 1\n```\n").analyzed === false);
// 13.11 第二轮 5.4：用户一句「请分点列出」就能绕过全部提示词约束 → 提示词里补兜底条款
check("strict 提示词含「用户要求分点也不能用加粗标签」条款", renderPrompt({ level: "strict" }).includes("即使用户要求"));
// 13.12 已知边界（刻意不修，用数据锁住）：
//   第二轮实测的排版权重——AI 纯列表 3.7 / AI 纯表格 4.0 / AI emoji 列表 5.33，
//   而人类干净列表 5.34 / 人类工作日志 4.0 / 人类会议纪要 2.0。
//   AI 与人类的排版权重完全重叠，没有可分的阈值：任何「排版能单独定罪」的门槛
//   都会同时误伤人类或漏掉 AI。所以排版只做受限加成（≥5 给 ≤25 分），不定罪。
check("边界记录：AI 纯 bullet 列表不定罪（人类清单同形）", lint("- 第一点内容\n- 第二点内容\n- 第三点内容\n").score <= 15);
check("边界记录：AI 纯表格不定罪（人类数据表同形）", lint("| 方案 | 优点 |\n| --- | --- |\n| A | 快 |\n").score <= 15);
// 13.11 第二轮 REP2-01：0 分报告的命中要标明「未计分观察」
const zeroReport = renderReport({
  score: 0,
  chars: 100,
  analyzed: true,
  hits: [{ id: "bullet-ratio", cat: "struct", sev: 2, count: 1, samples: [], hint: "h" }],
  byCategory: { struct: { label: "结构节奏", weighted: 2 } },
  suggestions: [],
});
check("0 分报告的命中标为「未计分观察」", zeroReport.includes("未计分观察"));
check("renderReport 钳位异常分数", renderReport({ score: 1e9, chars: 10, analyzed: true }).includes("100/100"));

// ---------- 汇总 ----------
for (const l of lines) console.log(l);
console.log(`TOTAL pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
