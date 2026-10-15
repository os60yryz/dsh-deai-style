import { lint, stripCode, bandOf, renderReport, BANDS } from "../../lib/lint.js";

const out = {};
const J = (x) => JSON.stringify(x);
const clip = (s) => (s.length > 44 ? s.slice(0, 44) + "…" : s);

// 1) D2 稀疏命中版：定点套话 × 极长正文
const sparse = (n) => "此外，" + "甲".repeat(n);
const r58 = lint(sparse(54));      // 58 字
const r10258 = lint(sparse(10254)); // 10258 字
out.D2_sparse = { "58": { score: r58.score, chars: r58.chars, hits: r58.hits.length, band: r58.band },
                  "10258": { score: r10258.score, chars: r10258.chars, hits: r10258.hits.length, band: r10258.band } };

// 2) D2 再次确认整篇复制不稀释
const ai1 = "这是一个非常好的问题！首先，我们需要明确目标。其次，要考虑成本。最后，还要评估风险。值得注意的是，方案本身并非万能。综上所述，整体方案需要进一步打磨。希望对你有所帮助！";
const d2 = { 1: lint(ai1), 20: lint(Array(20).fill(ai1).join("\n")) };
out.D2_repeat = { "x1": { score: d2[1].score, chars: d2[1].chars }, "x20": { score: d2[20].score, chars: d2[20].chars } };

// 3) stripCode 漏删面
const cases = {
  "tilde_fence": "~~~py\nprint(1)\n~~~\n",
  "tilde_fence_ai": "~~~\n这是一个非常好的问题！\n首先，我们要明确目标。\n~~~\n",
  "blockquote_fence": "> ```\n> 这是一个非常好的问题！\n> ```\n",
  "indent4_code": "    const x = 1;\n    console.log(x);\n",
  "inline_across_line": "前一句`code\nmore`后一句",
  "fence_not_line_start": "文字 ```\ncode\n``` 收",
  "unclosed_fence": "正文\n```\ncode here",
  "prefix_space_fence": "  ```\ncode\n  ```\n",
  "pipe_body": "| a | b |\n正文里有 | 竖线\n",
};
out.stripCode = {};
for (const [k, v] of Object.entries(cases)) {
  const st = stripCode(v);
  const li = lint(v);
  out.stripCode[k] = { raw: v.length, strippedChars: st.replace(/\s/g, "").length, mChars: li.chars, score: li.score, bands: li.band };
}

// 4) emoji 独立定罪（无套话、无连接词）
const emo = "😀 一\n😀 二\n😀 三\n😀 四\n";
const re = lint(emo);
out.emoji_only = { score: re.score, band: re.band, hits: re.hits.map((h) => h.id), strong: re.strongScore, metricBonus: re.metricBonus, chars: re.chars };

// 5) BANDS / bandOf 边界
out.band_boundary = { 14.9: bandOf(14.9), 15: bandOf(15), 34.9: bandOf(34.9), 35: bandOf(35), 59.9: bandOf(59.9), 60: bandOf(60), "NaN": bandOf(NaN), "Inf": bandOf(Infinity), "-1": bandOf(-1) };
out.bands_table = BANDS;

// 6) 密度口径：m.chars / rawChars / lines 与 stripCode 的关系
const pad = "\n".repeat(100) + ai1;
const rp = lint(pad);
out.metrics_shape = { keys: Object.keys(rp), rawChars: rp.rawChars, chars: rp.chars, lines: rp.lines, rawLen: pad.length, strippedLen: stripCode(pad).length };
out.metric_entry = rp.metrics;

// 7) maxSuggestions 极端值经 renderReport 的观感
const heavy = "这是一个非常好的问题！首先，我们需要明确目标。其次，要考虑成本。最后，还要评估风险。值得注意的是，方案本身并非万能。综上所述，整体方案需要进一步打磨。";
const rf = renderReport(lint(heavy, { maxSuggestions: -1 }));
out.suggest_neg_report = { score: lint(heavy, { maxSuggestions: -1 }).score, hasSuggestSection: /改写建议/.test(rf), reportTail: clip(rf.slice(-120)) };
out.suggest_bigint = lint(heavy, { maxSuggestions: 1e9 }).suggestions.length;
out.suggest_frac = lint(heavy, { maxSuggestions: 2.7 }).suggestions.length;

// 8) 未闭合围栏 → 是否整篇被吞（静默 0 分）
const unclosed = "这是一个非常好的问题！首先我们要明确目标。\n```\ncode\n";
const ru = lint(unclosed);
out.unclosed_fence = { score: ru.score, chars: ru.chars, rawChars: ru.rawChars, band: ru.band, hits: ru.hits.length };

// 9) 纯代码稿 → clean?
const codeOnly = "```python\ndef f():\n    return 1\n```\n";
const rc = lint(codeOnly);
out.code_only = { score: rc.score, chars: rc.chars, band: rc.band };

console.log(J(out, null, 1));
