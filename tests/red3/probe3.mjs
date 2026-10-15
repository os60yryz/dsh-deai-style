// 探针3：规则/指标计数、prompt 长度、README 与文档数字比对、恒真断言抽查
import { writeFileSync } from "node:fs";
import { RULES, METRICS } from "../../lib/ruleset.js";
import { renderPrompt, LEVELS } from "../../lib/prompt.js";
import { lint } from "../../lib/lint.js";

const out = {
  ruleCount: RULES.length,
  metricCount: METRICS.length,
  rulesByCat: RULES.reduce((a, r) => ((a[r.cat] = (a[r.cat] || 0) + 1), a), {}),
  metricsByEvidence: METRICS.reduce((a, m) => ((a[m.evidence] = (a[m.evidence] || 0) + 1), a), {}),
  dedupeRules: RULES.filter((r) => r.dedupe).map((r) => r.id),
  fmtRules: RULES.filter((r) => r.cat === "fmt").map((r) => `${r.id}(sev${r.sev})`),
  levels: LEVELS,
  promptLen: {},
};
for (const lv of Object.keys(LEVELS)) {
  const txt = renderPrompt(lv, "");
  out.promptLen[lv] = typeof txt === "string" ? txt.length : JSON.stringify(txt).length;
}
// 文档声称：strict 规则段 802 字符、soft 470 字符
out.b05 = lint("首先，明确目标。其次，拆解任务。", {}).score;
out.b05b = lint("首先，明确目标。其次，拆解任务。").score;
writeFileSync(new URL("./out3.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
