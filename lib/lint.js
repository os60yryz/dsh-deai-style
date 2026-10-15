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

const TABLE_RE = /^[ \t]*\|.*\|[ \t]*$/;

// 去掉代码块与行内代码，避免把代码当散文打分。
// 表格保留：表格是正文结构，若整段删掉会让「纯表格回答」变成 0 字、报告说「未命中任何规则」。
export function stripCode(text) {
  let out = String(text ?? "");
  // 成对围栏：围栏必须独占一行开头，内部可以含其它 ``` 字符串
  out = out.replace(/^[ \t]*```[^\n]*\n[\s\S]*?^[ \t]*```[^\n]*$/gm, "\n");
  // 未闭合围栏：从该行一直删到文末
  out = out.replace(/^[ \t]*```[^\n]*\n[\s\S]*/m, "\n");
  // 行内代码
  out = out.replace(/`[^`\n]*`/g, " ");
  return out;
}

function computeMetrics(text) {
  const chars = text.replace(/\s/g, "").length;
  const per1000 = Math.max(chars, 150) / 1000;
  const lines = text.split("\n");
  const contentLines = lines.filter((l) => l.trim().length > 0).length;
  const tableLines = lines.filter((l) => TABLE_RE.test(l)).length;
  const bulletLines = lines.filter((l) => /^[ \t]*(?:[-*+]|\d+[.、])[ \t]+\S/.test(l)).length;
  const headingLines = lines.filter((l) => /^[ \t]*#{1,6}[ \t]+\S/.test(l)).length;
  const boldSpans = (text.match(/\*\*[^*\n]+\*\*/g) || []).length;
  const emojiCount = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
  const emojiStartLines = lines.filter((l) => /^[ \t]*\p{Extended_Pictographic}/u.test(l)).length;
  const colonLines = lines.filter(
    (l) =>
      /^(?![^\n]*\*\*)(?![^\n]*\d{1,2}[：:]\d{2})(?!(?:他|她|我|你|它)[说问答])[^\n：:，。！？；]{2,12}[：:]\s*\S/.test(
        l,
      ),
  ).length;

  // 表格行不参与句长/段落统计（表格里的内容不是散文句子）
  const prose = lines.filter((l) => !TABLE_RE.test(l)).join("\n");
  const sentences = prose
    .split(/[。！？!?；;\n]+/)
    .map((s) => s.replace(/\s/g, ""))
    .filter((s) => s.length > 0);
  const lens = sentences.map((s) => s.length);
  const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const sd =
    lens.length > 1
      ? Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length)
      : 0;
  const sentenceCv = mean > 0 ? sd / mean : 0;

  const paras = prose
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s/g, ""))
    .filter((p) => p.length > 0);
  const plens = paras.map((p) => p.length);
  const pmean = plens.length ? plens.reduce((a, b) => a + b, 0) / plens.length : 0;
  const psd =
    plens.length > 1
      ? Math.sqrt(plens.reduce((a, b) => a + (b - pmean) ** 2, 0) / plens.length)
      : 0;
  const paragraphCv = pmean > 0 ? psd / pmean : 0;

  return {
    chars,
    per1000,
    contentLines,
    tableLines,
    bulletLines,
    headingLines,
    boldSpans,
    emojiCount,
    emojiStartLines,
    colonLines,
    sentenceCount: sentences.length,
    sentenceCv,
    avgSentenceLen: mean,
    paragraphCount: paras.length,
    paragraphCv,
  };
}

// 逐条规则取出所有命中区间（不复用 lastIndex，避免 g 正则的跨调用残留）
function collectSpans(text, rule, chars) {
  const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : `${rule.re.flags}g`);
  const spans = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    if (m[0].length === 0) re.lastIndex += 1;
  }
  if (rule.scope === "opening") {
    const limit = Math.max(60, Math.min(200, chars * 0.2));
    return spans.filter((s) => s.start < limit);
  }
  if (rule.scope === "closing") {
    const from = chars * 0.65;
    return spans.filter((s) => s.start >= from);
  }
  return spans;
}

// 区间按重叠合并，重叠部分只记最高严重度。
// 这样「- **小标题**：内容」不会被 bold-label-line / bold-inline-label / bold-start-line 重复计三次。
function mergeSpans(spans) {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end || b.sev - a.sev);
  const merged = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start < last.end) {
      last.end = Math.max(last.end, s.end);
      last.sev = Math.max(last.sev, s.sev);
    } else {
      merged.push({ start: s.start, end: s.end, sev: s.sev });
    }
  }
  return merged;
}

export function lint(rawText, opts = {}) {
  const text = stripCode(rawText);
  const m = computeMetrics(text);
  const hits = [];
  const spans = [];

  for (const rule of RULES) {
    const found = collectSpans(text, rule, m.chars);
    if (found.length === 0) continue;
    for (const s of found) spans.push({ ...s, sev: rule.sev, id: rule.id, cat: rule.cat });
    hits.push({
      id: rule.id,
      cat: rule.cat,
      sev: rule.sev,
      count: found.length,
      samples: [...new Set(found.map((s) => s.text.trim()))].slice(0, 3),
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
      evidence: metric.evidence ?? "rhythm",
    });
  }

  const merged = mergeSpans(spans);
  const ruleWeight = merged.reduce((s, iv) => s + iv.sev, 0);
  const covered = merged.reduce((s, iv) => s + (iv.end - iv.start), 0);

  // 规则命中 × 篇幅：K 是「这段长度下正常能容忍的命中量」。
  // 命中量随篇幅同比例增长时分数不降（修掉「越长越免疫」），
  // 短文本单条轻微命中也不会被密度公式放大成重罪。
  const k = 4.5 + m.chars / 100;
  const ruleScore = ruleWeight === 0 ? 0 : 100 * (1 - Math.exp(-ruleWeight / k));

  let metricWeight = 0;
  let strongWeight = 0;
  for (const h of hits) {
    if (h.kind !== "metric") continue;
    metricWeight += h.sev * h.count;
    if (h.evidence === "strong") strongWeight += h.sev * h.count;
  }

  // 只有「行首 emoji 当项目符号」可以独立定罪——人类把 emoji 当 bullet 用在正式回答里极少见。
  // 普通列表 / 表格 / 加粗不可以独立定罪：人类写清单和数据表同样工整
  // （第一轮红队 FP-04 换灯泡步骤、FP-09 加粗强调都是这样被误判的）。
  // 节奏类指标（句长均匀、段落等长）同样只能加成，不能独立成立
  // （HUMAN-LONG：278 字人写随笔零 AI 腔词，曾被节奏指标推到 43 分）。
  const strongScore =
    ruleWeight === 0 && strongWeight > 0 ? 100 * (1 - Math.exp(-strongWeight / k)) : 0;
  const metricBonus = ruleWeight === 0 ? 0 : Math.min(4, metricWeight);
  const score = Math.max(
    0,
    Math.min(100, Math.round(Math.max(ruleScore, strongScore) + metricBonus)),
  );
  const band = bandOf(score);

  const weighted = Math.round((ruleWeight + Math.min(metricWeight, 6)) * 100) / 100;
  const density = Math.round(((ruleWeight * 1000) / Math.max(m.chars, 300)) * 100) / 100;
  const coverage = m.chars > 0 ? Math.round((covered / m.chars) * 1000) / 1000 : 0;

  hits.sort(
    (a, b) => b.sev * Math.min(b.count, 3) - a.sev * Math.min(a.count, 3) || a.id.localeCompare(b.id),
  );

  const limit = Number.isFinite(opts.maxSuggestions) ? Math.max(0, Math.trunc(opts.maxSuggestions)) : 6;
  const suggestions = [];
  for (const h of hits) {
    if (suggestions.length >= limit) break;
    if (!suggestions.some((s) => s.hint === h.hint)) suggestions.push({ id: h.id, cat: h.cat, hint: h.hint });
  }

  return {
    score,
    band: band.key,
    bandLabel: band.label,
    chars: m.chars,
    weighted,
    density,
    coverage,
    ruleWeight,
    metricWeight: Math.round(metricWeight * 100) / 100,
    spans: merged.length,
    counts: {
      sentences: m.sentenceCount,
      sentenceCv: Math.round(m.sentenceCv * 100) / 100,
      avgSentenceLen: Math.round(m.avgSentenceLen * 10) / 10,
      paragraphs: m.paragraphCount,
      paragraphCv: Math.round(m.paragraphCv * 100) / 100,
      bulletLines: m.bulletLines,
      tableLines: m.tableLines,
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
    out[key].weighted =
      Math.round((out[key].weighted + h.sev * Math.min(h.count, 3)) * 100) / 100;
    out[key].count += 1;
  }
  return out;
}

// 供工具 render 使用的中文纯文本报告（对不完整/异常 value 也要能给出文本，不能抛错）
export function renderReport(result) {
  const r = result && typeof result === "object" ? result : {};
  const score = Number.isFinite(r.score) ? r.score : 0;
  const chars = Number.isFinite(r.chars) ? r.chars : 0;
  const hits = Array.isArray(r.hits) ? r.hits : [];
  const suggestions = Array.isArray(r.suggestions) ? r.suggestions : [];
  const lines = [];
  lines.push(
    `AI 腔评分：${score}/100（${r.bandLabel ?? bandOf(score).label}）｜正文 ${chars} 字，命中片段 ${r.spans ?? 0} 处（加权 ${r.ruleWeight ?? 0}），规则密度 ${r.density ?? 0}/千字`,
  );
  const cats = Object.entries(r.byCategory ?? {});
  if (cats.length) lines.push(`分类：${cats.map(([, v]) => `${v?.label ?? ""} ${v?.weighted ?? 0}`).join("，")}`);
  lines.push("");
  if (hits.length === 0) {
    lines.push("未命中任何规则。");
  } else {
    lines.push("命中明细（按严重度排序）：");
    for (const h of hits) {
      const samples = Array.isArray(h?.samples) ? h.samples : [];
      const sample = samples.length ? `　例：${samples.join(" / ")}` : "";
      lines.push(`- [${CATEGORY_LABELS[h?.cat] ?? h?.cat ?? "?"}·${h?.sev ?? "?"}] ${h?.id ?? "?"} ×${h?.count ?? 0}${sample}`);
    }
  }
  if (suggestions.length) {
    lines.push("");
    lines.push("改写建议：");
    suggestions.forEach((s, i) => lines.push(`${i + 1}. ${s?.hint ?? ""}`));
  }
  return lines.join("\n");
}
