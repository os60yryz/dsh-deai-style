// 绕过测试：用户明确要求「分点列表」时，去 AI 腔约束还守不守得住？
//
// 这是三轮红蓝军都留下的同一个未解问题（离线审查无法回答，必须真调模型）：
// 用户一句「请用分点列表详细说明」在第二轮曾被认为可以整段绕过约束。
// 第三轮把「不要用 `- **小标题**：内容` 卡片结构」提到了核心档（第 11 条），本脚本验证它是否有效。
//
// 用法：
//   $env:DEEPSEEK_API_KEY = [Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY','User')
//   node tests/bypass_test.mjs [--repeats 1] [--out tmp/bypass] [--dry-run]
//
// 判定：注入组的「卡片行」总数必须显著低于基线组，且注入组卡片行 / 列表行 占比 < 50%。
// 退出码：0 PASS，2 缺凭据，3 网络或调用失败。

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { lint } from "../lib/lint.js";
import { renderPrompt } from "../lib/prompt.js";

const MODEL = "deepseek-flash";
const BASE_URL = "https://api.deepseek.com";

const PROMPTS = [
  { id: "b1", text: "请用分点列表详细说明远程办公的优缺点。" },
  { id: "b2", text: "分点列出学习编程的五个理由，每点简单解释一下。" },
  { id: "b3", text: "用列表形式总结延迟满足对个人的好处。" },
  { id: "b4", text: "请分条说明，为什么很多人戒不掉刷短视频。" },
];

const CARD_RE = /^[ \t]*(?:[-*+]|\d+[.、])[ \t]+\*\*[^*\n]{2,24}\*\*[：: ]/;
const BULLET_RE = /^[ \t]*(?:[-*+]|\d+[.、])[ \t]+\S/;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const repeats = Number(arg("repeats", 1)) || 1;
const outDir = String(arg("out", "tmp/bypass"));
const dryRun = Boolean(arg("dry-run", false));
const minCut = Number(arg("min-cut-pct", 60)) || 60;

const API_KEY = process.env.DEEPSEEK_API_KEY ?? "";
if (!dryRun && !API_KEY) {
  console.error("缺少 DEEPSEEK_API_KEY（工具壳里必须显式注入，见 AGENTS §28）");
  process.exit(2);
}

async function ask(system, user) {
  const body = {
    model: MODEL,
    messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: user }],
    stream: false,
    temperature: 1.0,
    // 这里故意放宽到 3072：题目要求「详细说明/分点列出」，基线组很容易写长，
    // 1024 会触发 finish_reason=length 而被守卫拦下（截断会让卡片行数偏少，污染对比）。
    max_tokens: 3072,
    thinking: { type: "disabled" },
  };
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const choice = json.choices?.[0];
  if (!choice) throw new Error("响应里没有 choices");
  if (choice.finish_reason === "length") throw new Error("输出被 max_tokens 截断（finish_reason=length）");
  return choice.message?.content ?? "";
}

function measure(text) {
  const lines = text.split("\n");
  const cards = lines.filter((l) => CARD_RE.test(l)).length;
  const bullets = lines.filter((l) => BULLET_RE.test(l)).length;
  const r = lint(text);
  return { cards, bullets, score: r.score, band: r.band, chars: r.chars };
}

const SYSTEM = renderPrompt({ level: "strict", extraRules: "", toolName: "deai_scan" });

if (dryRun) {
  console.log(`模型 ${MODEL}｜题数 ${PROMPTS.length}｜轮数 ${repeats}`);
  console.log(`注入提示词 ${SYSTEM.length} 字符；判定：注入组卡片行总数比基线下降 ≥${minCut}%，且卡片/列表 <50%`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const rows = [];
for (const p of PROMPTS) {
  for (let r = 1; r <= repeats; r += 1) {
    for (const group of ["baseline", "deai"]) {
      const system = group === "deai" ? SYSTEM : null;
      let text = "";
      try {
        text = await ask(system, p.text);
      } catch (err) {
        console.error(`[失败] ${p.id} r${r} ${group}: ${err.message}`);
        process.exit(3);
      }
      const mm = measure(text);
      rows.push({ prompt: p.id, round: r, group, ...mm });
      writeFileSync(join(outDir, `${p.id}_r${r}_${group}.txt`), text, "utf8");
      console.log(
        `${p.id} r${r} ${group.padEnd(8)} 卡片行=${String(mm.cards).padStart(2)} 列表行=${String(mm.bullets).padStart(2)} 分数=${String(mm.score).padStart(3)} ${mm.band}`,
      );
    }
  }
}

const sum = (g, k) => rows.filter((x) => x.group === g).reduce((a, b) => a + b[k], 0);
const baseCards = sum("baseline", "cards");
const deaiCards = sum("deai", "cards");
const deaiBullets = sum("deai", "bullets");
const baseScore = rows.filter((x) => x.group === "baseline").reduce((a, b) => a + b.score, 0);
const deaiScore = rows.filter((x) => x.group === "deai").reduce((a, b) => a + b.score, 0);
const n = rows.length / 2;
const cutPct = baseCards > 0 ? Math.round(((baseCards - deaiCards) / baseCards) * 1000) / 10 : 100;
const cardShare = deaiBullets > 0 ? Math.round((deaiCards / deaiBullets) * 1000) / 1000 : 0;

const checks = [
  {
    name: `卡片行下降 ≥${minCut}%`,
    ok: cutPct >= minCut,
    detail: `基线 ${baseCards} → 注入 ${deaiCards}（${cutPct}%）`,
  },
  {
    name: "注入组卡片行占列表行 <50%",
    ok: cardShare < 0.5,
    detail: `${deaiCards}/${deaiBullets} = ${cardShare}`,
  },
  {
    name: "注入组平均分低于基线",
    ok: deaiScore < baseScore,
    detail: `${Math.round((baseScore / n) * 10) / 10} → ${Math.round((deaiScore / n) * 10) / 10}`,
  },
];
const pass = checks.every((c) => c.ok);
const result = {
  model: MODEL,
  repeats,
  prompts: PROMPTS.map((p) => p.id),
  systemChars: SYSTEM.length,
  summary: {
    baselineCards: baseCards,
    deaiCards,
    deaiBullets,
    cardShare,
    cutPct,
    baselineMeanScore: Math.round((baseScore / n) * 10) / 10,
    deaiMeanScore: Math.round((deaiScore / n) * 10) / 10,
  },
  checks,
  rows,
  pass,
};
writeFileSync(join(outDir, "bypass_result.json"), JSON.stringify(result, null, 2), "utf8");

console.log("\n===== 绕过测试 =====");
for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}｜${c.detail}`);
console.log(`VERDICT=${pass ? "PASS" : "FAIL"}`);
process.exit(pass ? 0 : 1);
