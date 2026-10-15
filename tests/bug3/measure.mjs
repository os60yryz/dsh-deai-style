import { lint, renderReport, bandOf } from "../../lib/lint.js";
import { RULES, METRICS } from "../../lib/ruleset.js";
import { renderPrompt } from "../../lib/prompt.js";

const out = {};
out.rules = RULES.length;
out.metrics = METRICS.length;
out.evidence = {};
for (const r of RULES) out.evidence[r.evidence] = (out.evidence[r.evidence] ?? 0) + 1;
out.metricEvidence = {};
for (const m of METRICS) out.metricEvidence[m.evidence] = (out.metricEvidence[m.evidence] ?? 0) + 1;
out.metricsWithThreshold = METRICS.filter((m) => m.threshold !== undefined).length;
out.promptStrict = renderPrompt({ level: "strict", toolName: "deai_scan" }).length;
out.promptStrictNoTool = renderPrompt({ level: "strict" }).length;
out.promptSoft = renderPrompt({ level: "soft" }).length;
out.promptOff = renderPrompt({ level: "off" }).length;

// 短稿 + 命中：analyzed=false 与 score 并存
const short = "希望对你有帮助。";
const r = lint(short);
out.short = { chars: r.chars, score: r.score, band: r.band, analyzed: r.analyzed, hits: r.hits.map((h) => h.id), suggestions: r.suggestions.length };
out.shortReport = renderReport(r);
out.shortReportHasSuggest = out.shortReport.includes("改写建议");
out.shortReportHasHits = out.shortReport.includes("命中明细");

// 10..12 字区间
for (const n of [8, 9, 10, 11]) {
  const t = "。".repeat(n).replace(/。/g, "此") ;
  const rr = lint(t);
  (out.analyzedByChars ??= {})[rr.chars] = rr.analyzed;
}
// 阈值：score 恰好 35 / 36 的档位，与 TOOL_HINT「分数高于 35 时重写」
out.bandAt35 = bandOf(35).label;
out.bandAt36 = bandOf(36).label;
out.scoreOfShortList = (() => { const x = lint("- **要点**：内容\n- **次点**：内容"); return { chars: x.chars, score: x.score, analyzed: x.analyzed, band: x.band }; })();
// N2 复测：正文前垫 100 个换行，opening 规则是否仍命中
const ai1 = "这是一个非常好的问题！首先，我们需要明确目标。其次，我们要梳理现状。最后，我们要给出方案。";
const a = lint(ai1);
const b = lint("\n".repeat(100) + ai1);
out.n2 = { plain: { chars: a.chars, hits: a.hits.map((h) => h.id) }, padded: { chars: b.chars, hits: b.hits.map((h) => h.id) } };
console.log(JSON.stringify(out, null, 1));
