// 外部校验：把检测器跑在「本机抓取的、2022 年前的真实中文网页文章」上。
//
// 用途：项目自造的语料（tests/corpus/）存在自证循环，本脚本用互联网上
// ChatGPT 之前的人类文本做外部校验，回答两个问题：
//   1) 检测器会不会把人类写的东西大面积判成 AI 腔（误报率）；
//   2) 命中的规则是「真指纹」还是「本来人人都这么写」。
//
// 用法：node tests/external_validate.mjs --dir <语料目录> [--out result.json] [--quiet]
// 语料目录里每个 <name>.txt 配一个同名 <name>.json（含 url/genre/dates/http_title）。
// 退出码：0 正常；1 目录不存在或没有可分析样本。

import fs from "node:fs";
import path from "node:path";
import { lint } from "../lib/lint.js";

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes(name);

const dir = opt("--dir", "D:/GitRepos/Others/tmp/corpus_pre2022");
const outFile = opt("--out", "");
const quiet = has("--quiet");

if (!fs.existsSync(dir)) {
  console.error(`语料目录不存在：${dir}`);
  process.exit(1);
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt"));
if (!files.length) {
  console.error(`目录里没有 .txt 样本：${dir}`);
  process.exit(1);
}

const rows = [];
for (const f of files.sort()) {
  const name = f.replace(/\.txt$/, "");
  const text = fs.readFileSync(path.join(dir, f), "utf8");
  let meta = {};
  const jf = path.join(dir, `${name}.json`);
  if (fs.existsSync(jf)) {
    try {
      meta = JSON.parse(fs.readFileSync(jf, "utf8"));
    } catch {
      meta = {};
    }
  }
  const r = lint(text, { maxSuggestions: 0 });
  rows.push({
    name,
    genre: meta.genre ?? "",
    url: meta.url ?? "",
    dates: meta.dates ?? [],
    title: (meta.http_title ?? "").slice(0, 60),
    chars: r.chars,
    score: r.score,
    band: r.band,
    bandLabel: r.bandLabel,
    analyzed: r.analyzed,
    hits: r.hits.map((h) => ({
      id: h.id,
      cat: h.cat,
      sev: h.sev,
      count: h.count,
      tier: h.tier ?? "",
      ...(has("--samples") ? { samples: (h.samples ?? []).slice(0, 3) } : {}),
    })),
  });
}

const scored = rows.filter((r) => r.analyzed !== false && r.chars > 0);
const nums = scored.map((r) => r.score).sort((a, b) => a - b);
const mean = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
const median = nums.length ? nums[Math.floor(nums.length / 2)] : 0;
const over35 = scored.filter((r) => r.score > 35);
const over15 = scored.filter((r) => r.score > 15);

const ruleTally = new Map();
for (const r of scored) {
  for (const h of r.hits) {
    const cur = ruleTally.get(h.id) ?? { id: h.id, cat: h.cat, tier: h.tier, texts: 0, total: 0 };
    cur.texts += 1;
    cur.total += h.count;
    ruleTally.set(h.id, cur);
  }
}
const tally = [...ruleTally.values()].sort((a, b) => b.texts - a.texts || b.total - a.total);

if (!quiet) {
  console.log("样本".padEnd(34) + "体裁".padEnd(12) + "字数".padStart(7) + "得分".padStart(6) + "  档位");
  for (const r of rows) {
    const gen = (r.genre || "-").slice(0, 10);
    console.log(`${r.name.padEnd(32)}  ${gen.padEnd(10)} ${String(r.chars).padStart(6)} ${String(r.score).padStart(5)}  ${r.bandLabel}`);
    if (r.hits.length) console.log("      ↳ " + r.hits.map((h) => `${h.id}${h.tier === "format" ? "(观)" : ""}x${h.count}`).join(" "));
  }
  console.log("");
  console.log(`样本 ${rows.length}（可分析 ${scored.length}）  均分 ${mean.toFixed(1)}  中位数 ${median}  最高 ${nums[nums.length - 1] ?? 0}`);
  console.log(`>15 分 ${over15.length} 篇（${((over15.length / scored.length) * 100).toFixed(1)}%）  >35 分 ${over35.length} 篇`);
  if (over35.length) {
    console.log("越线样本：");
    for (const r of over35) console.log(`  ${r.name} ${r.score} 分  ${r.hits.map((h) => h.id).join(",")}`);
  }
  console.log("");
  console.log("命中规则排行：");
  for (const t of tally) console.log(`  ${t.id.padEnd(24)} ${t.cat} ${t.tier === "format" ? "观察" : "定罪"}  ${t.texts} 篇 / ${t.total} 次`);
}

if (outFile) {
  const payload = {
    generatedAt: new Date().toISOString(),
    dir,
    sampleCount: rows.length,
    analyzable: scored.length,
    mean: Number(mean.toFixed(2)),
    median,
    max: nums[nums.length - 1] ?? 0,
    over15: over15.length,
    over35: over35.length,
    rows,
    ruleTally: tally,
  };
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8");
  if (!quiet) console.log(`\n结果写入 ${outFile}`);
}

process.exit(0);
