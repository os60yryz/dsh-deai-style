// 第二轮审计探针 2：超线性增长曲线（每个形状 4 个规模，看 ms 随规模翻倍的增长倍数）
// 跑法：node tmp/bug2/probe2.mjs
import { performance } from "node:perf_hooks";
import { lint, stripCode } from "../../lib/lint.js";

const ms = (fn) => {
  const s = performance.now();
  fn();
  return Number((performance.now() - s).toFixed(1));
};

const shapes = {
  plain_line_A: (n) => "a".repeat(n),
  plain_lines: (n) => ("abcde\n").repeat(n),
  newlines: (n) => "\n".repeat(n),
  table_rows: (n) => "| a | b |\n".repeat(n),
  pipe_flood_line: (n) => "|" + "a".repeat(n),
  fence_pairs: (n) => "```\nx\n```\n".repeat(n),
  fence_unclosed_blocks: (n) => "```js\nconst x = 1;\n".repeat(n),
  fence_open_only_lines: (n) => "```\n".repeat(n),
  bold: (n) => "**b**".repeat(n),
  inline_code: (n) => "`x`".repeat(n),
  emoji: (n) => "\u{1F600}".repeat(n),
  punct: (n) => "\u3002".repeat(n),
  bullets: (n) => "- a\n".repeat(n),
  headings: (n) => "# h\n".repeat(n),
  colon_def: (n) => "\u6982\u5ff5\uff1a\u89e3\u91ca\u3002\n".repeat(n),
  dash: (n) => "\u2014\u2014".repeat(n),
  spaces_eol: (n) => (" ".repeat(20) + "\n").repeat(n),
  dot_no_newline: (n) => "a.".repeat(n),
};

const sizes = [12500, 25000, 50000, 100000];
const res = {};
for (const [name, gen] of Object.entries(shapes)) {
  res[name] = {};
  for (const n of sizes) {
    const text = gen(n);
    const tAll = ms(() => lint(text));
    const tStrip = ms(() => stripCode(text));
    res[name][String(n)] = { len: text.length, lintMs: tAll, stripMs: tStrip };
  }
}

// 增长倍数（同级规模翻倍时 ms 的倍数 > 2.2 视为可疑）
const report = {};
for (const [name, row] of Object.entries(res)) {
  const arr = sizes.map((n) => row[String(n)].lintMs);
  const ratios = arr.slice(1).map((v, i) => Number((v / Math.max(arr[i], 0.1)).toFixed(2)));
  report[name] = { lintMs: arr, growRatios: ratios, maxRatio: Math.max(...ratios) };
}
const suspicious = Object.entries(report).filter(([, v]) => v.maxRatio > 2.2).map(([k]) => k);
console.log(JSON.stringify({ detail: res, summary: report, suspicious }, null, 1));
