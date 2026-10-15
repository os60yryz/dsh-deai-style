// 真实语料回归：人写中文不该被打高分（误报），AI 腔中文不该被打低分（漏报）
//
// 用法：
//   node tests\corpus.mjs [--debug]
//
// 判据（每条样本可用 max/min 覆盖默认值）：
//   人写样本  score <= max   （默认 30：不得进入「中等 AI 腔」档，轻微档也只允许擦边）
//   AI 样本   score >= min   （默认 40）
//
// 退出码：0 = 全部通过；1 = 有样本失守。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { lint } from "../lib/lint.js";

const here = dirname(fileURLToPath(import.meta.url));
const DEBUG = process.argv.includes("--debug");

const HUMAN_MAX = 30;
const AI_MIN = 40;

function load(name) {
  return JSON.parse(readFileSync(join(here, "corpus", name), "utf8"));
}

const groups = [
  { kind: "human", file: "human_zh.json", items: load("human_zh.json") },
  { kind: "ai", file: "ai_zh.json", items: load("ai_zh.json") },
];

let pass = 0;
const failures = [];

for (const g of groups) {
  console.log(`\n===== ${g.kind === "human" ? "人写样本（防误报）" : "AI 腔样本（防漏报）"} · ${g.file} =====`);
  for (const item of g.items) {
    const r = lint(item.text);
    const limit = g.kind === "human" ? item.max ?? HUMAN_MAX : null;
    const floor = g.kind === "ai" ? item.min ?? AI_MIN : null;
    const ok = g.kind === "human" ? r.score <= limit : r.score >= floor;
    const judge = g.kind === "human" ? `<=${limit}` : `>=${floor}`;
    const ids = r.hits.map((h) => `${h.id}×${h.count}`).join(" ");
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${item.id}  score=${String(r.score).padStart(3)} (${judge})  ${r.band.padEnd(6)}  ${item.note}` +
        (ok ? "" : `\n      命中：${ids || "（无）"}`) +
        (DEBUG ? `\n      全文命中：${ids || "（无）"}` : ""),
    );
    if (ok) pass += 1;
    else failures.push({ id: item.id, kind: g.kind, score: r.score, limit: limit ?? floor, ids });
  }
}

const total = groups.reduce((n, g) => n + g.items.length, 0);
console.log(`\n${"-".repeat(60)}`);
console.log(`CORPUS pass=${pass} fail=${failures.length} total=${total}`);
if (failures.length) {
  console.log("失守清单：");
  for (const f of failures) {
    console.log(`  ${f.id} [${f.kind}] score=${f.score} 应${f.kind === "human" ? "<=" : ">="}${f.limit}｜命中 ${f.ids || "（无）"}`);
  }
}
process.exit(failures.length === 0 ? 0 : 1);
