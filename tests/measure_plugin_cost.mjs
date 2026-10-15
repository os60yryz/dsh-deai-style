// 量一量这个插件到底让每次请求贵了多少：系统提示段、工具 schema、以及工具调用一次的开销。
// 用同一段固定前缀做对照，靠 API 返回的 usage.prompt_tokens 算差额，不用估算。
//
// 运行：先注入 DEEPSEEK_API_KEY（工具壳里凭据型变量会被擦除）
//   $env:DEEPSEEK_API_KEY = [Environment]::GetEnvironmentVariable('DEEPSEEK_API_KEY','User')
//   node tests/measure_plugin_cost.mjs

import { renderPrompt } from "../lib/prompt.js";
import { lint, renderReport } from "../lib/lint.js";
import { apply, Config } from "../index.js";

const BASE_URL = "https://api.deepseek.com";
const MODEL = "deepseek-flash";
const KEY = process.env.DEEPSEEK_API_KEY;
if (!KEY) {
  console.error("缺少 DEEPSEEK_API_KEY");
  process.exit(2);
}

// 从 mock ctx 里掏出真实注册的工具定义（description + 编译后的 JSON Schema）
function grabTool() {
  const captured = { tools: [], sections: [] };
  const ctx = {
    effect(cb) {
      cb();
      return () => {};
    },
    systemPrompt: {
      getSectionOrder: () => 10200,
      section(s) {
        captured.sections.push(s);
      },
      suppressRuntimeContext() {},
    },
    tools: {
      register(t) {
        captured.tools.push(t);
      },
    },
  };
  apply(ctx, { enabled: true, level: "strict", position: "bottom", injectLintTool: true, extraRules: "" });
  return captured;
}

async function promptTokens(messages, tools) {
  const body = { model: MODEL, messages, max_tokens: 4, thinking: { type: "disabled" }, stream: false, temperature: 0 };
  if (tools) body.tools = tools;
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j.usage?.prompt_tokens ?? -1;
}

const SYS = "你是助手。";
const msgs = (sys) => [
  { role: "system", content: sys },
  { role: "user", content: "你好" },
];

const cfg = Config ? null : null;
const { sections, tools } = grabTool();
const sectionText = sections.map((s) => s.text).join("\n\n");
const tool = tools[0];
const toolDef = tool
  ? [{ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }]
  : [];

// 一次工具调用的往返：模型要传出正文，插件要回一段报告
const sample = [
  "在当今数字化转型的时代背景下，远程办公已成为企业运营的重要组成部分。",
  "首先，它极大地提升了员工的灵活性；其次，它显著降低了通勤成本。",
  "值得注意的是，远程办公并非没有挑战。",
  "综上所述，希望这些内容对你有帮助。",
].join("\n");
const report = renderReport(lint(sample));
const reportCompact = renderReport(lint(sample), { compact: true });

const A = await promptTokens(msgs(SYS));
const B = await promptTokens(msgs(`${SYS}\n\n${sectionText}`));
const C = await promptTokens(msgs(SYS), toolDef);
const D = await promptTokens(msgs(`${SYS}\n\n${sectionText}`), toolDef);
const E = await promptTokens(msgs(`${SYS}\n\n${report}`));

const reportTokens = E - A;
const sampleTokens = await (async () => (await promptTokens(msgs(`${SYS}\n\n${sample}`))) - A)();

console.log("=== 每次请求固定增加 ===");
console.log(`系统提示段（strict，含工具提示行）  ${sectionText.length} 字符 → ${B - A} token`);
console.log(`deai_scan 工具 schema                ${JSON.stringify(toolDef).length} 字符 → ${C - A} token`);
console.log(`两者合计                              → ${D - A} token / 次请求`);
console.log("");
console.log("=== 调用一次 deai_scan 的往返 ===");
console.log(`工具入参（正文原样回传）              ${sample.length} 字符 → 约 ${sampleTokens} token`);
console.log(`工具返回（中文报告）                  ${report.length} 字符 → 约 ${reportTokens} token`);
console.log(`合计                                  → 约 ${sampleTokens + reportTokens} token / 次调用`);
console.log("");
console.log("=== 折算 ===");
console.log(`报告/正文 比：${(report.length / sample.length).toFixed(2)} 字符比，${(reportTokens / sampleTokens).toFixed(2)} token 比`);
console.log("");
console.log(`section_text_chars=${sectionText.length}`);
console.log(`section_tokens=${B - A}`);
console.log(`tool_schema_tokens=${C - A}`);
console.log(`both_tokens=${D - A}`);
console.log(`call_roundtrip_tokens=${sampleTokens + reportTokens}`);

// --- 变体：能省多少 ---
const softText = renderPrompt({ level: "soft", toolName: tool.name });
const noHintText = renderPrompt({ level: "strict", toolName: null });
const leanTool = [
  {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description.split("。").slice(0, 1).join("。") + "。",
      parameters: { type: "object", properties: { text: { type: "string", description: "要检查的中文文本" } }, required: ["text"] },
    },
  },
];
const Bs = await promptTokens(msgs(`${SYS}\n\n${softText}`));
const Bn = await promptTokens(msgs(`${SYS}\n\n${noHintText}`));
const Cl = await promptTokens(msgs(SYS), leanTool);
const Ec = await promptTokens(msgs(`${SYS}\n\n${reportCompact}`));
const compactReportTokens = Ec - A;

console.log("");
console.log("=== 报告的两种形态（同一段 103 字 AI 腔样例） ===");
console.log(`完整报告 ${report.length} 字符 → ${reportTokens} token`);
console.log(`精简报告 ${reportCompact.length} 字符 → ${compactReportTokens} token（省 ${reportTokens - compactReportTokens}）`);

console.log("");
console.log("=== 可省的方案 ===");
console.log(`soft 档提示段（${softText.length} 字符）              → ${Bs - A} token（省 ${B - Bs}）`);
console.log(`strict 去掉工具提示行（${noHintText.length} 字符）     → ${Bn - A} token（省 ${B - Bn}）`);
console.log(`精简工具 schema（去 maxSuggestions、短描述）→ ${Cl - A} token（省 ${C - Cl}）`);
console.log(`三项全做                                    → ${Bs - A + Cl - A} token（当前 ${D - A}，省 ${D - A - (Bs - A + Cl - A)}）`);

void cfg;
