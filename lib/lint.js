// dsh-deai-style 检测器：把文本映射成「AI 腔」分数与命中明细
import { RULES, METRICS, CATEGORY_LABELS } from "./ruleset.js";

export const BANDS = [
  { max: 15, key: "clean", label: "基本没有 AI 腔" },
  { max: 35, key: "slight", label: "轻微 AI 腔" },
  { max: 60, key: "medium", label: "中等 AI 腔" },
  { max: 100, key: "heavy", label: "明显 AI 腔" },
];

export function bandOf(score) {
  return BANDS.find((b) => score <= b.max) ?? BANDS[BANDS.length - 1];
}

// 去掉代码块与行内代码，避免把代码当散文打分
export function stripCode(text) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, " "); // 表格行
}

function computeMetrics(text) {
  const chars = text.replace(/\s/g, "").length;
  const per1000 = Math.max(chars, 150) / 1000;
  const lines = text.split("\n");
  const contentLines = lines.filter((l) => l.trim().length > 0).length;
  const bulletLines = lines.filter((l) => /^[ \t]*(?:[-*+]|\d+[.、])[ \t]+\S/.test(l)).length;
  const headingLines = lines.filter((l) => /^[ \t]*#{1,6}[ \t]+\S/.test(l)).length;
  const boldSpans = (text.match(/\*\*[^*\n]+\*\*/g) || []).length;

  const sentences = text
    .split(/[。！？!?；;\n]+/)
    .map((s) => s.replace(/\s/g, ""))
    .filter((s) => s.length > 0);
  const lens = sentences.map((s) => s.length);
  const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const sd = lens.length > 1 ? Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length) : 0;
  const sentenceCv = mean > 0 ? sd / mean : 0;

  const paras = text
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s/g, ""))
    .filter((p) => p.length > 0);
  const plens = paras.map((p) => p.length);
  const pmean = plens.length ? plens.reduce((a, b) => a + b, 0) / plens.length : 0;
  const psd = plens.length > 1 ? Math.sqrt(plens.reduce((a, b) => a + (b - pmean) ** 2, 0) / plens.length) : 0;
  const paragraphCv = pmean > 0 ? psd / pmean : 0;

  return {
    chars,
    per1000,
    contentLines,
    bulletLines,
    headingLines,
    boldSpans,
    sentenceCount: sentences.length,
    sentenceCv,
    avgSentenceLen: mean,
    paragraphCount: paras.length,
    paragraphCv,
  };
}

export function lint(rawText, opts = {}) {
  const text = stripCode(rawText);
  const m = computeMetrics(text);
  const hits = [];

  for (const rule of RULES) {
    const matches = text.match(rule.re) || [];
    if (matches.length === 0) continue;
    hits.push({
      id: rule.id,
      cat: rule.cat,
      sev: rule.sev,
      count: matches.length,
      samples: [...new Set(matches.map((s) => s.trim()))].slice(0, 3),
      hint: rule.hint,
      kind: "rule",
    });
  }

  for (const metric of METRICS) {
    const count = metric.measure(text, m);
    if (!count || count <= 0) continue;
    hits.push({
      id: metric.id,
      cat: metric.cat,
      sev: metric.sev,
      count: Math.round(count * 100) / 100,
      samples: [],
      hint: metric.hint,
      kind: "metric",
    });
  }

  // 评分：规则命中为主证据（密度+饱和），结构指标只做小幅加成。
  // 短文本用 300 字下限归一，避免小样本被密度放大。
  let ruleWeight = 0;
  let metricWeight = 0;
  for (const h of hits) {
    if (h.kind === "rule") ruleWeight += h.sev * Math.min(h.count, 2);
    else metricWeight += h.sev * h.count;
  }
  const weighted = ruleWeight + Math.min(metricWeight, 6);
  const density = (ruleWeight * 1000) / Math.max(m.chars, 300);
  const ruleScore = ruleWeight === 0 ? 0 : (100 * density) / (density + 20);
  const metricBonus = Math.min(10, metricWeight * 1.5);
  const score = Math.max(0, Math.min(100, Math.round(ruleScore + metricBonus)));
  const band = bandOf(score);

  hits.sort((a, b) => b.sev * Math.min(b.count, 2) - a.sev * Math.min(a.count, 2) || a.id.localeCompare(b.id));

  const suggestions = [];
  for (const h of hits) {
    if (suggestions.length >= (opts.maxSuggestions ?? 6)) break;
    if (!suggestions.some((s) => s.hint === h.hint)) suggestions.push({ id: h.id, cat: h.cat, hint: h.hint });
  }

  return {
    score,
    band: band.key,
    bandLabel: band.label,
    chars: m.chars,
    weighted: Math.round(weighted * 100) / 100,
    density: Math.round(density * 100) / 100,
    counts: {
      sentences: m.sentenceCount,
      sentenceCv: Math.round(m.sentenceCv * 100) / 100,
      avgSentenceLen: Math.round(m.avgSentenceLen * 10) / 10,
      paragraphs: m.paragraphCount,
      bulletLines: m.bulletLines,
      boldSpans: m.boldSpans,
      contentLines: m.contentLines,
    },
    byCategory: summarizeByCategory(hits),
    hits,
    suggestions,
  };
}

function summarizeByCategory(hits) {
  const out = {};
  for (const h of hits) {
    const key = h.cat;
    out[key] = out[key] || { label: CATEGORY_LABELS[key] ?? key, weighted: 0, count: 0 };
    out[key].weighted = Math.round((out[key].weighted + h.sev * Math.min(h.count, 2)) * 100) / 100;
    out[key].count += 1;
  }
  return out;
}

// 供工具 render 使用的中文纯文本报告
export function renderReport(result) {
  const lines = [];
  lines.push(`AI 腔评分：${result.score}/100（${result.bandLabel}）｜正文 ${result.chars} 字，加权命中 ${result.weighted}，规则密度 ${result.density}/千字`);
  const cats = Object.entries(result.byCategory);
  if (cats.length) lines.push(`分类：${cats.map(([, v]) => `${v.label} ${v.weighted}`).join("，")}`);
  lines.push("");
  if (result.hits.length === 0) {
    lines.push("未命中任何规则。");
  } else {
    lines.push("命中明细（按严重度排序）：");
    for (const h of result.hits) {
      const sample = h.samples.length ? `　例：${h.samples.join(" / ")}` : "";
      lines.push(`- [${CATEGORY_LABELS[h.cat] ?? h.cat}·${h.sev}] ${h.id} ×${h.count}${sample}`);
    }
  }
  if (result.suggestions.length) {
    lines.push("");
    lines.push("改写建议：");
    result.suggestions.forEach((s, i) => lines.push(`${i + 1}. ${s.hint}`));
  }
  return lines.join("\n");
}
