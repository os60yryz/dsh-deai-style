// 探针6：性能与病理输入（针对第二轮新增的 stripCode 行扫描 + colonLines 前瞻）
import { writeFileSync } from "node:fs";
import { lint } from "../../lib/lint.js";
import { RULES, METRICS } from "../../lib/ruleset.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = { perf: [], flags: {} };
const time = (id, text) => {
  const t0 = process.hrtime.bigint();
  const r = lint(text);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  out.perf.push({ id, ms: +ms.toFixed(2), chars: r.chars, score: r.score, analyzed: r.analyzed });
};
const CJK = "这是一段用于压测的中文正文，没有冒号也没有特殊符号，用来把单行撑长。";

time("1MB-纯中文单行", CJK.repeat(28000));
time("200k-单行末尾一个冒号", CJK.repeat(5600) + "：值");
time("200k-单行大量半角冒号", CJK.repeat(2800) + "a:1 ".repeat(20000));
time("100k行-交替围栏", "```\n正文\n```\n".repeat(25000));
time("100k行-未闭合单围栏", "```\n" + "正文。\n".repeat(60000));
time("200k-单行反引号", "`".repeat(200000));
time("200k-单行加粗星号", "**a**".repeat(40000));
time("100k-单行换行", "\n".repeat(100000));

out.flags.rulesWithEvidence = RULES.filter((r) => r.evidence !== undefined).map((r) => `${r.id}:${r.evidence}`);
out.flags.fmtRules = RULES.filter((r) => r.cat === "fmt").map((r) => r.id);
out.flags.metricEvidence = METRICS.map((m) => `${m.id}:${m.evidence}`);
out.flags.dedupe = RULES.filter((r) => r.dedupe).map((r) => r.id);
writeFileSync(join(here, "out6.json"), JSON.stringify(out, null, 1));
for (const p of out.perf) console.log(`${p.id}\t${p.ms}ms\tchars=${p.chars}\tscore=${p.score}`);
console.log(JSON.stringify(out.flags, null, 1));
