#!/usr/bin/env node
// deai：命令行版去 AI 腔。两个子命令。
//   node tools/deai.mjs scan <文件|->        只打分，不花 token
//   node tools/deai.mjs fix  <文件|-> [--out 文件]   调 deepseek-flash 改写，再打分对比
// 需要 DEEPSEEK_API_KEY（工具壳里该变量被擦除，用前先显式注入）。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { lint, renderReport } from "../lib/lint.js";
import { STRATEGY, chunkText } from "../lib/rewrite.js";

const BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const MODEL = process.env.DEEAI_MODEL || "deepseek-flash";

const here = dirname(fileURLToPath(import.meta.url));

function usage(code = 0) {
  console.log(`用法:
  node tools/deai.mjs scan <文件|-> [--json]        只打分（本地，不调 API）
  node tools/deai.mjs fix  <文件|-> [--out 文件]     改写（需 DEEPSEEK_API_KEY）

例子:
  node tools/deai.mjs scan draft.md
  type draft.md | node tools/deai.mjs fix - --out clean.md`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { cmd: null, input: null, json: false, outFile: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--out") out.outFile = argv[++i];
    else if (a === "-h" || a === "--help") usage(0);
    else rest.push(a);
  }
  out.cmd = rest[0] || null;
  out.input = rest[1] || null;
  return out;
}

function readInput(target) {
  if (!target || target === "-") {
    return readFileSync(0, "utf8");
  }
  return readFileSync(resolve(process.cwd(), target), "utf8");
}

async function rewriteOne(text, key) {
  const res = await fetch(BASE_URL + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "你是中文写作编辑，擅长去掉机器腔。" },
        { role: "user", content: STRATEGY + "\n\n---\n\n" + text },
      ],
      thinking: { type: "disabled" },
      temperature: 1.0,
      max_tokens: Math.max(1024, Math.min(8000, Math.ceil(text.length * 1.6))),
    }),
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new Error("输出被 max_tokens 截断（finish_reason=length），请分段后再试");
  }
  return (choice?.message?.content || "").trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.cmd || !["scan", "fix"].includes(args.cmd)) usage(2);

  const text = readInput(args.input);
  if (!text.trim()) {
    console.error("输入为空");
    process.exit(2);
  }

  if (args.cmd === "scan") {
    const r = lint(text);
    if (args.json) console.log(JSON.stringify(r, null, 2));
    else console.log(renderReport(r));
    return;
  }

  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    console.error("缺少 DEEPSEEK_API_KEY。工具壳里该变量会被擦除，先显式注入：");
    console.error("  $env:DEEPSEEK_API_KEY = [Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY','User')");
    process.exit(2);
  }

  const before = lint(text);
  const chunks = chunkText(text);
  if (chunks.length > 1) console.error(`分 ${chunks.length} 段改写…`);
  const parts = [];
  for (const c of chunks) parts.push(await rewriteOne(c, key));
  const after = parts.join("\n\n");

  if (args.outFile) {
    writeFileSync(resolve(process.cwd(), args.outFile), after + "\n", { encoding: "utf8" });
    console.error(`已写入 ${args.outFile}`);
  } else {
    console.log(after);
  }

  const afterLint = lint(after);
  console.error(
    `\n分数 ${before.score} -> ${afterLint.score}（${before.bandLabel} -> ${afterLint.bandLabel}），字数 ${before.chars} -> ${afterLint.chars}`,
  );
  const convict = (r) => r.hits.filter((h) => h.tier !== "format").map((h) => `${h.id}×${h.count}`).join(" ") || "无";
  console.error(`定罪 ${convict(before)} -> ${convict(afterLint)}`);
}

main().catch((e) => {
  console.error("失败：" + e.message);
  process.exit(1);
});
