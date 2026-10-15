// 策略验证：拿我自己的真实回复当输入，让模型按「输出策略」改写，再量前后差。
// 为什么不用 style_ab.mjs 那种「同一批提示词两组对比」：那测的是「提示词能不能预防」，
// 三轮下来方向不稳定（箭头密度 0.63 / 0.68 / 0 随运行翻转）。这里测的是「策略能不能修」，
// 输入是我实际写出来的文本分布，不存在「题目不够毒」的问题。
//
// 用法：
//   $env:DEEPSEEK_API_KEY = [Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY','User')
//   node tests/rewrite_eval.mjs <my_messages.json> [--top 6] [--min-chars 400] [--out <dir>]
//
// 退出码：0=跑完；2=参数/凭据；3=网络失败。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lint } from "../lib/lint.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_URL = "https://api.deepseek.com";
const MODEL = "deepseek-flash";

const argv = process.argv.slice(2);
const input = argv[0];
const argOf = (n, d) => (argv.indexOf(n) >= 0 && argv[argv.indexOf(n) + 1] ? argv[argv.indexOf(n) + 1] : d);
const TOP = Number(argOf("--top", "6"));
const SKIP = Number(argOf("--skip", "0"));
const MIN_CHARS = Number(argOf("--min-chars", "400"));
const OUT = argOf("--out", join(HERE, "..", "..", "..", "tmp", "rewrite_eval"));

if (!input) {
  console.error("用法: node tests/rewrite_eval.mjs <my_messages.json> [--top 6]");
  process.exit(2);
}

// 输出策略：不是「不要写什么」，而是「改成什么」。每条都对应一次实测到的缺陷。
const STRATEGY = `请把下面这段回复改写成更自然的中文。要求：
1. 散文里不出现箭头符号，前后对比写成「从 A 到 B」，流程写成「先……再……」或顿号。
2. 去掉「**标签**：内容」这种把句子切成标签的写法，改成完整句子。
3. 加粗只留真正需要警醒的一处，其余全部去掉。
4. 不用「不是X，而是Y」的句式，直接说结论。
5. 不要为了衔接而加连接词：不写「首先」「其次」「再次」「此外」「最后」「综上所述」「总之」「值得一提的是」「不难看出」。段落直接开始说事，换段就是换话题。
6. 标题能删就删，段落之间靠内容衔接。
7. 数字、路径、命令、错误信息必须原样保留，不得增删事实。
只输出改写后的正文，不要解释。`;

const raw = JSON.parse(readFileSync(input, "utf8"));
const picked = raw.rows
  .filter((r) => r.text.length >= MIN_CHARS)
  .map((r) => ({ ...r, r: lint(r.text) }))
  .sort((a, b) => b.r.score - a.r.score)
  .slice(SKIP, SKIP + TOP);

if (!picked.length) {
  console.error(`没有 ≥${MIN_CHARS} 字的样本`);
  process.exit(2);
}

const key = process.env.DEEPSEEK_API_KEY;
if (!key) {
  console.error("缺少 DEEPSEEK_API_KEY（§28：工具壳里该变量被擦除，需显式注入）");
  process.exit(2);
}

async function rewrite(text) {
  const res = await fetch(BASE_URL + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: STRATEGY },
        { role: "user", content: text },
      ],
      stream: false,
      temperature: 1.0,
      max_tokens: 4096,
      thinking: { type: "disabled" },
    }),
  });
  const rawText = await res.text();
  if (!res.ok) throw new Error("HTTP " + res.status + " " + rawText.slice(0, 300));
  const data = JSON.parse(rawText);
  const choice = data.choices && data.choices[0];
  if (!choice) throw new Error("无 choices");
  if (choice.finish_reason === "length") throw new Error("响应被截断");
  return (choice.message && choice.message.content) || "";
}

mkdirSync(OUT, { recursive: true });
const rows = [];
for (const p of picked) {
  process.stdout.write(`  turn${p.turn}/step${p.step} ${p.r.chars} 字 … `);
  const out = await rewrite(p.text);
  const after = lint(out);
  const ids = (r) =>
    r.hits
      .filter((h) => h.tier !== "format")
      .map((h) => `${h.id}x${h.count}`)
      .join(" ");
  rows.push({
    turn: p.turn,
    step: p.step,
    chars: p.r.chars,
    before: {
      score: p.r.score,
      layout: p.r.layout,
      flags: p.r.layout.flags,
      convict: ids(p.r),
      convictN: p.r.hits.filter((h) => h.tier !== "format").reduce((a, h) => a + h.count, 0),
    },
    after: {
      score: after.score,
      layout: after.layout,
      flags: after.layout.flags,
      chars: after.chars,
      convict: ids(after),
      convictN: after.hits.filter((h) => h.tier !== "format").reduce((a, h) => a + h.count, 0),
    },
    text: out,
  });
  console.log(
    `${p.r.score} -> ${after.score} 分   箭头 ${p.r.layout.arrows} -> ${after.layout.arrows}   定罪 [${ids(p.r)}] -> [${ids(after)}]`,
  );
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const k = (rows, side, field) => mean(rows.map((r) => r[side].layout[field]));
const sum = (rows, side, field) => rows.reduce((a, r) => a + r[side].layout[field], 0);
const summary = {
  n: rows.length,
  scoreBefore: +mean(rows.map((r) => r.before.score)).toFixed(1),
  scoreAfter: +mean(rows.map((r) => r.after.score)).toFixed(1),
  arrowsBefore: sum(rows, "before", "arrows"),
  arrowsAfter: sum(rows, "after", "arrows"),
  boldLabelsBefore: sum(rows, "before", "boldLabels"),
  boldLabelsAfter: sum(rows, "after", "boldLabels"),
  boldSpansBefore: sum(rows, "before", "boldSpans"),
  boldSpansAfter: sum(rows, "after", "boldSpans"),
  flaggedBefore: rows.filter((r) => r.before.flags.length).length,
  flaggedAfter: rows.filter((r) => r.after.flags.length).length,
  convictNBefore: rows.reduce((a, r) => a + r.before.convictN, 0),
  convictNAfter: rows.reduce((a, r) => a + r.after.convictN, 0),
  scorePer1000Before: +(mean(rows.map((r) => (r.before.score * 1000) / Math.max(r.chars, 300)))).toFixed(2),
  scorePer1000After: +(
    mean(rows.map((r) => (r.after.score * 1000) / Math.max(r.after.chars, 300)))
  ).toFixed(2),
};

// 我自己写出来的文本大多已经在 30 分以下、定罪很少，拿「降 50%」当门槛会误判——
// 真正要守住的是「排版被打平 + 不引入新套话 + 分数不升」。
const checks = [
  { name: "箭头总数下降 ≥80%", ok: summary.arrowsAfter <= summary.arrowsBefore * 0.2, detail: `${summary.arrowsBefore} -> ${summary.arrowsAfter}` },
  { name: "加粗标签清零", ok: summary.boldLabelsAfter === 0, detail: `${summary.boldLabelsBefore} -> ${summary.boldLabelsAfter}` },
  { name: "加粗数量下降 ≥50%", ok: summary.boldSpansAfter <= summary.boldSpansBefore * 0.5, detail: `${summary.boldSpansBefore} -> ${summary.boldSpansAfter}` },
  { name: "偏密样本清零", ok: summary.flaggedAfter === 0, detail: `${summary.flaggedBefore}/${summary.n} -> ${summary.flaggedAfter}/${summary.n}` },
  { name: "不引入新的套话（定罪条数不增加）", ok: summary.convictNAfter <= summary.convictNBefore, detail: `${summary.convictNBefore} -> ${summary.convictNAfter}` },
  { name: "AI 均分不上升", ok: summary.scoreAfter <= summary.scoreBefore, detail: `${summary.scoreBefore} -> ${summary.scoreAfter}` },
  { name: "篇幅不低于原文 60%", ok: mean(rows.map((r) => r.after.chars)) >= mean(rows.map((r) => r.chars)) * 0.6, detail: `${Math.round(mean(rows.map((r) => r.chars)))} -> ${Math.round(mean(rows.map((r) => r.after.chars)))}` },
];

const verdict = { summary, checks, pass: checks.every((c) => c.ok) };
const outPath = join(OUT, "rewrite_eval.json");
writeFileSync(outPath, JSON.stringify({ strategy: STRATEGY, rows, verdict }, null, 1));

console.log("\n" + JSON.stringify(summary, null, 1));
for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}  (${c.detail})`);
console.log(`\nVERDICT=${verdict.pass ? "PASS" : "FAIL"}  结果写入 ${outPath}`);
