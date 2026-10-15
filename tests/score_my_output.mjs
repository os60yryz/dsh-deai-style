// 给「我自己写给用户的正文」打分，看注入规则之后有没有变化。
// 用法: node tests/score_my_output.mjs <my_messages.json> [--restart-ts 1792076160000]
import fs from "node:fs";
import { lint, bandOf } from "../lib/lint.js";

const args = process.argv.slice(2);
const input = args[0];
if (!input) {
  console.error("用法: node tests/score_my_output.mjs <my_messages.json> [--restart-ts <ms>]");
  process.exit(2);
}
const tsIdx = args.indexOf("--restart-ts");
const restartTs = tsIdx >= 0 ? Number(args[tsIdx + 1]) : Infinity;

const data = JSON.parse(fs.readFileSync(input, "utf8"));
const rows = data.rows.map((r) => ({ ...r, r: lint(r.text) }));

function stats(list) {
  if (!list.length) return null;
  const scores = list.map((x) => x.r.score).sort((a, b) => a - b);
  const sum = scores.reduce((a, b) => a + b, 0);
  const bands = { clean: 0, slight: 0, medium: 0, heavy: 0 };
  for (const s of scores) bands[bandOf(s).key]++;
  return {
    n: list.length,
    chars: list.reduce((a, x) => a + x.r.chars, 0),
    mean: +(sum / scores.length).toFixed(1),
    median: scores[Math.floor(scores.length / 2)],
    max: scores[scores.length - 1],
    over35: scores.filter((s) => s > 35).length,
    bands,
  };
}

function line(label, s) {
  if (!s) return console.log(`${label}: 无样本`);
  console.log(
    `${label}: n=${s.n} 字数=${s.chars} 均分=${s.mean} 中位=${s.median} 最高=${s.max} >35 的 ${s.over35} 条 | ` +
      `基本没有 ${s.bands.clean} / 轻微 ${s.bands.slight} / 中等 ${s.bands.medium} / 明显 ${s.bands.heavy}`,
  );
}

console.log("=== 总体");
line("全部", stats(rows));

const before = rows.filter((r) => !(r.time > restartTs));
const after = rows.filter((r) => r.time > restartTs);
console.log("\n=== 按插件是否已生效切分（restart_ts=" + restartTs + "）");
line("插件生效前", stats(before));
line("插件生效后", stats(after));

console.log("\n=== 按会话");
const bySession = new Map();
for (const r of rows) {
  if (!bySession.has(r.session)) bySession.set(r.session, []);
  bySession.get(r.session).push(r);
}
for (const [sid, list] of bySession) {
  const t = new Date(list[0].session_started).toISOString().slice(0, 16);
  line(`${t}  ${sid.slice(0, 20)}`, stats(list));
}

console.log("\n=== 分最高的 12 条");
for (const r of [...rows].sort((a, b) => b.r.score - a.r.score).slice(0, 12)) {
  console.log(`\n[${r.r.score} 分 ${r.r.bandLabel}] turn${r.turn}/step${r.step} ${r.r.chars} 字  ${r.session.slice(0, 20)}`);
  console.log(`  ${r.text.slice(0, 90).replace(/\n/g, " ")}…`);
  for (const h of r.r.hits.slice(0, 4)) {
    const tier = h.tier === "format" ? "观察" : "定罪";
    console.log(`   - ${h.id} (${h.cat}, sev${h.sev}, ${tier}) x${h.count}  « ${(h.samples[0] ?? "").slice(0, 50)} »`);
  }
}

console.log("\n=== 有「定罪级」命中的样本（观察项不算）");
const convicted = rows.filter((r) => r.r.hits.some((h) => h.tier !== "format"));
for (const r of convicted.sort((a, b) => b.r.score - a.r.score)) {
  const hits = r.r.hits.filter((h) => h.tier !== "format");
  console.log(`\n[${r.r.score} 分] turn${r.turn}/step${r.step} ${r.r.chars} 字`);
  for (const h of hits) {
    console.log(`   - ${h.id} (${h.cat}, sev${h.sev}) x${h.count}  例：「${(h.samples[0] ?? "").replace(/\n/g, " ").slice(0, 60)}」`);
  }
}
console.log(`\n合计：${convicted.length}/${rows.length} 条正文有定罪级命中`);

console.log("\n=== 高频命中（全部样本汇总）");
const tally = new Map();
for (const r of rows) {
  for (const h of r.r.hits) {
    const k = `${h.id}\t${h.tier === "format" ? "观察" : "定罪"}`;
    const cur = tally.get(k) ?? { docs: 0, count: 0 };
    cur.docs += 1;
    cur.count += h.count;
    tally.set(k, cur);
  }
}
for (const [k, v] of [...tally.entries()].sort((a, b) => b[1].docs - a[1].docs)) {
  const [id, tier] = k.split("\t");
  console.log(`  ${String(v.docs).padStart(3)} 篇 / ${String(v.count).padStart(4)} 次  ${id}  [${tier}]`);
}
