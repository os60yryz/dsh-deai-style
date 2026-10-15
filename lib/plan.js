// 纯函数：由 config 推导出「要注册什么」，不触碰 ctx —— 便于开关两套断言回归。
import { renderPrompt, LEVELS } from "./prompt.js";

export const SECTION_NAME = "deai:style";
export const TOOL_NAME = "deai_scan";

export function normalizeConfig(raw) {
  const c = raw ?? {};
  return {
    enabled: c.enabled !== false,
    level: LEVELS.includes(c.level) ? c.level : "strict",
    position: c.position === "top" ? "top" : "bottom",
    injectLintTool: c.injectLintTool !== false,
    extraRules: typeof c.extraRules === "string" ? c.extraRules : "",
  };
}

/**
 * @returns {null | { section: {name:string, order:number, text:string}, tool: boolean, config: object }}
 * 返回 null 表示关闭：调用方不得注册任何东西（旧行为）。
 */
export function planRegistrations(raw, orders) {
  const config = normalizeConfig(raw);
  if (!config.enabled || config.level === "off") return null;

  const base = config.position === "top" ? orders.personaPrefix : orders.personaSuffix;
  const text = renderPrompt({
    level: config.level,
    extraRules: config.extraRules,
    toolName: config.injectLintTool ? TOOL_NAME : null,
  });

  return {
    section: { name: SECTION_NAME, order: base + 1, text },
    tool: config.injectLintTool,
    config,
  };
}
