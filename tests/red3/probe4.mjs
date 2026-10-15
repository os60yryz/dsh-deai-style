// 探针4：修正字段名（lint 返回 r.chars/r.ruleWeight/r.metricWeight，报告走 renderReport）
import { readFileSync, writeFileSync } from "node:fs";
import { renderPrompt, LEVELS } from "../../lib/prompt.js";
import { lint, renderReport } from "../../lib/lint.js";
import { RULES } from "../../lib/ruleset.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const rows = [];
const T = (id, text, opt) => {
  const r = lint(text, opt);
  rows.push({ id, chars: r.chars, score: r.score, band: r.band, rw: r.ruleWeight, mw: r.metricWeight, weighted: r.weighted, analyzed: r.analyzed, bd: r.bandLabel, hits: r.hits.map((h) => h.id + "x" + h.count) });
};
const R = (id, text) => { const r = lint(text); rows.push({ id, report: renderReport(r).split("\n").filter(Boolean).slice(0, 3) }); };

const pl = {};
for (const lv of LEVELS) pl[lv] = renderPrompt(lv, "").length;
pl["strict+extra"] = renderPrompt("strict", "额外要求一条。").length;
pl["unknown"] = renderPrompt("bogus", "").length;

T("C1-8字", "希望对你有帮助。");
T("C2-16字", "这只是一个建议，希望对你有帮助。");
T("C3-24字", "以上是我的分析，如果还有疑问，希望对你有帮助。");
T("C4-希望你能", "希望你能认真考虑一下这个问题。");

const fmtDoc = ["# 标题一", "", "## 标题二", "", "- 条目甲", "- 条目乙", "- 条目丙", "", "| 列 | 值 |", "| --- | --- |", "| a | 1 |", "", "说明：一段普通的话，没有套话。", "要点：另一段普通的话。"].join("\n");
T("P1-纯排版", fmtDoc);
T("P2-纯排版加强", fmtDoc + "\n\n- 条目丁\n- 条目戊\n\n## 标题三\n\n### 标题四\n\n备注：第三段普通的话。");

T("Q1-行首加粗无冒号×2", "**注意**\n这段是说明文字，内容平实。\n\n**提示**\n这段也是普通叙述。");
T("Q2-行首加粗有冒号×2", "**注意**：这段是说明文字。\n\n**提示**：这段也是普通叙述。");
T("Q3-行首加粗×2带正文", "**注意**：先备份再升级。\n\n**提示**：升级后要重启服务。\n\n升级步骤不复杂，按文档走就行。");

for (const s of ["综上所述。", "综上所述，由此可见。", "希望对你有帮助。", "希望对你有帮助", "以上就是我的全部回答。"]) T("A-" + s.length, s);

T("Z-chars-ZWJ", "👨‍👩‍👧 这是正文。");
T("Z-chars-noZWJ", "👨👩👧 这是正文。");
T("Z-Persian", "می‌خواهم این را بگویم و ادامه دهم تا متن طولانی‌تر شود.");

R("R1-8字", "希望对你有帮助。");
R("R2-9字", "希望对你有帮助哦。");
R("R3-10字", "希望对你有帮助啊。");

const checksSrc = readFileSync(join(here, "..", "..", "tests", "checks.mjs"), "utf8");
const checkLines = checksSrc.split("\n").filter((l) => /check\(/.test(l));
const scoreAware = checkLines.filter((l) => /score|band/.test(l));

writeFileSync(join(here, "out4.json"), JSON.stringify({ pl, rows, checkCount: checkLines.length, scoreAware: scoreAware.length, ruleCount: RULES.length }, null, 1));
console.log(JSON.stringify({ pl, checkCount: checkLines.length, scoreAware: scoreAware.length }, null, 1));
for (const r of rows) console.log(r.report ? r.id + " => " + JSON.stringify(r.report) : `${r.id}\tchars=${r.chars}\tscore=${r.score}\t${r.band}\trw=${r.rw}\tmw=${r.mw}\tw=${r.weighted}\tan=${r.analyzed}\t${r.hits}`);
