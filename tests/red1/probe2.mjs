// 红队第一轮探针 2：规则级缺陷定点复现
import { lint } from "../../lib/lint.js";
import { RULES, METRICS } from "../../lib/ruleset.js";
import { writeFileSync } from "node:fs";

const T = (id, note, text, expect) => {
  const r = lint(text);
  return {
    id,
    note,
    expect,
    chars: r.chars,
    score: r.score,
    band: r.band,
    weighted: r.weighted,
    hits: r.hits.map((h) => `${h.id}(sev${h.sev})x${h.count}`),
    counts: r.counts,
  };
};

const out = { items: [], probes: {} };

out.items = [
  T("D-01", "stripCode 把正文里含两个竖线的散文行整行删掉", "选择题：左边 | 右边，你选哪个？\n我选左边，因为右边我没试过。", "应保留该行参与打分"),
  T("D-02", "未闭合的围栏代码块：内容不被剥离，代码里的词参与散文打分", "```js\nconst a = 1; // 首先，这是注释，其次，也是注释。综上，都是注释\nconsole.log(a);", "代码内容应被剥离"),
  T("D-03", "未闭合的行内代码：反引号内文本参与打分", "`首先，这是一个很好的问题，其次，综上所述` 这类字符串是模板。", "行内代码应被剥离"),
  T("D-04", "colon-definition 误伤正文中的时间 14:30", "上午十点开始14:30结束，大家别迟到，晚到的人自己补进度。", "不应命中"),
  T("D-05", "both-sides 漏「既有…又有」（正则强制要求末尾「还」）", "这个方案既有优点又有缺点，得看你怎么用。", "应命中"),
  T("D-06", "both-sides 命中人写「既…又…还」（正常汉语）", "他既不肯走，又不肯留，还天天抱怨，谁劝都没用。", "不应命中"),
  T("D-07", "同一处格式被 bold-label-line / bold-inline-label / bold-density 三重计分", "- **核心结论**：效率提升的关键在于减少无效沟通，先把话说清楚。", "只应计一次"),
  T("D-08", "emoji-marker 白名单外的 emoji 不命中（😅🎉📊）", "😅 有点尴尬，🎉 总算完成了，📊 数据在这。", "应命中"),
  T("D-09", "let-us 只在「让我们」后紧跟非汉字时命中（标点变体）", "让我们，一起把这个事办了吧。", "应命中（对照 D-10）"),
  T("D-10", "let-us 漏最常见形式「让我们一起来…」", "让我们一起来把这个事办了吧。", "应命中"),
  T("D-11", "not-x-but-y 跨句失效（句号隔开）", "不是能力不够。而是方法不对。这句话我听了十年。", "应命中"),
  T("D-12", "not-x-but-y 引号变体是否命中（对照）", "问题不是「能不能做」，而是「值不值得做」。", "应命中"),
  T("D-13", "长文摊薄：同一段 AI 腔短文补 1000 字中性文字后分数骤降", "作为一个中年人，我不觉得故宫是最标志性的北京。对我来说是胡同口那家早点铺。一般来说，游客不会往那儿去，可那才是日子。" + "今天的天气说不上好，云压得很低，我在楼下站了一会儿就上去了。".repeat(30), "应保持同等判定"),
  T("D-14", "短文放大：58 字人写随笔得 57 分（对照空文本）", "作为一个中年人，我不觉得故宫是最标志性的北京。对我来说是胡同口那家早点铺。一般来说，游客不会往那儿去，可那才是日子。", "<36"),
  T("D-15", "triadic-list 不跨标点误配（对照，确认边界）", "我买了苹果、香蕉，他说要橙子和西瓜。", "不应命中"),
  T("D-16", "triadic-list 命中普通三项并列（人写日常）", "他带了苹果、香蕉和西瓜，分给同事吃。", "不应命中"),
  T("D-17", "abstract-noun-stack 命中正常学术表达", "这个逻辑的问题在于前提就错了，后面推得再漂亮也没用。", "不应命中"),
  T("D-18", "「综上所述」单独出现在长句中间（对照，确认捕获）", "综上所述，这件事没有第二选择。", "应命中"),
];

// lastIndex 复用：跑完之后看模块级正则的 lastIndex 是否被留在非 0
lint("首先，明确目标。其次，拆解任务。");
out.probes.lastIndexAfter = RULES.filter((r) => r.re.lastIndex !== 0).map((r) => r.id + "=" + r.re.lastIndex);
out.probes.ruleCount = RULES.length;
out.probes.metricCount = METRICS.length;
out.probes.dupIds = (() => {
  const seen = {}, dup = [];
  for (const r of RULES) {
    if (seen[r.id]) dup.push(r.id);
    seen[r.id] = 1;
  }
  return dup;
})();

// 逐个规则/指标的单独触发能力（不依赖文本）
out.probes.neverFiredInCorpus = null;

// 计分函数复算：验证 score 是否等于文档口径
const sample = "首先，明确目标。综上所述，这不是能力问题，而是方法问题。";
const r = lint(sample);
out.probes.scoreDecomp = (() => {
  let rw = 0, mw = 0;
  for (const h of r.hits) (h.kind === "rule" ? (rw += h.sev * Math.min(h.count, 2)) : (mw += h.sev * h.count));
  const density = (rw * 1000) / Math.max(r.chars, 300);
  return {
    ruleWeight: rw,
    metricWeight: mw,
    weightedReported: r.weighted,
    weightedUsedInBonus: Math.min(10, mw * 1.5),
    density: Math.round(density * 100) / 100,
    recomputed: Math.round((100 * density) / (density + 20) + Math.min(10, mw * 1.5)),
    actual: r.score,
  };
})();

writeFileSync(new URL("./out2.json", import.meta.url), JSON.stringify(out, null, 1), "utf8");
console.log("WROTE out2.json items=" + out.items.length);
