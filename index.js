// dsh-deai-style：DeepSeek 专属「去 AI 风格」插件
// 作用：把「去 AI 腔」风格约束注入系统提示（末尾层），并提供 deai_scan 打分自检工具。
// 关闭（enabled:false 或 level:"off"）时不注册任何东西 = 完全回到旧行为。
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { lint, renderReport } from "./lib/lint.js";
import { TOOL_NAME, planRegistrations } from "./lib/plan.js";

const name = "deai-style";

// systemPrompt 与 tools 都是宿主核心服务；服务缺失时 cordis 会等待而不是报错。
const inject = ["systemPrompt", "tools"];

const Config = z.object({
  enabled: z.boolean().default(true),
  level: z.string().default("strict"),
  position: z.string().default("bottom"),
  injectLintTool: z.boolean().default(true),
  extraRules: z.string().default(""),
});

const scanTool = defineTool({
  name: TOOL_NAME,
  description:
    "对一段中文草稿做「去 AI 风格」自检，返回 0-100 的 AI 腔评分、命中明细与改写建议。" +
    "用来检查回答是否套用了模板连接词（首先/其次/综上所述）、对偶反转句（不是X而是Y）、" +
    "「- **小标题**：内容」式列表、空洞夸饰词、客服式结尾等 AI 腔特征。只做诊断，不改写文本。",
  parameters: {
    text: {
      type: "string",
      required: true,
      description: "要检查的文本（草稿或已写好的回答）",
    },
    maxSuggestions: {
      type: "integer",
      description: "最多返回几条改写建议，默认 6",
    },
  },
  output: {
    schema: { type: "object", additionalProperties: true },
    render(args, value) {
      return [{ type: "text", text: renderReport(value) }];
    },
  },
  execute(args) {
    return lint(args.text, { maxSuggestions: args.maxSuggestions ?? 6 });
  },
});

function apply(ctx, rawConfig) {
  const plan = planRegistrations(rawConfig, {
    personaPrefix: ctx.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA_PREFIX"),
    personaSuffix: ctx.systemPrompt.getSectionOrder("DEPLOYMENT_PERSONA_SUFFIX"),
  });

  // 关闭路径：不注册 section、不注册工具，等于插件不存在
  if (!plan) return;

  ctx.effect(() => ctx.systemPrompt.section(plan.section), "deai-style.section()");
  if (plan.tool) {
    ctx.effect(() => ctx.tools.register(scanTool), "deai-style.tool()");
  }
}

export { Config, TOOL_NAME, apply, inject, name };
