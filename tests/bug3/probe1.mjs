// 第三轮缺陷审计 probe1：stripCode 行扫描健壮性 / 零宽与 emoji 顺序依赖 / 正则状态
import { stripCode, lint } from "../../lib/lint.js";

const J = (x) => JSON.stringify(x);
const short = (s, n = 70) => (s.length > n ? `${s.slice(0, 40)}…${s.slice(-20)}[len=${s.length}]` : s);
const rows = [];
function T(name, input) {
  let out, err = null;
  try { out = stripCode(input); } catch (e) { err = String(e && e.message); }
  rows.push({
    case: name,
    inLen: input.length,
    outLen: err ? null : out.length,
    out: err ? `THROW ${err}` : short(out),
  });
}

// A. 围栏形态
T("CRLF 闭合围栏", "```js\r\nconst secret=1;\r\n```\r\n正文甲\r\n");
T("CRLF 未闭合围栏", "```js\r\nconst secret=1;\r\n正文甲\r\n");
T("LF 闭合围栏", "```js\nconst secret=1;\n```\n正文甲\n");
T("~~~ 闭合", "~~~py\nprint(1)\n~~~\n正文甲\n");
T("~~~ 未闭合", "~~~\n综上所述，感谢大家的阅读。\n");
T("四反引号包裹三反引号", "````\n```\n综上所述\n```\n````\n正文甲\n");
T("四反引号里放 ~~~ 再闭合", "````\n~~~\n综上所述\n~~~\n````\n正文甲\n");
T("三反引号里放 ~~~~", "```\n~~~~\n综上所述\n~~~~\n```\n正文甲\n");
T("闭合围栏更长(4>3)", "```\n综上所述\n````\n正文甲\n");
T("闭合围栏更短(3<4)", "````\n综上所述\n```\n正文甲\n");
T("缩进 2 空格围栏", "  ```\n综上所述\n  ```\n正文甲\n");
T("缩进 tab 围栏", "\t```\n综上所述\n\t```\n正文甲\n");
T("四空格缩进代码块(无围栏)", "    综上所述\n    感谢大家的阅读\n正文甲\n");
T("行尾孤立 ```", "正文甲\n```");
T("行首 ``` 但同一行有内容", "```js const secret=1;\n正文甲\n");
T("两个反引号不算围栏", "``\n综上所述\n``\n正文甲\n");
T("反引号出现在句中", "他说 ``` 这是行内\n正文甲\n");
T("围栏行带 info 含反引号", "```js `x`\ncode\n```\n正文甲\n");
T("空围栏对", "```\n```\n正文甲\n");
T("交错: ``` 开 ~~~ 关", "```\n综上所述\n~~~\n正文甲\n");
T("引用块内围栏", "> ```\n> 综上所述\n> ```\n正文甲\n");
T("跨行行内代码", "前`code\nmore`后\n");
T("末尾无换行的未闭合围栏", "正文甲\n```js\nconst secret=1;");
T("超长单行(10万字符)", `${"x".repeat(100000)}\n正文甲\n`);
T("10万字符单行内含三反引号", `${"x".repeat(50000)}\`\`\`${"y".repeat(50000)}\n正文甲\n`);

// A2. CRLF 对 lint 口径的影响（TABLE_RE / counts）
const tableLF = "| 方案 | 优点 |\n| --- | --- |\n| A | 快 |\n";
const tableCRLF = "| 方案 | 优点 |\r\n| --- | --- |\r\n| A | 快 |\r\n";
const bulletCRLF = "- 第一点内容\r\n- 第二点内容\r\n- 第三点内容\r\n";
const bulletLF = "- 第一点内容\n- 第二点内容\n- 第三点内容\n";
const crlf = [];
for (const [name, t] of [["table-LF", tableLF], ["table-CRLF", tableCRLF], ["bullet-LF", bulletLF], ["bullet-CRLF", bulletCRLF]]) {
  const r = lint(t);
  crlf.push({ name, score: r.score, chars: r.chars, tableLines: r.counts.tableLines, bulletLines: r.counts.bulletLines, contentLines: r.counts.contentLines, metricWeight: r.metricWeight });
}

// B. 零宽 / emoji
const zw = [];
for (const [name, t] of [
  ["ZWJ 家庭 emoji 一个序列", "👨‍👩‍👧‍👦"],
  ["ZWJ 家庭 emoji ×3", "👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦"],
  ["ZWJ 职业 emoji", "👩‍💻"],
  ["国旗", "🇨🇳"],
  ["键帽", "1️⃣"],
  ["VS16 心形", "❤️"],
  ["裸心形", "❤"],
  ["零宽插在套话中", "首\u200b先，明确目标。"],
  ["ZWJ 插在套话中", "首\u200d先，明确目标。"],
  ["软连字符插在套话中", "首\u00ad先，明确目标。"],
]) {
  const r = lint(t);
  zw.push({ name, chars: r.chars, score: r.score, metricWeight: r.metricWeight, ids: r.hits.map((h) => `${h.id}×${h.count}`) });
}
// 由 emojiCount 反推：加三个行首 emoji 行观察 emoji-marker/emoji-density 计数
const zwMetric = {};
for (const [name, t] of [["家庭emoji×3行首", "👨‍👩‍👧‍👦 一\n👨‍👩‍👧‍👦 二\n"], ["单emoji×3行首", "😀 一\n😀 二\n😀 三\n"]]) {
  const r = lint(t);
  zwMetric[name] = r.hits.filter((h) => h.id.startsWith("emoji")).map((h) => `${h.id}×${h.count}`);
}

// C. 正则状态复用
const { EMOJI_ALL_RE_UNUSED } = {};
const stateProbe = {};
{
  const re = /\p{Extended_Pictographic}/gu;
  re.test("😀😀");
  stateProbe["自定义 g 正则 test 后 lastIndex"] = re.lastIndex;
}

console.log("== A stripCode ==");
for (const r of rows) console.log(`${r.case}: inLen=${r.inLen} outLen=${r.outLen} out=${J(r.out)}`);
console.log("== A2 CRLF 口径 ==");
console.log(J(crlf, null, 1));
console.log("== B 零宽/emoji ==");
console.log(J(zw, null, 1));
console.log(J(zwMetric, null, 1));
console.log("== C 正则状态 ==");
console.log(J(stateProbe));
