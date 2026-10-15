// 临时探针 2：定位 7 秒卡顿的正则 + 规则定义核对
import { lint, stripCode } from "../../lib/lint.js";
import { RULES } from "../../lib/ruleset.js";

const out = [];
const say = (...a) => out.push(a.join(" "));
const time = (label, fn) => {
  const t0 = Date.now();
  const v = fn();
  say(`TIME ${label}: ${Date.now() - t0}ms -> ${typeof v === "string" ? "len=" + v.length : v}`);
};

say("== 候选正则逐一计时（n 个换行）==");
const candidates = [
  ["fence ```", /```[\s\S]*?```/g],
  ["fence ~~~", /~~~[\s\S]*?~~~/g],
  ["inline `", /`[^`\n]*`/g],
  ["表格行 ^\\s*\\|.*\\|\\s*$ gm", /^\s*\|.*\|\s*$/gm],
];
for (const n of [5000, 10000, 20000, 40000]) {
  const s = "\n".repeat(n);
  for (const [label, re] of candidates) {
    const t0 = Date.now();
    s.replace(re, " ");
    const dt = Date.now() - t0;
    if (dt > 20) say(`  ${label} n=${n}: ${dt}ms`);
  }
}
say("== stripCode / lint 随换行数量增长 ==");
for (const n of [5000, 10000, 20000, 40000, 80000]) {
  const s = "\n".repeat(n);
  time(`stripCode n=${n}`, () => stripCode(s).length);
  time(`lint      n=${n}`, () => lint(s).score);
}
say("== 带空格的空白行（更接近真实草稿）==");
for (const n of [5000, 20000]) {
  const s = "  \n".repeat(n);
  time(`stripCode '  \\n'x${n}`, () => stripCode(s).length);
}
say("== 真实感长文（段落 + 空行，无换行洪水）==");
{
  const para = "这是一段普通的说明文字，用来模拟真实草稿的段落内容，长度大约六十个字符左右。";
  const doc = (para + "\n\n").repeat(800); // 约 5 万字
  time(`lint 5万字正常段落`, () => lint(doc).score);
}
say("== 规则定义核对 ==");
for (const id of ["emoji-marker", "both-sides", "let-us", "colon-definition", "not-x-but-y-lite"]) {
  const r = RULES.find((x) => x.id === id);
  if (!r) {
    say(`  ${id}: 不存在`);
    continue;
  }
  say(`  ${id}: sev=${r.sev} weight=${r.weight} flags=${r.re.flags}`);
  say(`    source=${r.re.source}`);
  say(`    hint=${r.hint}`);
}
say("== 裸变体选择符 / ZWJ / 零宽字符 ==");
for (const [label, ch] of [["VS16 U+FE0F", "\uFE0F"], ["ZWJ U+200D", "\u200D"], ["ZWNJ U+200C", "\u200C"], ["ZWSP U+200B", "\u200B"]]) {
  const r = lint(`文字${ch}文字`);
  say(`  ${label}: score=${r.score} hits=${JSON.stringify(r.hits.map((h) => h.id))}`);
}
say("== 未闭合围栏 ==");
for (const [label, t] of [
  ["未闭合", "```js\nconst a = 进行深入分析;\n"],
  ["已闭合", "```js\nconst a = 进行深入分析;\n```\n"],
  ["围栏后无换行", "```js\n进行深入分析"],
  ["四反引号", "````js\n进行深入分析\n````\n"],
]) {
  const r = lint(t);
  say(`  ${label}: score=${r.score} chars=${r.chars} hits=${JSON.stringify(r.hits.map((h) => h.id + "x" + h.count))}`);
}
say("== both-sides 各变体 ==");
for (const t of ["既方便又便宜。", "既有优点也有缺点。", "既方便又便宜还好用。", "一方面要快，另一方面要稳。", "既快又稳。", "既…又…"]) {
  const r = lint(t);
  say(`  ${JSON.stringify(t)}: ${JSON.stringify(r.hits.map((h) => h.id))}`);
}
console.log(out.join("\n"));
