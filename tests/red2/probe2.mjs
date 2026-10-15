// 第二轮红队探针 2：stripCode 口径 / 边界 / 崩溃 / 评分可信度 / 长度不变性
import { lint, stripCode, renderReport, BANDS } from "../../lib/lint.js";
import { renderPrompt } from "../../lib/prompt.js";
import { writeFileSync } from "node:fs";

const out = { strip: {}, edge: {}, perf: {}, score: {}, report: {}, prompt: {} };
const R = (r) => ({ chars: r.chars, score: r.score, band: r.band, rw: r.ruleWeight, mw: r.metricWeight, hits: r.hits.map((h) => h.id + "x" + h.count) });

/* ---------- 1. stripCode 口径 ---------- */
const FENCE_CASES = {
  fence4_nested_prose: "````markdown\n```js\n首先，这是一个很好的问题\n```\n````\n综上所述，感谢大家的阅读。",
  fence3_inner_string: "```js\nconst a = '```';\n```\n综上所述，感谢大家的阅读。",
  fence_unclosed_eol: "```\n代码没写完就开始讲散文了。首先，我们要明确目标。\n",
  fence_no_trailing_nl: "首先，明确目标。综上所述，感谢大家的阅读。\n```",
  fence_only_lang: "```js\n首先，综上所述，感谢大家的阅读。",
  fence_midline: "前面文字```js\nconst a = 1;\n```后面文字，综上所述，感谢大家的阅读。",
  fence_indented3: "   ```js\n首先，综上所述，感谢大家的阅读。\n   ```",
  fence_tilde: "~~~js\n首先，综上所述，感谢大家的阅读。\n~~~",
  table_plus_code: "| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\n首先，综上所述\n```\n\n后记。",
  inline_pair_across: "` 首先，这是一个很好的问题。综上所述，感谢大家的阅读。 `",
};
for (const [k, v] of Object.entries(FENCE_CASES)) {
  const s = stripCode(v);
  out.strip[k] = { raw: v.length, stripped: s, strippedLen: s.replace(/\s/g, "").length, chars: lint(v).chars, score: lint(v).score };
}

/* ---------- 2. 边界 / 崩溃 ---------- */
const EDGE = {
  empty: "",
  spaces: "   \n\n  \t ",
  oneChar: "好",
  punctOnly: "。，；：！？、——",
  punctOnlyHalf: ".,;:!?",
  crlf: "首先，明确目标。\r\n其次，拆解任务。\r\n最后，逐项验收。\r\n",
  lf: "首先，明确目标。\n其次，拆解任务。\n最后，逐项验收。\n",
  mixedEol: "首先，明确目标。\r\n其次，拆解任务。\n最后，逐项验收。\r\n",
  fullwidthComma: "首先，明确目标。其次，拆解任务。",
  halfwidthComma: "首先,明确目标。其次,拆解任务。",
  emojiVS16: "❤️ 喜欢\n⚠️ 注意\n✨ 闪亮",
  emojiBare: "❤ 喜欢\n⚠ 注意\n✨ 闪亮",
  emojiKeycap: "1️⃣ 第一条\n2️⃣ 第二条\n3️⃣ 第三条",
  emojiZWJ: "👨‍👩‍👧 一家人\n👩‍💻 写代码\n🧑‍🚀 上天",
  emojiSkin: "👍🏽 好的\n👋🏿 再见\n🤝🏼 成交",
  emojiFlag: "🇨🇳 中国\n🇯🇵 日本",
  surrogatePair: "𠮷野家\n𝕏 平台\n𡃁仔",
  cjkExt: "𠀀𠀁𠀂 生僻字测试行",
  nestedQuotes: "他说：「她问我『你来不来』，我说不来。」然后走了。",
  loneSurrogate: "前\uD800后",
  tabIndentBullet: "前言。\n\t- 第一条\n\t- 第二条\n\t- 第三条",
  zeroWidth: "首\u200B先，明确目标。",
  bomStart: "\uFEFF首先，明确目标。综上所述。",
  repeatedNewline: "\n".repeat(100000),
  huge50k: "首先，我们需要明确目标。其次，拆解任务。综上所述，这是一套方法。".repeat(1000),
};
for (const [k, v] of Object.entries(EDGE)) {
  const t0 = performance.now();
  let r;
  try {
    r = lint(v);
  } catch (e) {
    out.edge[k] = { error: String(e && e.message) };
    continue;
  }
  const ms = performance.now() - t0;
  out.edge[k] = { ms: Math.round(ms * 100) / 100, rawLen: v.length, ...R(r) };
}

/* ---------- 3. 性能：10 万字 ---------- */
function timeIt(label, text, n = 3) {
  const t0 = performance.now();
  let r = null;
  for (let i = 0; i < n; i++) r = lint(text);
  out.perf[label] = { rawChars: text.length, strippedChars: r.chars, msAvg: Math.round(((performance.now() - t0) / n) * 100) / 100, score: r.score };
}
const CN = (s, n) => s.repeat(Math.ceil(n / s.length)).slice(0, n);
timeIt("cjk100k_prose", CN("今天的天气说不上好，云压得很低。我在楼下站了一会儿就上去了。", 100000));
timeIt("cjk100k_cliche", CN("首先，我们需要明确目标。其次，拆解任务。综上所述，这是一套方法。", 100000));
timeIt("newlines100k", "\n".repeat(100000));
timeIt("table100k", ("| a | b |\n|---|---|\n").repeat(8000));
timeIt("fence100k_unclosed", "```js\n" + CN("const a = 1;\n", 100000));

/* ---------- 4. 长度不变性（round1-fix §一.1 声称 ×1/×2/×5/×20 均 100） ---------- */
const AI_SEG = "作为一个中年人，我不觉得故宫是最标志性的北京。对我来说是胡同口那家早点铺。一般来说，游客不会往那儿去，可那才是日子。";
const FILL_A = "今天的天气说不上好，云压得很低。我在楼下站了一会儿就上去了。";
const FILL_B = "锅里水开了，我把面下进去，搅了两下，盖上盖子。窗外有小孩在喊，听不清喊什么。";
for (const n of [0, 1, 4, 19]) {
  const t = AI_SEG + (FILL_B + FILL_A).repeat(n);
  out.score["len_x" + (n + 1)] = R(lint(t));
}

/* ---------- 5. 评分可信度 ---------- */
const CLEAN_STRUCT = `## 结论

先把结论放在前面：这件事值得做，但不要现在做。

## 理由

**时机不对。** 团队刚经历一次大改版，现在启动第二个高风险项目，注意力会被切碎。

**收益不明。** 目前没有数据能说明它能把转化率提高多少，全靠拍脑袋。

## 建议

先做一个两周的小验证，只覆盖一条业务线。跑完再决定是否扩大范围。`;
out.score.cleanStruct = R(lint(CLEAN_STRUCT));
out.score.cleanStruct_plus1cliche = R(lint(CLEAN_STRUCT + "\n\n综上所述，这就是全部内容。"));
out.score.cleanStruct_plus1cliche_syn = R(lint(CLEAN_STRUCT + "\n\n这不是时间问题，而是决心问题。"));
out.score.cleanStruct_plusServiceClose = R(lint(CLEAN_STRUCT + "\n\n希望对你有帮助。"));

// 拆段 vs 合段（同内容，段落空行切分差异）
const JOINED = "首先明确目标。其次拆解任务。最后逐项验收。这不是能力问题，而是方法问题。";
out.score.joined = R(lint(JOINED));
out.score.joined_blanklines = R(lint(JOINED.split("。").filter(Boolean).map((s) => s + "。").join("\n\n")));
out.score.joined_samepara = R(lint(JOINED.replace(/。/g, "。")));

// 确定性与 BANDS 边界
const DET = "首先，我们要明确目标。综上所述，这不是能力问题，而是方法问题。**关键**：坚持下去。";
const runs = [0, 1, 2, 3, 4].map(() => lint(DET));
out.score.deterministic = { scores: runs.map((r) => r.score), sigs: [...new Set(runs.map((r) => r.hits.map((h) => h.id + ":" + h.count).join("|")))].length };
out.score.bands = BANDS.map((b) => b.max);
// 找 35/60 线附近的样例
const PROBE_BAND = [
  "首次，这个方法很管用。", "首先，我们要明确目标。", "首先，我们要明确目标。其次，拆解任务。",
  "首先，我们要明确目标。其次，拆解任务。综上所述，这是方法。",
  "首先，我们要明确目标。其次，拆解任务。综上所述，这是方法。值得注意的是，要坚持。",
];
out.score.bandProbes = PROBE_BAND.map((t) => ({ chars: t.length, ...R(lint(t)) }));

/* ---------- 6. renderReport 边界 ---------- */
const zero = lint(CLEAN_STRUCT);
out.report.zeroScore = renderReport(zero).split("\n").slice(0, 3).join("\n");
out.report.nullArg = renderReport(null);
out.report.arrayArg = renderReport([1, 2, 3]);
out.report.partial = renderReport({ score: 50 });
out.report.nan = renderReport({ score: NaN, chars: NaN, hits: "x", suggestions: null });
out.report.badHits = renderReport({ score: 10, hits: [{ id: "x", cat: "nope", sev: 2, count: 1 }] });
out.report.negSuggest = lint(DET, { maxSuggestions: -1 }).suggestions.length;
out.report.floatSuggest = lint(DET, { maxSuggestions: 2.9 }).suggestions.length;
out.report.nanSuggest = lint(DET, { maxSuggestions: NaN }).suggestions.length;

/* ---------- 7. 提示词静态论证 ---------- */
out.prompt.len = { strict: renderPrompt({ level: "strict", toolName: "deai_scan" }).length, soft: renderPrompt({ level: "soft" }).length, off: renderPrompt({ level: "off" }).length };
out.prompt.mentionsBulletBan = /不要列 bullet/.test(renderPrompt({ level: "strict" }));
out.prompt.noOutputSide = "index.js 只注入 systemPrompt.section 与 tools.register，无 llm/stream 或 assistant-stream 拦截（静态阅读 index.js:50-63）";

writeFileSync(new URL("./out2.json", import.meta.url), JSON.stringify(out, null, 1), "utf8");
console.log(JSON.stringify(out, null, 1));
