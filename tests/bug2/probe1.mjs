// 第二轮审计探针 1：D1-D7 复测 + 正确性/静默失败/契约
// 跑法：node tmp/bug2/probe1.mjs
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { lint, stripCode, renderReport, bandOf, BANDS } from "../../lib/lint.js";
import { RULES, METRICS } from "../../lib/ruleset.js";
import { apply } from "../../index.js";
import { planRegistrations, normalizeConfig } from "../../lib/plan.js";

const R = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const ai = R("../../tests/fixtures/ai_style_sample.txt");
const out = {};

const ms = (fn) => {
  const s = performance.now();
  const v = fn();
  return { ms: Number((performance.now() - s).toFixed(1)), v };
};

// ---------- D1 性能复测 ----------
const d1 = {};
d1.newlines100k = ms(() => lint("\n".repeat(100000))).ms;
d1.table50kRows = ms(() => lint("| a | b |\n".repeat(50000))).ms;
d1.pipeLongLine = ms(() => lint("|" + "a".repeat(100000) + "\n")).ms;
d1.spaces = ms(() => lint((" ".repeat(1000) + "\n").repeat(100))).ms;
d1.unclosedFences2000 = ms(() => lint("```js\nconst x = 1;\n".repeat(2000))).ms;
d1.bold20k = ms(() => lint("**b**".repeat(20000))).ms;
d1.emoji50k = ms(() => lint("\u{1F600}".repeat(50000))).ms;
d1.longLine200k = ms(() => lint("a".repeat(200000))).ms;
d1.punct50k = ms(() => lint("\u3002".repeat(50000))).ms;
d1.inlineCode50k = ms(() => lint("`x`".repeat(50000))).ms;
d1.bullets20k = ms(() => lint("- a\n".repeat(20000))).ms;
out.D1_perf_ms = d1;

// ---------- D2 长度单调 ----------
const s = (t) => lint(t).score;
const ch = (t) => lint(t).chars;
out.D2_length = {
  baseChars: ch(ai),
  x1: s(ai), x2: s(ai.repeat(2)), x5: s(ai.repeat(5)), x20: s(ai.repeat(20)),
  x20chars: ch(ai.repeat(20)),
  oneClich_58: s("\u6b64\u5916" + "\u7532".repeat(56)),
  oneClich_10258: s("\u6b64\u5916" + "\u7532".repeat(10256)),
};

// ---------- D3-D7 复测 ----------
out.D3_let_us = {
  sample: "\u8ba9\u6211\u4eec\u6765\u770b\u770b\u8fd9\u6bb5\u4ee3\u7801\u3002",
  hits: lint("\u8ba9\u6211\u4eec\u6765\u770b\u770b\u8fd9\u6bb5\u4ee3\u7801\u3002").hits.map((h) => h.id),
  score: lint("\u8ba9\u6211\u4eec\u6765\u770b\u770b\u8fd9\u6bb5\u4ee3\u7801\u3002").score,
};
out.D4_both_sides = {
  a: lint("\u4e00\u65b9\u9762\u6548\u7387\u9ad8\uff0c\u53e6\u4e00\u65b9\u9762\u7ef4\u62a4\u6210\u672c\u4e5f\u9ad8\u3002").hits.map((h) => h.id),
  b: lint("\u8fd9\u5957\u65b9\u6848\u65e2\u5feb\u53c8\u7a33\u3002").hits.map((h) => h.id),
};
const unclosed = "```js\nconst secret = 1;\n";
out.D5_unclosed = {
  stripHasSecret: stripCode(unclosed).includes("secret"),
  stripOut: JSON.stringify(stripCode(unclosed)),
  score: lint(unclosed).score,
};
out.D6_vs16 = { score: lint("\uFE0F").score, hits: lint("\uFE0F").hits.map((h) => h.id) };
{
  const cases = [undefined, null, {}, [], 42, "x", { score: NaN }, { score: 1e9, hits: "no", suggestions: 3, byCategory: 7 }, { hits: [null, {}, { samples: "x" }] }];
  const threw = [];
  const texts = [];
  for (const c of cases) {
    try { texts.push(String(renderReport(c).slice(0, 40)).replace(/\n/g, "|")); }
    catch (e) { threw.push(String(c) + " => " + e.message); texts.push(null); }
  }
  out.D7_render = { threw, texts };
}

// ---------- 新：静默失败面 ----------
const silent = {};
for (const [k, v] of [["null", null], ["undefined", undefined], ["emptyStr", ""], ["spaces", "   \n  "], ["zero", 0], ["obj", {}], ["array", []], ["boolTrue", true], ["codeOnly", "```py\nprint(1)\n```"], ["tildeFence", "~~~py\nprint(1)\n~~~\n"]]) {
  const r = lint(v);
  silent[k] = { score: r.score, band: r.band, chars: r.chars, hits: r.hits.length, suggestions: r.suggestions.length };
}
out.silent_inputs = silent;

// ---------- 新：opening/closing scope 口径（raw index vs 去空白 chars） ----------
const base = "\u8fd9\u662f\u4e00\u4e2a\u975e\u5e38\u597d\u7684\u95ee\u9898\uff01" + "\u7532\u4e59\u4e19\u4e01".repeat(30);
const pad = "\n".repeat(100) + base;
out.scope_units = {
  baseChars: lint(base).chars, baseRawLen: base.length,
  baseHits: lint(base).hits.map((h) => h.id),
  padChars: lint(pad).chars, padRawLen: pad.length,
  padLimitWouldBe: Math.max(60, Math.min(200, lint(pad).chars * 0.2)),
  padHits: lint(pad).hits.map((h) => h.id),
};
// closing 侧：raw 位置在 chars*0.65 之后但被空白挤到前面的情形
const closeText = "\u7532".repeat(400) + "\n\n\n\n\n\n\n\n\n\n" + "\u603b\u4e4b\uff0c\u5c31\u8fd9\u6837\u3002";
out.scope_closing = { hits: lint(closeText).hits.map((h) => h.id) };

// ---------- 新：g 标志 / lastIndex / 重复 id ----------
lint(ai);
const lastIndexes = RULES.map((r) => r.re.lastIndex);
const sig = (r) => r.hits.map((h) => h.id + ":" + h.count).join(",");
out.regex_state = {
  nonZeroLastIndex: lastIndexes.filter((x) => x !== 0).length,
  repeatSameSignature: sig(lint(ai)) === sig(lint(ai)),
};
const ids = [...RULES.map((r) => r.id), ...METRICS.map((m) => m.id)];
out.id_dupes = ids.filter((x, i) => ids.indexOf(x) !== i);

// ---------- 新：字段消费（threshold / evidence / kind） ----------
const lintSrc = readFileSync(new URL("../../lib/lint.js", import.meta.url), "utf8");
const planSrc = readFileSync(new URL("../../lib/plan.js", import.meta.url), "utf8");
out.field_use = {
  thresholdReadInLint: /\.threshold/.test(lintSrc),
  thresholdDeclaredInMetrics: METRICS.filter((m) => m.threshold !== undefined).length,
  evidenceValues: [...new Set(METRICS.map((m) => m.evidence))],
  evidenceReadInLint: /\.evidence/.test(lintSrc),
  kindReadInLint: /\.kind/.test(lintSrc),
  planReadsThreshold: /threshold/.test(planSrc),
};

// ---------- 新：bandOf 边界 ----------
out.band_boundary = Object.fromEntries([15, 15.5, 16, 35, 36, 60, 60.5, 61, 100, 101, -1, NaN, Infinity].map((x) => [String(x), bandOf(x).key]));
out.bands = BANDS.map((b) => b.max);

// ---------- 新：scale / 分母 0 边界（直接调 measure） ----------
const M = (id) => METRICS.find((m) => m.id === id);
out.scale_edges = {
  bold_per1000_zero: M("bold-density").measure("", { boldSpans: 1, per1000: 0 }),
  bold_exact_half_threshold: M("bold-density").measure("", { boldSpans: 3, per1000: 1 }),
  bold_at_threshold: M("bold-density").measure("", { boldSpans: 6, per1000: 1 }),
  bullet_contentLines0: M("bullet-ratio").measure("", { bulletLines: 0, contentLines: 0 }),
  emoji_marker_1: M("emoji-marker").measure("", { emojiStartLines: 1 }),
  emoji_marker_2: M("emoji-marker").measure("", { emojiStartLines: 2 }),
  emoji_marker_9: M("emoji-marker").measure("", { emojiStartLines: 9 }),
  burst_uniform_cv0: M("sentence-burstiness").measure("", { chars: 1000, sentenceCount: 10, sentenceCv: 0 }),
  burst_cv_0_8: M("sentence-burstiness").measure("", { chars: 1000, sentenceCount: 10, sentenceCv: 0.8 }),
  burst_cv_1_0: M("sentence-burstiness").measure("", { chars: 1000, sentenceCount: 10, sentenceCv: 1.0 }),
  burst_cv_3_0: M("sentence-burstiness").measure("", { chars: 1000, sentenceCount: 10, sentenceCv: 3.0 }),
};

// ---------- 新：maxSuggestions 契约 ----------
const sug = {};
for (const v of [-1, 0, 2.7, 3, 1e9, NaN, Infinity, "3", null]) {
  const n = v === null ? lint(ai).suggestions.length : lint(ai, { maxSuggestions: v }).suggestions.length;
  sug[String(v)] = n;
}
out.maxSuggestions = sug;

// ---------- 新：工具契约 + 零注册 ----------
function makeCtx(orders = { DEPLOYMENT_PERSONA_PREFIX: 0, DEPLOYMENT_PERSONA_SUFFIX: 10200 }) {
  const calls = { effects: [], sections: [], tools: [], cleanups: [] };
  const ctx = {
    effect(cb, label) { calls.effects.push(String(label)); const c = cb(); calls.cleanups.push(c); return typeof c === "function" ? c : () => {}; },
    systemPrompt: { getSectionOrder: (n) => orders[n], section: (x) => { calls.sections.push(x); return () => { calls.sections.pop(); }; } },
    tools: { register: (t) => { calls.tools.push(t); return () => { calls.tools.pop(); }; } },
  };
  return { ctx, calls };
}
const on = makeCtx();
apply(on.ctx, { level: "strict" });
const off = makeCtx();
apply(off.ctx, { enabled: false });
const off2 = makeCtx();
apply(off2.ctx, { level: "off" });
const tool = on.calls.tools[0];
async function tryExec(args) {
  try { const v = await tool.execute(args); return { ok: true, score: v.score, band: v.band, chars: v.chars, sugg: v.suggestions.length }; }
  catch (e) { return { ok: false, err: String(e.name) + ": " + String(e.message).slice(0, 120) }; }
}
const toolOutEmpty = await tryExec({});
const toolOutNull = await tryExec({ text: null, maxSuggestions: -5 });
const toolOutStr = await tryExec({ text: "abc", maxSuggestions: "9" });
const toolOutUndef = await tryExec({ text: undefined });
const toolOutNum = await tryExec({ text: 123 });
out.tool = {
  onEffects: on.calls.effects, offEffects: off.calls.effects.length, offLevelOffEffects: off2.calls.effects.length,
  paramRequired: tool.parameters?.required, paramProps: Object.keys(tool.parameters?.properties ?? {}),
  schemaType: tool.output.schema.type,
  getSectionOrderMissing: (() => { const c = makeCtx({}); apply(c.ctx, {}); return c.calls.sections[0]?.order; })(),
  execEmpty: toolOutEmpty,
  execNullNeg: toolOutNull,
  execStr: toolOutStr,
  execUndef: toolOutUndef,
  execNum: toolOutNum,
  renderBadValue: (() => { try { return JSON.stringify(tool.output.render({}, undefined)).slice(0, 80); } catch (e) { return "THREW " + e.message; } })(),
};

// ---------- 新：normalizeConfig 非法值 ----------
out.normalize = {
  enabled0: normalizeConfig({ enabled: 0 }).enabled,
  enabledStr: normalizeConfig({ enabled: "false" }).enabled,
  inject0: normalizeConfig({ injectLintTool: 0 }).injectLintTool,
  extraNum: normalizeConfig({ extraRules: 123 }).extraRules,
  levelNull: normalizeConfig({ level: null }).level,
  levelOff: normalizeConfig({ level: "off" }).level,
  positionUpper: normalizeConfig({ position: "TOP" }).position,
  levelOffEnabled: planRegistrations({ level: "off" }, { personaPrefix: 0, personaSuffix: 10200 }),
  badOrders: (() => { try { return JSON.stringify(planRegistrations({}, undefined)); } catch (e) { return "THREW " + e.message; } })(),
};

console.log(JSON.stringify(out, null, 1));
