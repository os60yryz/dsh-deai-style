// 第三轮缺陷审计 probe3：性能回归 / 复杂度 / 内存
import { lint } from "../../lib/lint.js";
import { RULES } from "../../lib/ruleset.js";

const ms = (fn) => {
  const t0 = performance.now();
  const v = fn();
  return { ms: Math.round((performance.now() - t0) * 10) / 10, v };
};
const best = (fn, n = 3) => Math.min(...Array.from({ length: n }, () => ms(fn).ms));

const cases = [
  ["10万换行 LF", () => "\n".repeat(100000)],
  ["10万换行 CRLF", () => "\r\n".repeat(100000)],
  ["10万字符单行", () => "a".repeat(100000)],
  ["10万字符单行(无空格汉字)", () => "汉".repeat(100000)],
  ["5万表格行", () => "| 列A | 列B |\n".repeat(50000)],
  ["5万表格行 CRLF", () => "| 列A | 列B |\r\n".repeat(50000)],
  ["5万次「此外，」", () => "此外，".repeat(50000)],
  ["2万个 **加粗**", () => "**加粗**".repeat(20000)],
  ["2000 个未闭合围栏块", () => "```\ncode\n".repeat(2000)],
  ["2万次「数字化转型，」", () => "数字化转型，".repeat(20000)],
  ["2万行行首 emoji", () => "✅ 待办事项\n".repeat(20000)],
  ["20万字符普通正文", () => "这是一段用来压测的普通中文正文，长度大概二十万字符。".repeat(10000)],
];

const perf = [];
for (const [name, gen] of cases) {
  const text = gen();
  const r = best(() => lint(text));
  perf.push({ name, inChars: text.length, ms: r });
}

// collectSpans 的 new RegExp 开销（26 条规则 × 每次调用）
const reTimes = best(() => {
  for (const rule of RULES) new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : `${rule.re.flags}g`);
  return 0;
}, 5);
const shortText = "今天下午三点在楼下便利店买了瓶水。此外，这个方案既快又稳。";
const lintShort = best(() => lint(shortText), 5);
const reAll = best(() => {
  for (let i = 0; i < 5; i += 1) for (const rule of RULES) new RegExp(rule.re.source, rule.re.flags);
  return 0;
}, 5);

// dedupe 复杂度：n 次重复同一黑话 vs n 次不同占比
const dedupe = [];
for (const n of [2000, 10000, 40000]) {
  const same = "数字化转型，".repeat(n);
  const tSame = best(() => lint(same), 3);
  const many = Array.from({ length: n }, (_, i) => `闭环${i}`).join("，");
  const tMany = best(() => lint(many), 3);
  dedupe.push({ n, sameWordChars: same.length, sameMs: tSame, distinctChars: many.length, distinctMs: tMany });
}

// 内存：超长文本
const mem = [];
for (const n of [100000, 400000]) {
  if (global.gc) global.gc();
  const before = process.memoryUsage().heapUsed;
  const text = "这是一段用来压测的正文。".repeat(Math.ceil(n / 12)).slice(0, n);
  if (global.gc) global.gc();
  const afterAlloc = process.memoryUsage().heapUsed;
  const r = lint(text);
  const afterLint = process.memoryUsage().heapUsed;
  mem.push({ n, allocMB: +((afterAlloc - before) / 1048576).toFixed(1), lintDeltaMB: +((afterLint - afterAlloc) / 1048576).toFixed(1), peakMB: +((afterLint - before) / 1048576).toFixed(1), score: r.score, chars: r.chars });
}

console.log(JSON.stringify({ perf, reTimes, lintShort, reAll, dedupe, mem }, null, 1));
