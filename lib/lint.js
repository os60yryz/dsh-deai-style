// dsh-deai-style 检测器：把文本映射成「AI 腔」分数与命中明细
import { RULES, METRICS, CATEGORY_LABELS } from "./ruleset.js";

export const BANDS = [
  { max: 15, key: "clean", label: "基本没有 AI 腔" },
  { max: 35, key: "slight", label: "轻微 AI 腔" },
  { max: 60, key: "medium", label: "中等 AI 腔" },
  { max: 100, key: "heavy", label: "明显 AI 腔" },
];

export function bandOf(score) {
  // NaN/Infinity 不能落到「明显 AI 腔」档（第三轮 L1：bandOf(NaN) 返回 heavy，
  // 而同一份报告里 renderReport 把 NaN 当 0 分输出，两处口径相反）。
  if (!Number.isFinite(score)) return BANDS[0];
  return BANDS.find((b) => score <= b.max) ?? BANDS[BANDS.length - 1];
}

const TABLE_RE = /^[ \t]*\|.*\|[ \t]*$/;

// 零宽字符与软连字符：插在套话中间（如「首\u200b先」）可以绕过全部规则，
// 属于定向规避；这里先归一化掉再统计。
const ZERO_WIDTH_RE = /[\u200B-\u200F\u2060\uFEFF\u00AD]/g;

// emoji 覆盖三种写法：普通 pictographic、区域指示符国旗、键帽（1️⃣）。
// 第二轮红队实测：只写 \p{Extended_Pictographic} 时 1️⃣ 与 🇨🇳 完全检测不到，
// 而 ❤️（带 VS16）能命中、❤（不带）不能——两头都错。
const EMOJI_SRC = "(?:\\p{Extended_Pictographic}|\\p{Regional_Indicator}{2}|\\d\\uFE0F?\\u20E3)";
const EMOJI_ALL_RE = new RegExp(EMOJI_SRC, "gu");
const EMOJI_START_RE = new RegExp(`^[ \\t]*(?:[-*+]|\\d+[.、])?[ \\t]*${EMOJI_SRC}`, "u");

// 去掉代码块与行内代码，避免把代码当散文打分。
// 表格保留：表格是正文结构，若整段删掉会让「纯表格回答」变成 0 字、报告说「未命中任何规则」。
//
// 围栏解析按行扫描，不靠正则配对（第二轮红队 BUG2-01/02）：
//   - 反引号围栏长度必须相等或更长才算闭合（```` 里的 ``` 不闭合）；
//   - ~~~ 围栏同样处理；
//   - 未闭合围栏一律吃到文末（旧版只认三个反引号，四反引号/波浪号会整段泄漏进散文）；
//   - 文末裸围栏（无换行）也会被识别。
export function stripCode(text) {
  // CRLF 先归一化：否则行尾的 \r 会让 TABLE_RE 之类的 `$` 锚点失效
  // （第三轮缺陷审计：CRLF 表格 102ms 且识别不到）。
  const normalized = String(text ?? "")
    .replace(ZERO_WIDTH_RE, "")
    .replace(/\r\n?/g, "\n");
  const kept = [];
  let fence = null;
  for (const line of normalized.split("\n")) {
    // 允许围栏出现在引用块里（`> ``` `），第三轮缺陷审计的残余泄漏点
    const fenceMatch = /^(?:[ \t]*>[ \t]*)*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.len) {
        fence = null;
      }
      continue; // 围栏内一律丢弃（当代码看）
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[1][0], len: fenceMatch[1].length };
      continue;
    }
    // 四空格/Tab 缩进代码块：排除嵌套列表项（那属于结构，不是代码）
    if (/^(?: {4,}|\t)/.test(line) && !/^(?: {4,}|\t)[ \t]*(?:[-*+]|\d+[.、])[ \t]/.test(line)) {
      continue;
    }
    kept.push(line);
  }
  // 行内代码：允许跨行（``` 围栏已在上面剥离，剩下的反引号都是行内）
  return kept.join("\n").replace(/`[^`]*`/gs, " ");
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
  // 「卡片行」= 列表符号 + 加粗标签 + 冒号，即 `- **标签**：内容`。
  // 单看某一行不算罪（人类技术文档也这么写），只有当整篇几乎只剩卡片行时才由 card-ratio 定罪。
  const cardLines = lines.filter((l) =>
    /^[ \t]*(?:[-*+]|\d+[.、])[ \t]+\*\*[^*\n]{2,24}\*\*[：: ]/.test(l),
  ).length;
  const emojiCount = (text.match(EMOJI_ALL_RE) || []).length;
  const emojiStartLines = lines.filter((l) => EMOJI_START_RE.test(l)).length;
  const colonLines = lines.filter(
    (l) =>
      /^(?![^\n]*\*\*)(?![^\n]*\d{1,2}[：:]\d{2})(?!(?:他|她|我|你|它)[说问答])(?=[^\n：:]*[\u4e00-\u9fff])[^\n：:,，。！？；;.!?]{2,12}[：:]\s*\S/.test(
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
    cardLines,
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
// scope 用的是正则匹配下标，必须和 text.length 比，不能和「去空白字数」比
// （第二轮 N2：同段 84 字文本前面加 100 个换行，platitude-open 就从命中变不命中）。
function collectSpans(text, rule) {
  const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : `${rule.re.flags}g`);
  const spans = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
    if (m[0].length === 0) re.lastIndex += 1;
  }
  if (rule.scope === "opening") {
    const limit = Math.max(60, Math.min(200, text.length * 0.2));
    return spans.filter((s) => s.start < limit);
  }
  if (rule.scope === "closing") {
    const from = text.length * 0.65;
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
  // 首尾空白先去掉：否则「正文前垫 100 个空行」就能把开头套话挤出 opening 作用域
  // （第二轮 N2），既影响 scope 判定，也让同样的正文得到不同的分。
  const text = stripCode(rawText).replace(/^\s+/, "").replace(/\s+$/, "");
  const m = computeMetrics(text);
  const hits = [];
  const spans = [];
  const formatSpans = [];

  for (const rule of RULES) {
    let found = collectSpans(text, rule);
    if (rule.dedupe) {
      // 术语类规则按「不同词」计数：同一个黑话复读 3 遍不该是 3 倍罪
      const seen = new Set();
      found = found.filter((s) => {
        const key = s.text;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    if (found.length === 0) continue;
    // 排版权重的规则只当观察信号（第三轮 REP3-02：文档说「排版不定罪」，
    // 但 fmt 类规则原先直接进了 ruleWeight，两条 `**注意**：` 就把 31 字人写说明顶到 60 分）
    const tier = rule.evidence === "format" ? "format" : "convict";
    for (const s of found) {
      const span = { ...s, sev: rule.sev, id: rule.id, cat: rule.cat };
      if (tier === "format") formatSpans.push(span);
      else spans.push(span);
    }
    hits.push({
      id: rule.id,
      cat: rule.cat,
      sev: rule.sev,
      count: found.length,
      samples: [...new Set(found.map((s) => s.text.trim()))].slice(0, 3),
      hint: rule.hint,
      kind: "rule",
      tier,
    });
  }

  for (const metric of METRICS) {
    const count = metric.measure(text, m);
    if (!count || count <= 0) continue;
    const evidence = metric.evidence ?? "rhythm";
    hits.push({
      id: metric.id,
      cat: metric.cat,
      sev: metric.sev,
      count: Math.round(count * 100) / 100,
      samples: [],
      hint: metric.hint,
      kind: "metric",
      evidence,
      tier: evidence === "strong" ? "convict" : "format",
    });
  }

  const merged = mergeSpans(spans);
  const formatMerged = mergeSpans(formatSpans);
  const covered = merged.reduce((s, iv) => s + (iv.end - iv.start), 0);

  // 三档证据：strong 可单独定罪；format 只能当观察信号；rhythm 只能在已有定罪时加成。
  let rhythmWeight = 0;
  let strongWeight = 0;
  let formatWeight = formatMerged.reduce((s, iv) => s + iv.sev, 0);
  for (const h of hits) {
    if (h.kind !== "metric") continue;
    if (h.evidence === "strong") strongWeight += h.sev * h.count;
    else if (h.evidence === "format") formatWeight += h.sev * h.count;
    else rhythmWeight += h.sev * h.count;
  }
  const ruleWeight = merged.reduce((s, iv) => s + iv.sev, 0) + strongWeight;

  // 规则命中 × 篇幅：K 是「这段长度下正常能容忍的命中量」。
  // 命中量随篇幅同比例增长时分数不降（修掉「越长越免疫」），
  // 短文本单条轻微命中也不会被密度公式放大成重罪。
  const k = 4.5 + m.chars / 100;
  const ruleScore = ruleWeight === 0 ? 0 : 100 * (1 - Math.exp(-ruleWeight / k));

  // 排版证据不能单独定罪：人类写清单、数据表、会议纪要、贴 emoji 的工作日志同样工整
  // （第一轮 FP-04 换灯泡步骤、FP-09 加粗强调、第二轮 FP2-01 emoji 日志、第三轮 FP3-01
  // 技术文档 1/2/3 条加粗标签 = 29/47/61 分、说明书 2/4 条 = 52/75 分，全是这么被误判的）。
  // 但「整篇只有排版、没有一个字套话」的 AI 回答也确实存在（第二轮 FN2-02：143 字标题+加粗得 0 分），
  // 所以留一个受限出口：排版权重 ≥5 时给一点分，封顶 25——能被看见，但永远进不了「中等」档。
  const formatNudge =
    ruleWeight === 0 && formatWeight >= 5 ? Math.min(25, Math.round(formatWeight * 2)) : 0;
  // 节奏类指标（句长均匀、段落等长）只能在已有规则命中时加成，且封顶 4
  // （HUMAN-LONG：278 字人写随笔零 AI 腔词，曾被节奏指标单独推到 43 分）。
  const metricBonus = ruleWeight === 0 ? 0 : Math.min(4, rhythmWeight);
  const score = Math.max(
    0,
    Math.min(100, Math.round(Math.max(ruleScore, formatNudge) + metricBonus)),
  );
  const band = bandOf(score);

  const weighted = Math.round((ruleWeight + Math.min(rhythmWeight, 6)) * 100) / 100;
  const density = Math.round(((ruleWeight * 1000) / Math.max(m.chars, 300)) * 100) / 100;
  const coverage = m.chars > 0 ? Math.round((covered / m.chars) * 1000) / 1000 : 0;

  hits.sort((a, b) => {
    const tierRank = (h) => (h.tier === "format" ? 1 : 0);
    return (
      tierRank(a) - tierRank(b) ||
      b.sev * Math.min(b.count, 3) - a.sev * Math.min(a.count, 3) ||
      a.id.localeCompare(b.id)
    );
  });

  // 传 -1 / 0 / NaN 时退回默认值再钳到 [1,50]：
  // 第二轮 N4 的坑是「报告顶部 78/100（明显 AI 腔），底部完全没有改写建议」——
  // 定罪了却不说怎么改，对使用者是死胡同。
  const requested = Number.isFinite(opts.maxSuggestions) ? Math.trunc(opts.maxSuggestions) : 6;
  const limit = Math.min(50, Math.max(1, requested || 6));
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
    // 第三轮 H1：analyzed 原先写 `chars >= 10`，导致 9 字强信号稿（「希望对你有帮助。」= 48 分）
    // 被判成「无正文可评」，命中明细与改写建议两节整段消失，同一行还自相矛盾。
    // 只要剥离代码后还剩字，就是分析过了。
    analyzed: m.chars > 0,
    weighted,
    density,
    coverage,
    ruleWeight: Math.round(ruleWeight * 100) / 100,
    strongWeight: Math.round(strongWeight * 100) / 100,
    formatWeight: Math.round(formatWeight * 100) / 100,
    rhythmWeight: Math.round(rhythmWeight * 100) / 100,
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
      cardLines: m.cardLines,
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
  const rawScore = Number.isFinite(r.score) ? r.score : 0;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const chars = Number.isFinite(r.chars) ? Math.max(0, Math.round(r.chars)) : 0;
  const hits = Array.isArray(r.hits) ? r.hits : [];
  const suggestions = Array.isArray(r.suggestions) ? r.suggestions : [];
  const analyzed = r.analyzed !== false && chars > 0;
  const lines = [];
  lines.push(
    `AI 腔评分：${score}/100（${analyzed ? (r.bandLabel ?? bandOf(score).label) : "无正文可评"}）｜正文 ${chars} 字，命中片段 ${r.spans ?? 0} 处（加权 ${r.ruleWeight ?? 0}），规则密度 ${r.density ?? 0}/千字`,
  );
  if (!analyzed) {
    // 不说清这一点，调用方会把「整段是代码/空稿」误读成「写得很干净」
    lines.push("");
    lines.push("没有可分析的正文（整段是代码块、空白或非文本），本次评分不代表文风。");
    return lines.join("\n");
  }
  const cats = Object.entries(r.byCategory ?? {});
  if (cats.length) {
    const head = score === 0 ? "未计分观察（未达定罪阈值）" : "分类";
    lines.push(`${head}：${cats.map(([, v]) => `${v?.label ?? ""} ${v?.weighted ?? 0}`).join("，")}`);
  }
  lines.push("");
  if (hits.length === 0) {
    lines.push("未命中任何规则。");
  } else {
    const onlyFormat = score > 0 && (r.ruleWeight ?? 0) === 0;
    lines.push(
      score === 0
        ? "命中明细（仅观察，未计入评分）："
        : onlyFormat
          ? "命中明细（全部为排版观察，未定罪）："
          : "命中明细（按严重度排序）：",
    );
    for (const h of hits) {
      const samples = Array.isArray(h?.samples) ? h.samples : [];
      const sample = samples.length ? `　例：${samples.join(" / ")}` : "";
      const tag = h?.tier === "format" ? "观察" : "定罪";
      lines.push(
        `- [${tag}][${CATEGORY_LABELS[h?.cat] ?? h?.cat ?? "?"}·${h?.sev ?? "?"}] ${h?.id ?? "?"} ×${h?.count ?? 0}${sample}`,
      );
    }
  }
  if (suggestions.length) {
    lines.push("");
    lines.push("改写建议：");
    suggestions.forEach((s, i) => lines.push(`${i + 1}. ${s?.hint ?? ""}`));
  }
  return lines.join("\n");
}
