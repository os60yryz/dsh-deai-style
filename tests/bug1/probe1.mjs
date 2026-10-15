// 临时探针：只读调用仓库实现，不改动任何源文件
import { lint, stripCode, renderReport, bandOf, BANDS } from "../../lib/lint.js";
import { RULES, METRICS } from "../../lib/ruleset.js";
import { renderPrompt } from "../../lib/prompt.js";
import { planRegistrations, normalizeConfig } from "../../lib/plan.js";
import { Config, apply } from "../../index.js";

const out = [];
const say = (...a) => out.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "));

function deepScan(v, path = "$", bad = []) {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) bad.push(`${path}=${v}`);
  } else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) deepScan(x, `${path}.${k}`, bad);
  }
  return bad;
}

// ---------- 1. 边界输入 ----------
const cases = {
  empty: "",
  space: "   ",
  newlines: "\n\n\n",
  crlf: "第一段。\r\n\r\n第二段。\r\n",
  tabs: "\t\t\t\n\t\n",
  punctOnly: "，。！？；、",
  oneChar: "好",
  oneLine: "这是一行没有句号的文字",
  table: "| 维度 | 层面 |\n| --- | --- |\n| 生态 | 链路 |\n",
  quote: "> 这是一段引用。\n> 第二行。\n",
  unterminatedFence: "```js\nconst a = 1;\n还是代码\n",
  emoji: "💡🚀 好",
  loneSurrogate: "abc\uD83D",
  fmt: "- **小标题**：内容\n- **第二**：内容\n",
};
for (const [k, v] of Object.entries(cases)) {
  let r, err = null;
  try {
    r = lint(v);
  } catch (e) {
    err = String(e && e.message);
  }
  if (err) say(`CASE ${k}: THROW ${err}`);
  else say(`CASE ${k}: score=${r.score} chars=${r.chars} lines=${r.counts.contentLines} hits=${r.hits.length} bad=${JSON.stringify(deepScan(r))}`);
}

// ---------- 2. 大输入 / 回溯 ----------
function timed(label, fn) {
  const t0 = Date.now();
  let v, e = null;
  try {
    v = fn();
  } catch (err) {
    e = String(err && err.message);
  }
  say(`TIME ${label}: ${Date.now() - t0}ms ${e ? "THROW " + e : "ok " + JSON.stringify(v).slice(0, 120)}`);
}
timed("stripCode(100k 换行)", () => stripCode("\n".repeat(100000)).length);
timed("stripCode(100k 空格)", () => stripCode(" ".repeat(100000)).length);
timed("stripCode(50k 表格行)", () => stripCode("| a | b |\n".repeat(5000)).length);
timed("lint(100k 'a')", () => lint("a".repeat(100000)).score);
timed("lint(100k 中文无边标点)", () => lint("中文句子没有标点".repeat(8000)).score);
timed("lint(100k 换行)", () => lint("\n".repeat(100000)).score);
timed("lint(20k '不是')", () => lint("不是".repeat(10000)).score);
timed("lint(20k '|')", () => lint("|".repeat(20000)).score);
timed("lint(100k 混合)", () => lint(("首先，我们要进行深入的分析。".repeat(2000))).score);

// ---------- 3. 分数边界 / 随机 fuzz ----------
let minS = 999, maxS = -999, nonInt = 0, nan = 0;
const alphabet = "的一是了我不人在他有这上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很给名法间斯知世什两次使身者被高已亲其进此话常与活正感";
for (let i = 0; i < 3000; i += 1) {
  let s = "";
  const n = Math.floor(Math.random() * 400);
  for (let j = 0; j < n; j += 1) {
    const r = Math.random();
    if (r < 0.03) s += "\n";
    else if (r < 0.06) s += "，";
    else if (r < 0.08) s += "！";
    else if (r < 0.1) s += "\t";
    else s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  const r = lint(s);
  if (deepScan(r).length) nan += 1;
  if (!Number.isInteger(r.score)) nonInt += 1;
  if (r.score < minS) minS = r.score;
  if (r.score > maxS) maxS = r.score;
  if (r.score < 0 || r.score > 100) say(`FUZZ OUT OF RANGE score=${r.score} text=${JSON.stringify(s.slice(0, 40))}`);
}
say(`FUZZ 3000 例: min=${minS} max=${maxS} nonInt=${nonInt} nonFinite=${nan}`);

// ---------- 4. 规则正则 lastIndex 泄漏 ----------
lint("首先，我们要进行分析。一方面既如此，另一方面又如此。");
const leaked = RULES.filter((r) => r.re.lastIndex !== 0).map((r) => r.id);
say(`lastIndex 非零规则: ${JSON.stringify(leaked)}`);

// ---------- 5. 具体规则行为 ----------
const checks = [
  ["let-us 常见中文", "让我们来看看这个方案。"],
  ["let-us 后接空白", "让我们 look at this。"],
  ["let-us 后接标点", "让我们，一起做。"],
  ["both-sides 无还", "这个方案既方便又便宜。"],
  ["both-sides 有还", "这个方案既方便又便宜还好用。"],
  ["both-sides 既有也有", "这个方案既有优点也有缺点。"],
  ["not-x-but-y", "这不是效率问题，而是组织能力的问题。"],
  ["未闭合围栏里的规则", "```js\n这是进行深入分析的赋能里程碑。\n"],
  ["闭合围栏里的规则", "```js\n这是进行深入分析的赋能里程碑。\n```\n"],
  ["emoji 变体选择符单独出现", "文字\uFE0F文字"],
  ["markdown 粗体标签整行", "- **小标题**：内容"],
];
for (const [label, t] of checks) {
  const r = lint(t);
  say(`RULE ${label}: score=${r.score} ids=${JSON.stringify(r.hits.map((h) => h.id + "x" + h.count))}`);
}

// ---------- 6. maxSuggestions 边界 ----------
for (const ms of [undefined, 0, -1, 1.5, 1e9, "3"]) {
  try {
    const r = lint("首先，我们要进行分析。此外，值得注意的是，这不是效率问题，而是组织能力的问题。", { maxSuggestions: ms });
    say(`maxSuggestions=${JSON.stringify(ms)} -> suggestions=${r.suggestions.length}`);
  } catch (e) {
    say(`maxSuggestions=${JSON.stringify(ms)} -> THROW ${e.message}`);
  }
}

// ---------- 7. renderReport 异常形状 ----------
for (const [label, v] of [
  ["undefined", undefined],
  ["空对象", {}],
  ["缺 byCategory", { score: 1, bandLabel: "x", chars: 1, weighted: 1, density: 1, hits: [], suggestions: [] }],
  ["hits 无 samples", { score: 1, bandLabel: "x", chars: 1, weighted: 1, density: 1, byCategory: {}, hits: [{ id: "a", cat: "lex", sev: 1, count: 1 }], suggestions: [] }],
]) {
  try {
    const s = renderReport(v);
    say(`renderReport(${label}) -> ok len=${String(s).length}`);
  } catch (e) {
    say(`renderReport(${label}) -> THROW ${e.message}`);
  }
}

// ---------- 8. 配置边界 ----------
for (const [label, c] of [
  ["enabled:'false'", { enabled: "false" }],
  ["enabled:0", { enabled: 0 }],
  ["enabled:null", { enabled: null }],
  ["level:123", { level: 123 }],
  ["level:null", { level: null }],
  ["position:'Top'", { position: "Top" }],
  ["position:null", { position: null }],
  ["extraRules:123", { extraRules: 123 }],
  ["extraRules:null", { extraRules: null }],
  ["injectLintTool:'false'", { injectLintTool: "false" }],
  ["injectLintTool:0", { injectLintTool: 0 }],
]) {
  let n, p = "n/a";
  try {
    n = normalizeConfig(c);
    p = planRegistrations(c, { personaPrefix: 0, personaSuffix: 10200 }) ? "ON" : "OFF";
  } catch (e) {
    p = "THROW " + e.message;
  }
  say(`CONFIG ${label}: ${JSON.stringify(n)} plan=${p}`);
}

// Config schema 解析（真实 schemastery）
for (const [label, c] of [
  ["{}", {}],
  ["enabled:'false'", { enabled: "false" }],
  ["enabled:0", { enabled: 0 }],
  ["level:123", { level: 123 }],
  ["extraRules:123", { extraRules: 123 }],
  ["不存在的键", { nope: 1 }],
]) {
  try {
    say(`SCHEMA ${label}: ${JSON.stringify(Config(c))}`);
  } catch (e) {
    say(`SCHEMA ${label}: THROW ${String(e.message).split("\n")[0]}`);
  }
}

// extraRules 含模板插值语法
const ruleText = renderPrompt({ level: "soft", extraRules: "禁止 {{foo}} 与 {{ bar }}。" });
say(`extraRules 原样保留 {{}}: ${ruleText.includes("{{foo}}") && ruleText.includes("{{ bar }}")}`);

// ---------- 9. tool 契约（走真实 defineTool 包装） ----------
const calls = { tools: [], sections: [] };
const ctx = {
  effect(cb, label) {
    const r = cb();
    return typeof r === "function" ? r : () => {};
  },
  systemPrompt: {
    getSectionOrder: (n) => (n === "DEPLOYMENT_PERSONA_PREFIX" ? 0 : 10200),
    section(s) {
      calls.sections.push(s);
      return () => {};
    },
  },
  tools: {
    register(t) {
      calls.tools.push(t);
      return () => {};
    },
  },
};
apply(ctx, {});
const tool = calls.tools[0];
say(`TOOL name=${tool.name} params=${JSON.stringify(tool.parameters)}`);
say(`TOOL output.schema=${JSON.stringify(tool.output.schema)}`);
const tryExec = async (label, args) => {
  try {
    const v = await tool.execute(args);
    say(`TOOL execute(${label}) -> ok score=${v.score}`);
  } catch (e) {
    say(`TOOL execute(${label}) -> THROW ${e.name}: ${String(e.message).slice(0, 160)}`);
  }
};
await tryExec("undefined", undefined);
await tryExec("null", null);
await tryExec("{}", {});
await tryExec("{text:123}", { text: 123 });
await tryExec("{text:null}", { text: null });
await tryExec("{text:'x',maxSuggestions:-1}", { text: "首先，我们进行分析。此外还要注意。", maxSuggestions: -1 });
await tryExec("{text:'x',maxSuggestions:0}", { text: "首先，我们进行分析。此外还要注意。", maxSuggestions: 0 });
await tryExec("{text:'x',maxSuggestions:1.5}", { text: "首先，我们进行分析。", maxSuggestions: 1.5 });
await tryExec("{text:'x',maxSuggestions:'3'}", { text: "首先，我们进行分析。", maxSuggestions: "3" });
try {
  const v = await tool.execute({ text: "首先，我们要进行分析。", maxSuggestions: 2 });
  const b = tool.output.render({ text: "x" }, v);
  say(`TOOL render -> blocks=${b.length} type=${b[0].type} textLen=${b[0].text.length}`);
} catch (e) {
  say(`TOOL render -> THROW ${e.message}`);
}

console.log(out.join("\n"));
