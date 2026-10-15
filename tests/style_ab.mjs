// 输出策略 A/B：同一批「我日常要写的文体」，比较当前提示词与候选提示词。
// 与 ab_test.mjs 的区别：ab_test 比的是「有无规则」，这个比的是「两版规则谁更稳」。
//
// 用法（凭据见 ~/.dsh/AGENTS.md §28）：
//   $env:DEEPSEEK_API_KEY = [Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY','User')
//   node tests/style_ab.mjs [--repeats 3] [--out <dir>] [--dry-run]
//
// 退出码：0=跑完；2=参数/凭据；3=网络或接口失败。

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { lint } from "../lib/lint.js";
import { renderPrompt } from "../lib/prompt.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_URL = "https://api.deepseek.com";
const MODEL = "deepseek-flash";

const argv = process.argv.slice(2);
const argOf = (n, d) => (argv.indexOf(n) >= 0 && argv[argv.indexOf(n) + 1] ? argv[argv.indexOf(n) + 1] : d);
const REPEATS = Number(argOf("--repeats", "3"));
const OUT_DIR = argOf("--out", join(HERE, "..", "..", "..", "tmp", "style_ab"));
const DRY = argv.includes("--dry-run");

// 候选补充规则：全部来自 external-validation.md 第四节对我自己 64 条正文的实测
// （箭头 108 次、`**标签**：` 85 次、`- **小标题**：` 47 次、加粗密度 56/64 篇超标）。
const CANDIDATE = [
  "17. 散文里不用箭头符号（→ 等），改用「变成」「降到」「导致」这类动词。",
  "18. 不要用「**标签**：内容」把句子切成标签；即使不在行首也算。",
  "19. 400 字以内不分节、不加小标题、不写「## 结论」这类帽子。",
  "20. 加粗只给真正需要警醒的几个字，一屏最多一处；不要给关键词逐个加粗。",
  "21. 两组数据对照直接写成短句（「从 20 降到 5」），不要默认上表格。",
].join("\n");

// 两套提示词体裁。short = 「写 200 字说明」；long = 「把一堆实测数据和结论整理成汇报」。
// 第一轮实测：short 体裁下两组都拿 0~2 分、没有可测空间（当前提示词已经够用）；
// 真正的问题在我实际写的长汇报里（见 docs/reviews/external-validation.md 第四节）。
const PROMPT_SETS = {
  short: [
    { id: "s1", text: "汇报一下这次改动的结果：错误率从 3.2% 降到 0.4%，耗时从 800ms 降到 210ms，涉及三个模块。200 字左右。" },
    { id: "s2", text: "解释一下为什么这个方案比原方案好，200 字左右。" },
    { id: "s3", text: "给同事讲一下这次线上故障的原因和后续动作，200 字左右。" },
    { id: "s4", text: "总结一下这份数据里最值得注意的三点，200 字左右。" },
    { id: "s5", text: "写一段代码评审意见，指出命名和错误处理两个问题，200 字左右。" },
    { id: "s6", text: "说一下我为什么建议先做缓存优化而不是加机器，200 字左右。" },
  ],
  long: [
    {
      id: "L1",
      text:
        "写一份给同事看的技术改动说明，不少于 600 字。内容：1) 背景是接口超时；2) 做了三件事——加了 Redis 缓存、把批量查询改成单条、把日志采样率从 100% 降到 5%；" +
        "3) 效果：P99 从 1800ms 降到 240ms，错误率从 3.2% 降到 0.4%，内存从 4G 涨到 5.2G；4) 两个需要注意的地方：缓存穿透风险、采样率下降会影响排查。要让人一眼看清数字。",
    },
    {
      id: "L2",
      text:
        "写一份上线前的风险说明，不少于 600 字。列出 5 个风险点，每个都要写清楚「触发条件」和「止损动作」。风险涉及：数据库连接池、灰度比例、回滚脚本、监控告警阈值、下游依赖的限流。" +
        "最后给一个上线/不上线的判断。",
    },
    {
      id: "L3",
      text:
        "把下面这段排查过程整理成一份结论说明，不少于 500 字：一开始怀疑是网络，测了网关、DNS、丢包都正常；后来发现只有部分用户报错，且集中在某个地域；" +
        "再查发现是那台机器的时钟漂移了 3 秒，导致签名校验失败。修复方式是加 NTP 同步并加了时钟偏移的监控。",
    },
    {
      id: "L4",
      text:
        "写一份方案对比，不少于 600 字：方案 A 是同步调用、实现简单、延迟 300ms、故障会级联；方案 B 是消息队列、实现复杂、延迟 800ms、故障不级联；" +
        "方案 C 是本地缓存加异步刷新、延迟 50ms、有数据不一致窗口。给出推荐并说明理由。",
    },
  ],
  // 「整理我自己的工具结果」——我实际写汇报时的语域，卡片/箭头/加粗最容易在这里冒出来
  agent: [
    {
      id: "A1",
      text:
        "下面是我刚跑完的 8 条工具结果，请整理成一份给用户看的回复，不少于 700 字：\n" +
        "1. 备份 8 个文件到 D:\\tmp\\_backup，字节数 282/2480/516/5270/6124/1305/2732/11869\n" +
        "2. pnpm pack 产出 dsh-deai-style-1.3.0.tgz（12480 字节）\n" +
        "3. 安装返回 application=restart-required，exitCode=0\n" +
        "4. 已装副本版本号 1.3.0，8 个文件与仓库 SHA256 全同\n" +
        "5. 校验脚本跑到 158/158 通过\n" +
        "6. 语料回归 20/20\n" +
        "7. 开关回归 RESULT=PASS\n" +
        "8. A/B 复跑 baseline 33.4 降到 9.1，下降 72.8%\n" +
        "请把过程、证据和结论讲清楚。",
    },
    {
      id: "A2",
      text:
        "把下面 6 条排查记录整理成一份故障复盘，不少于 700 字：\n" +
        "1. 用户报 502，时间 21:03，持续 4 分钟\n" +
        "2. 网关日志显示 upstream timeout，超时配置 3s\n" +
        "3. 后端 P99 在 21:02 涨到 5200ms，平时 240ms\n" +
        "4. 同时段数据库慢查询 47 条，平时 2 条\n" +
        "5. 慢查询都指向同一个订单表的全表扫描\n" +
        "6. 21:06 加了索引后恢复\n" +
        "要写清时间线、根因、影响面、后续动作。",
    },
    {
      id: "A3",
      text:
        "下面是一份代码审查的原始记录，请整理成给提交者的评审意见，不少于 600 字：\n" +
        "- src/order.ts:142 命名 x1 无意义，应为 pendingCount\n" +
        "- src/order.ts:188 catch 里只 console.log，没有上报也没有降级\n" +
        "- src/pay.ts:55 直接把用户输入拼进 SQL\n" +
        "- src/pay.ts:90 魔法数字 86400，应提取为常量\n" +
        "- test/order.spec.ts 只测了 happy path，覆盖率 41%\n" +
        "按严重程度排序，每条给出改法。",
    },
  ],
};

const argv2 = process.argv.slice(2);
const setArg = (argv2.indexOf("--set") >= 0 && argv2[argv2.indexOf("--set") + 1]) || "long";
const PROMPTS = PROMPT_SETS[setArg] || PROMPT_SETS.long;

const CANDIDATE_COMPACT = [
  "17. 排版要克制：散文里不用箭头符号；不用「**标签**：内容」把句子切成标签；400 字以内不分节不加小标题；加粗一屏最多一处；两组数据对照写成句子，不默认上表格。",
].join("\n");

const candArg = argv2.indexOf("--candidate") >= 0 ? argv2[argv2.indexOf("--candidate") + 1] : "verbose";
const ARMS = [
  { id: "current", label: "当前提示词（v1.3.1）", system: renderPrompt({ level: "strict", toolName: "deai_scan" }) },
  {
    id: "candidate",
    label: `候选提示词（${candArg}）`,
    system: renderPrompt({
      level: "strict",
      extraRules: candArg === "compact" ? CANDIDATE_COMPACT : CANDIDATE,
      toolName: "deai_scan",
    }),
  },
];

async function callOnce(key, prompt, system) {
  const messages = system ? [{ role: "system", content: system }, { role: "user", content: prompt }] : [{ role: "user", content: prompt }];
  const res = await fetch(BASE_URL + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: MODEL,
      messages,
      stream: false,
      temperature: 1.0,
      max_tokens: 3072,
      thinking: { type: "disabled" },
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error("HTTP " + res.status + " " + raw.slice(0, 300));
  const data = JSON.parse(raw);
  const choice = data.choices && data.choices[0];
  if (!choice) throw new Error("无 choices");
  if (choice.finish_reason === "length") throw new Error("响应被截断（finish_reason=length）");
  return (choice.message && choice.message.content) || "";
}

if (DRY) {
  console.log(`[dry-run] ${PROMPTS.length} 题 × ${REPEATS} 轮 × ${ARMS.length} 组 = ${PROMPTS.length * REPEATS * ARMS.length} 次调用`);
  for (const a of ARMS) console.log(`  ${a.id}: system prompt ${a.system.length} 字符`);
  process.exit(0);
}

const key = process.env.DEEPSEEK_API_KEY;
if (!key) {
  console.error("缺少 DEEPSEEK_API_KEY（工具壳里该变量会被擦除，见 AGENTS.md §28，需显式注入）");
  process.exit(2);
}

mkdirSync(OUT_DIR, { recursive: true });
const rows = [];
for (const arm of ARMS) {
  for (const p of PROMPTS) {
    for (let i = 0; i < REPEATS; i++) {
      process.stdout.write(`  ${arm.id} ${p.id} #${i + 1} … `);
      let text;
      try {
        text = await callOnce(key, p.text, arm.system);
      } catch (err) {
        console.log("失败: " + err.message);
        process.exit(3);
      }
      const r = lint(text);
      rows.push({ arm: arm.id, prompt: p.id, rep: i + 1, text, score: r.score, band: r.band, layout: r.layout, chars: r.chars });
      console.log(`${r.score} 分  箭头${r.layout.arrows} 加粗${r.layout.boldSpans} 卡片${r.layout.cardLines}`);
    }
  }
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function agg(armId) {
  const rs = rows.filter((r) => r.arm === armId);
  return {
    n: rs.length,
    score: +mean(rs.map((r) => r.score)).toFixed(1),
    chars: Math.round(mean(rs.map((r) => r.chars))),
    arrowPer1000: +mean(rs.map((r) => r.layout.arrowPer1000)).toFixed(2),
    boldPer1000: +mean(rs.map((r) => r.layout.boldPer1000)).toFixed(2),
    boldLabelPer1000: +mean(rs.map((r) => r.layout.boldLabelPer1000)).toFixed(2),
    cardLines: +mean(rs.map((r) => r.layout.cardLines)).toFixed(2),
    headingRatio: +mean(rs.map((r) => r.layout.headingRatio)).toFixed(3),
    flagged: rs.filter((r) => r.layout.flags.length).length,
    over35: rs.filter((r) => r.score > 35).length,
  };
}
const A = agg("current");
const B = agg("candidate");

const checks = [
  { name: "AI 分不升高", ok: B.score <= A.score + 1, detail: `${A.score} -> ${B.score}` },
  { name: "箭头密度下降 ≥50%", ok: B.arrowPer1000 <= A.arrowPer1000 * 0.5, detail: `${A.arrowPer1000} -> ${B.arrowPer1000}` },
  { name: "加粗标签密度下降 ≥50%", ok: B.boldLabelPer1000 <= A.boldLabelPer1000 * 0.5, detail: `${A.boldLabelPer1000} -> ${B.boldLabelPer1000}` },
  { name: "卡片行下降 ≥50%", ok: B.cardLines <= A.cardLines * 0.5, detail: `${A.cardLines} -> ${B.cardLines}` },
  { name: "加粗密度不升高", ok: B.boldPer1000 <= A.boldPer1000, detail: `${A.boldPer1000} -> ${B.boldPer1000}` },
  { name: "命中「偏密」的样本数下降", ok: B.flagged <= A.flagged, detail: `${A.flagged}/${A.n} -> ${B.flagged}/${B.n}` },
];

const verdict = { arms: { current: A, candidate: B }, checks, pass: checks.every((c) => c.ok) };
const out = join(OUT_DIR, "style_ab.json");
writeFileSync(out, JSON.stringify({ prompts: PROMPTS, rows, verdict }, null, 1));

console.log("\n当前提示词 :", JSON.stringify(A));
console.log("候选提示词 :", JSON.stringify(B));
for (const c of checks) console.log(`  ${c.ok ? "PASS" : "FAIL"}  ${c.name}  (${c.detail})`);
console.log(`\nVERDICT=${verdict.pass ? "PASS" : "FAIL"}  结果写入 ${out}`);
