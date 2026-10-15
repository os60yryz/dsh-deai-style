// 第三轮缺陷审计 probe2：数学与边界（analyzed/formatNudge/metricBonus/maxSuggestions/k/bandOf）
import { lint, bandOf, renderReport } from "../../lib/lint.js";

const J = (x) => JSON.stringify(x, null, 1);
const one = (s) => String(s).replace(/\s+/g, " ").trim();
const out = {};

// 1. analyzed 阈值与 score 的矛盾：短而强命中的文本
const shortTexts = [
  "希望对你有帮助。",
  "希望对你有帮助",
  "感谢你的提问",
  "感谢你的提问。",
  "让我们来看看这个方案。",
  "综上所述。",
  "不是效率问题，而是组织能力的问题。",
  "这是一个非常好的问题！",
  "这是一个非常好的问题，我们来聊聊。",
];
out.analyzed = shortTexts.map((t) => {
  const r = lint(t);
  const rep = renderReport(r);
  return {
    text: t,
    chars: r.chars,
    score: r.score,
    band: r.band,
    analyzed: r.analyzed,
    hits: r.hits.map((h) => h.id),
    reportFirstLine: one(rep.split("\n")[0]),
    reportSaysNoBody: rep.includes("没有可分析的正文"),
    reportHasHits: rep.includes("命中明细"),
    reportHasSuggest: rep.includes("改写建议"),
  };
});

// 2. maxSuggestions 各种入参
const ai = "这是一个非常好的问题！首先，我们需要明确目标。其次，我们要注意方法。综上所述，希望对你有帮助。";
out.maxSuggestions = [];
for (const v of [undefined, null, NaN, "3", 3.7, 1e9, -0, 0, -1, -3.5, Infinity, true, [], {}]) {
  const r = lint(ai, v === undefined ? {} : { maxSuggestions: v });
  out.maxSuggestions.push({ input: String(v === -0 ? "-0" : v), n: r.suggestions.length });
}

// 3. formatNudge 阈值跳变：用 heading/bullet 行比例把排版权重调到 5 附近
function fmtSample(bullets, headings, tables) {
  const lines = [];
  for (let i = 0; i < headings; i += 1) lines.push(`## 标题${i}`);
  for (let i = 0; i < bullets; i += 1) lines.push(`- 条目内容${i}`);
  for (let i = 0; i < tables; i += 1) lines.push(`| 列A${i} | 列B${i} |`);
  return `${lines.join("\n")}\n`;
}
out.nudgeJump = [];
for (const b of [0, 4, 6, 7, 8, 9, 10, 12]) {
  const t = fmtSample(b, 40 - b, 0);
  const r = lint(t);
  out.nudgeJump.push({ bullets: b, headings: 40 - b, contentLines: r.counts.contentLines, ruleWeight: r.ruleWeight, metricWeight: r.metricWeight, score: r.score, band: r.band });
}

// 4. 纯排版重样本：能否顶到 25 / 是否可能越过 35
function heavyFormat(nHead, nTable, nBullet, nEmoji, nColon) {
  const lines = [];
  for (let i = 0; i < nHead; i += 1) lines.push(`## 标题${i} **重点**`);
  for (let i = 0; i < nTable; i += 1) lines.push(`| 列A${i} **要点** | 列B${i} |`);
  for (let i = 0; i < nBullet; i += 1) lines.push(`- 条目内容${i} **核心**`);
  for (let i = 0; i < nEmoji; i += 1) lines.push(`✅ 待办${i}`);
  for (let i = 0; i < nColon; i += 1) lines.push(`名词条目${i}：这是解释文本`);
  return `${lines.join("\n")}\n`;
}
out.heavyFormat = [];
for (const cfg of [[36, 40, 8, 8, 10], [40, 30, 10, 10, 20], [20, 40, 6, 8, 30], [50, 50, 0, 10, 30]]) {
  const t = heavyFormat(...cfg);
  const r = lint(t);
  out.heavyFormat.push({ cfg, chars: r.chars, contentLines: r.counts.contentLines, ruleWeight: r.ruleWeight, metricWeight: r.metricWeight, score: r.score, band: r.band, hits: r.hits.map((h) => `${h.id}×${h.count}`) });
}

// 5. analyzed 阈值附近的正文长度
out.analyzedEdge = [];
for (const n of [0, 1, 5, 9, 10, 11, 20]) {
  const t = `${"字".repeat(n)}希望对你有帮助。`;
  const r = lint(t);
  out.analyzedEdge.push({ pad: n, chars: r.chars, analyzed: r.analyzed, score: r.score, band: r.band, report: one(renderReport(r).split("\n")[0]) });
}

// 6. k 单调性 / 饱和度
out.kCurve = [];
for (const n of [50, 200, 1000, 10000]) {
  const t = `${"此外，".repeat(1)}${"这是一段普通的正文，用来把长度撑起来。".repeat(Math.ceil(n / 18)).slice(0, n)}`;
  const r = lint(t);
  out.kCurve.push({ target: n, chars: r.chars, ruleWeight: r.ruleWeight, score: r.score });
}

// 7. bandOf 边界与非有限数
out.bandOf = {};
for (const s of [-1, 0, 15, 15.5, 16, 35, 35.5, 36, 60, 60.5, 61, 100, 101, NaN, Infinity, -Infinity]) {
  out.bandOf[String(s)] = bandOf(s).key;
}

// 8. chars 口径是否含标点/空白
out.charsKou = ["。，、！？", "a b c", "  \n\t ", "汉字"].map((t) => ({ t: J(t), chars: lint(t).chars }));

console.log(J(out));
