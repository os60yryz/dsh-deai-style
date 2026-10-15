// deai-style A/B 效果验证：同一批中文提示词，基线（无去AI风格规则） vs 实验（注入 strict 规则段）
// 用插件自带 lib/lint.js 对两边产出打分，统计均值差与命中模式差。
//
// 用法（必须先注入凭据，见 ~/.dsh/AGENTS.md §28）：
//   $env:DEEPSEEK_API_KEY = [Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY','User')
//   node tests/ab_test.mjs [--out <dir>] [--repeats 1] [--dry-run]
//
// 退出码：0=跑完并产出报告；2=参数/凭据问题；3=网络/接口失败。

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lint } from "../lib/lint.js";
import { renderPrompt } from "../lib/prompt.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_URL = "https://api.deepseek.com";
const MODEL = "deepseek-flash";

// ---------- 参数 ----------
const argv = process.argv.slice(2);
function argOf(name, dflt) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
}
const OUT_DIR = argOf("--out", join(HERE, "..", "..", "..", "tmp", "deai_ab"));
const REPEATS = Number(argOf("--repeats", "1"));
// 验收口径（用户在 2026-10-15 确认）：平均分下降 ≥50%，且基线 ≥35 分的题目全部降到 35 分以下
const MIN_DROP_PCT = Number(argOf("--min-drop-pct", "50"));
const TARGET = Number(argOf("--target", "35"));
const HIGH_BAR = Number(argOf("--high-bar", "35"));
const DRY = argv.includes("--dry-run");

// ---------- 样本提示词 ----------
// 刻意选择「容易诱发 AI 腔」的中文题目：利弊分析、意义阐释、说理型
const PROMPTS = [
  { id: "p1", text: "请写一段介绍远程办公优缺点的文字，200 字左右。" },
  { id: "p2", text: "解释一下为什么很多人戒不掉刷短视频，200 字左右。" },
  { id: "p3", text: "讲讲学编程对普通人的意义，200 字左右。" },
  { id: "p4", text: "写一段关于延迟满足的话，200 字左右。" },
  { id: "p5", text: "说说人工智能对未来就业的影响，200 字左右。" },
  { id: "p6", text: "说说早起的好处，200 字左右。" },
];

const DEAI_SYSTEM = renderPrompt({ level: "strict", extraRules: "", toolName: "deai_scan" });
const CONDITIONS = [
  { id: "baseline", label: "基线（无规则）", system: "" },
  { id: "deai", label: "实验（strict 规则）", system: DEAI_SYSTEM },
];

// ---------- 调用 ----------
async function callOnce(key, prompt, system) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  const body = {
    model: MODEL,
    messages,
    stream: false,
    temperature: 1.0,
    max_tokens: 1024,
    thinking: { type: "disabled" }, // §27.3 非必要一律显式关闭思考
  };
  const started = Date.now();
  const res = await fetch(BASE_URL + "/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + key,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error("HTTP " + res.status + " " + text.slice(0, 400));
  const data = JSON.parse(text);
  const choice = data.choices && data.choices[0];
  if (!choice) throw new Error("无 choices: " + text.slice(0, 300));
  if (choice.finish_reason === "length") throw new Error("响应被截断 (finish_reason=length)");
  return {
    text: (choice.message && choice.message.content) || "",
    usage: data.usage || {},
    ms: Date.now() - started,
  };
}

// ---------- 主流程 ----------
function summarize(rows, condId) {
  const list = rows.filter((r) => r.condition === condId && r.ok);
  if (!list.length) return null;
  const scores = list.map((r) => r.lint.score);
  const chars = list.map((r) => r.lint.chars);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const bandCount = {};
  for (const r of list) bandCount[r.lint.band] = (bandCount[r.lint.band] || 0) + 1;
  // 每条规则的命中样本数
  const ruleHits = {};
  for (const r of list) {
    for (const h of r.lint.hits) {
      ruleHits[h.id] = ruleHits[h.id] || { id: h.id, cat: h.cat, sev: h.sev, samples: 0, count: 0 };
      ruleHits[h.id].samples += 1;
      ruleHits[h.id].count += h.count;
    }
  }
  return {
    condition: condId,
    n: list.length,
    meanScore: Number(mean(scores).toFixed(1)),
    meanChars: Math.round(mean(chars)),
    bandCount,
    ruleHits: Object.values(ruleHits).sort((a, b) => b.samples - a.samples || a.id.localeCompare(b.id)),
  };
}

async function main() {
  const key = (process.env.DEEPSEEK_API_KEY || "").trim();
  if (!key && !DRY) {
    console.error("FAIL 未取到 DEEPSEEK_API_KEY：请在 pwsh 内先注入用户级环境变量后再运行（AGENTS.md §28.2）");
    process.exit(2);
  }
  console.log(`# deai-style A/B  model=${MODEL}  repeats=${REPEATS}  dry=${DRY}`);
  console.log(`# 规则段长度 strict=${DEAI_SYSTEM.length} 字符`);

  mkdirSync(OUT_DIR, { recursive: true });
  const rows = [];
  for (let rep = 1; rep <= REPEATS; rep++) {
    for (const p of PROMPTS) {
      for (const c of CONDITIONS) {
        const tag = `${p.id}_${c.id}${REPEATS > 1 ? "_r" + rep : ""}`;
        if (DRY) {
          console.log(`[dry] ${tag}`);
          continue;
        }
        try {
          const r = await callOnce(key, p.text, c.system);
          const lg = lint(r.text, { maxSuggestions: 8 });
          writeFileSync(join(OUT_DIR, tag + ".txt"), r.text, { encoding: "utf8" });
          rows.push({
            prompt: p.id,
            promptText: p.text,
            condition: c.id,
            repeat: rep,
            ok: true,
            chars: r.text.length,
            usage: r.usage,
            ms: r.ms,
            lint: {
              score: lg.score,
              band: lg.band,
              bandLabel: lg.bandLabel,
              counts: lg.counts,
              byCategory: lg.byCategory,
              hits: lg.hits,
            },
          });
          console.log(`[ok] ${tag}  score=${lg.score} band=${lg.band} chars=${r.text.length} ms=${r.ms}`);
        } catch (e) {
          rows.push({ prompt: p.id, condition: c.id, repeat: rep, ok: false, error: String(e.message || e) });
          console.log(`[ERR] ${tag}  ${e.message || e}`);
        }
      }
    }
  }
  if (DRY) return 0;

  const base = summarize(rows, "baseline");
  const deai = summarize(rows, "deai");
  const report = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    repeats: REPEATS,
    promptCount: PROMPTS.length,
    strictPromptChars: DEAI_SYSTEM.length,
    rows,
    summary: { baseline: base, deai },
  };
  writeFileSync(join(OUT_DIR, "ab_result.json"), JSON.stringify(report, null, 2), { encoding: "utf8" });

  // 控制台对照表（多轮时取每题的均值）
  const perPrompt = PROMPTS.map((p) => {
    const bs = rows.filter((r) => r.prompt === p.id && r.condition === "baseline" && r.ok).map((r) => r.lint.score);
    const ds = rows.filter((r) => r.prompt === p.id && r.condition === "deai" && r.ok).map((r) => r.lint.score);
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
    return { id: p.id, baselineMean: avg(bs), deaiMean: avg(ds), n: Math.min(bs.length, ds.length) };
  });
  console.log("\n## 逐条对照（score：越高越像 AI 腔；多轮取均值）");
  console.log("prompt | baseline | deai | 差值 | 基线≥35 是否降到 <35");
  for (const pp of perPrompt) {
    const b = pp.baselineMean.toFixed(1);
    const d = pp.deaiMean.toFixed(1);
    const diff = (pp.baselineMean - pp.deaiMean).toFixed(1);
    let ok = "-";
    if (pp.baselineMean >= HIGH_BAR) ok = pp.deaiMean < TARGET ? "是" : "**否**";
    console.log(`${pp.id} | ${b} | ${d} | ${diff} | ${ok}`);
  }

  // ---------- 按用户确认的验收口径判定 ----------
  const verdict = { criteria: { minDropPct: MIN_DROP_PCT, target: TARGET, highBar: HIGH_BAR }, checks: [] };
  if (base && deai) {
    const drop = base.meanScore - deai.meanScore;
    const pct = base.meanScore > 0 ? (drop / base.meanScore) * 100 : 0;
    verdict.summary = {
      baselineMean: base.meanScore,
      deaiMean: deai.meanScore,
      drop: Number(drop.toFixed(1)),
      dropPct: Number(pct.toFixed(1)),
      baselineRuleKinds: base.ruleHits.length,
      deaiRuleKinds: deai.ruleHits.length,
      perPrompt,
    };
    verdict.checks.push({ name: `平均分下降 ≥${MIN_DROP_PCT}%`, ok: pct >= MIN_DROP_PCT, detail: `${pct.toFixed(1)}%` });
    const high = perPrompt.filter((p) => p.baselineMean >= HIGH_BAR);
    const highFail = high.filter((p) => !(p.deaiMean < TARGET));
    verdict.checks.push({
      name: `基线高分样本（≥${HIGH_BAR}）全部降到 <${TARGET}`,
      ok: highFail.length === 0,
      detail: `高分样本 ${high.map((p) => p.id).join(",") || "无"}；未达标 ${highFail.map((p) => `${p.id}=${p.deaiMean.toFixed(1)}`).join(",") || "无"}`,
    });
    verdict.pass = verdict.checks.every((c) => c.ok);

    console.log(`\n均值：baseline=${base.meanScore}  deai=${deai.meanScore}  下降=${drop.toFixed(1)}（${pct.toFixed(1)}%）`);
    console.log(`命中规则种类：baseline=${base.ruleHits.length}  deai=${deai.ruleHits.length}`);
    console.log("baseline 高频命中：" + base.ruleHits.slice(0, 8).map((h) => `${h.id}×${h.samples}`).join(", "));
    console.log("deai 残留命中：" + (deai.ruleHits.slice(0, 8).map((h) => `${h.id}×${h.samples}`).join(", ") || "（无）"));
    console.log("\n## 验收判定");
    for (const c of verdict.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}  → ${c.detail}`);
    console.log(`VERDICT=${verdict.pass ? "PASS" : "FAIL"}`);
  }
  report.verdict = verdict;
  writeFileSync(join(OUT_DIR, "ab_result.json"), JSON.stringify(report, null, 2), { encoding: "utf8" });
  console.log(`\n原始产出：${OUT_DIR}`);
  const failed = rows.filter((r) => !r.ok);
  return failed.length ? 3 : 0;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error("FATAL " + (e.stack || e));
  process.exit(3);
});
