// 红队第一轮探针：误报 / 漏报 / 规则级缺陷 / 稳定性 / 性能
import { lint } from "../../lib/lint.js";
import { writeFileSync } from "node:fs";

const CASES = [
  // ===== 误报：地道人写中文 =====
  {
    id: "FP-01",
    note: "自然口语随笔，含「作为一个…」「标志性」「一般来说」各一次",
    expect: "<36（人写）",
    text: "作为一个中年人，我不觉得故宫是最标志性的北京。对我来说是胡同口那家早点铺。一般来说，游客不会往那儿去，可那才是日子。",
  },
  {
    id: "FP-02",
    note: "日常三项并列（白菜、萝卜和土豆）",
    expect: "<36（人写）",
    text: "我妈今天去菜场买了白菜、萝卜和土豆，说晚上炖排骨。她还顺手拿了两根葱，说是买一送一。回来路上碰到老张，聊了半小时才上楼。",
  },
  {
    id: "FP-03",
    note: "人写议论文用「首先…其次…」组织观点",
    expect: "<36（人写）",
    text: "首先，这个项目本来就该砍掉；其次，砍掉之后人往哪儿放才是真问题。这几年内部孵化的东西，活下来的不到三成。",
  },
  {
    id: "FP-04",
    note: "人写操作步骤，用 bullet 列 5 步",
    expect: "<36（人写）",
    text: "换灯泡的步骤：\n- 关掉总闸，别嫌麻烦\n- 搬梯子过来，站稳\n- 拧下旧灯泡，用布包着扔\n- 装新的，顺时针拧到底\n- 合闸，试一下亮不亮",
  },
  {
    id: "FP-05",
    note: "人写会议纪要，「注意事项：」式行首标签",
    expect: "<36（人写）",
    text: "会议时间：10月9日下午两点\n参会人：老王、小李和我\n注意事项：预算先按去年比例走，年底再看，别提前承诺。",
  },
  {
    id: "FP-06",
    note: "人写学术分析，含「体系」「层面」等抽象名词",
    expect: "<36（人写）",
    text: "这套法律体系的问题不在于条文多少，而在于执行的时候各地标准不一样。我查过三个省的判决，同类案子的量刑差了将近一倍。",
  },
  {
    id: "FP-07",
    note: "人写聊天，用两个 ✅",
    expect: "<36（人写）",
    text: "✅ 打包好了 ✅ 传上去了，剩下的事明天再说。折腾两天，最后发现是缓存没清。",
  },
  {
    id: "FP-08",
    note: "人写笔记含「等等」「此外」",
    expect: "<36（人写）",
    text: "此外还得备点常用药，感冒药、退烧贴等等。上次出门忘带，半夜找药店找了四十分钟，教训太深。",
  },
  {
    id: "FP-09",
    note: "人写含一处加粗强调（插件自身允许「一屏一处加粗」）",
    expect: "<36（人写）",
    text: "这个方案我不看好。**验收标准写得太虚**，什么叫「体验更好」？谁来测？怎么算通过？",
  },
  {
    id: "FP-10",
    note: "人写含「作为一个中国人，」正常句",
    expect: "<36（人写）",
    text: "作为一个中国人，我吃辣其实很一般。上次去成都，朋友点的微辣把我辣哭了，他们笑得不行，,还拍照发了朋友圈。".replace("，,", "，"),
  },

  // ===== 漏报：明显 AI 腔 =====
  {
    id: "FN-01",
    note: "纯 Markdown 表格的 AI 回答（被 stripCode 整段剥掉）",
    expect: "≥36（AI 腔）",
    text: "| 对比项 | 方案A | 方案B |\n|---|---|---|\n| 成本 | 低 | 高 |\n| 周期 | 短 | 长 |\n| 风险 | 中 | 低 |\n| 可维护性 | 差 | 好 |",
  },
  {
    id: "FN-02",
    note: "AI 客服式结尾，但用「希望这些内容对你有帮助」「感谢大家的阅读」变体",
    expect: "≥36（AI 腔）",
    text: "以上就是本次更新的全部内容。如果你在使用中遇到任何问题，欢迎随时反馈，我们会尽快处理。感谢大家的阅读。",
  },
  {
    id: "FN-03",
    note: "「让我们一起…」Let's 直译（正则前瞻排除汉字，失配）",
    expect: "≥36（AI 腔）",
    text: "让我们一起来聊聊这个功能到底好不好用。我们先看第一点，再看第二点。",
  },
  {
    id: "FN-04",
    note: "四项排比，不用「和/与/及」",
    expect: "≥36（AI 腔）",
    text: "它需要时间、需要耐心、需要方法、需要运气。四样缺一不可，这就是现实。",
  },
  {
    id: "FN-05",
    note: "✨/👉 emoji 列表（白名单外的 emoji）",
    expect: "≥36（AI 腔）",
    text: "✨ 本次更新要点\n✨ 性能提升 30%\n✨ 修复了 12 个 bug\n👉 详情请见文档",
  },
  {
    id: "FN-06",
    note: "「第一，…第二，…第三，…」序列式 AI 腔",
    expect: "≥36（AI 腔）",
    text: "第一，明确目标；第二，拆解任务；第三，逐项验收；第四，复盘归档。这是标准流程。",
  },
  {
    id: "FN-07",
    note: "「不是X；而是Y」分号变体（字符类排除分号）",
    expect: "≥36（AI 腔）",
    text: "效率的关键不是做得更快；而是做得更少。真正的成长不是加法；而是减法。",
  },
  {
    id: "FN-08",
    note: "bullet + 加粗但无冒号（bold-label-line 要求紧跟全/半角冒号）",
    expect: "≥36（AI 腔）",
    text: "- **性能** 提升了 30%\n- **稳定性** 显著改善\n- **成本** 下降了 20%\n- **体验** 更加流畅",
  },
  {
    id: "FN-09",
    note: "3000 字长文，30 处「首先/其次/综上所述」模板连接词（饱和+长文归一化）",
    expect: "≥36（AI 腔）",
    text: (() => {
      const seg = "首先，我们需要明确目标。其次，拆解任务并分派到人。综上所述，这是一套行之有效的方法论。";
      return Array.from({ length: 30 }, (_, i) => `${seg}第${i}段补充说明，确保长度足够。`).join("\n\n");
    })(),
  },
  {
    id: "FN-10",
    note: "AI 引用块（> 前缀），stripCode 不处理引用块",
    expect: "≥36（AI 腔）",
    text: "> 在当今这个快速变化的时代，只有持续学习才能保持竞争力。\n> 希望这些内容对你有帮助。\n> 让我们一起努力，迎接未来的挑战。",
  },
  {
    id: "FN-11",
    note: "AI 加粗小标题行 + 半角冒号，但整行加粗后接半角冒号且缩进（对照）",
    expect: "≥36（AI 腔）",
    text: "**核心结论**：效率提升的关键在于减少无效沟通。\n**实施路径**：先试点再推广。\n**预期收益**：三个月内见效。",
  },
  {
    id: "FN-12",
    note: "纯 bullet 步骤式 AI 回答，无任何模板词",
    expect: "≥36（AI 腔）",
    text: "以下是三种方法：\n- 番茄工作法，25 分钟一个周期\n- 两分钟法则，能立刻做完就立刻做\n- 时间块，把同类任务集中处理\n- 每日复盘，睡前花五分钟\n- 关闭通知，减少打断",
  },
];

const out = { cases: [], stability: {}, perf: {}, edge: {} };

for (const c of CASES) {
  const r = lint(c.text, { maxSuggestions: 3 });
  out.cases.push({
    id: c.id,
    note: c.note,
    expect: c.expect,
    chars: r.chars,
    score: r.score,
    band: r.band,
    weighted: r.weighted,
    density: r.density,
    hits: r.hits.map((h) => `${h.id}(${h.cat},sev${h.sev})x${h.count}`),
    counts: r.counts,
  });
}

// 稳定性：同一文本连跑 3 次，检查 /g 正则 lastIndex 复用是否污染计数
const stable = "首先，我们要明确目标。综上所述，这不是能力问题，而是方法问题。**关键**：坚持下去。";
const runs = [lint(stable), lint(stable), lint(stable)].map((r) => ({
  score: r.score,
  sig: r.hits.map((h) => h.id + ":" + h.count).join("|"),
}));
out.stability = { runs, identical: runs.every((r) => r.sig === runs[0].sig && r.score === runs[0].score) };

// 边界
out.edge.empty = (({ score, chars, hits }) => ({ score, chars, hits: hits.length }))(lint(""));
out.edge.spaces = (({ score, chars, hits }) => ({ score, chars, hits: hits.length }))(lint("   \n\n  \t "));
out.edge.onlyCode = (({ score, chars, hits }) => ({ score, chars, hits: hits.length }))(lint("```js\nconst a = 1;\n```"));
out.edge.onlyInline = (({ score, chars, hits }) => ({ score, chars, hits: hits.length }))(lint("`首先，这是一个很好的问题` 然后结束了。"));
out.edge.crlf = (({ score, chars, hits }) => ({ score, chars, hits: hits.map((h) => h.id) }))(
  lint("首先，明确目标。\r\n其次，拆解任务。\r\n最后，逐项验收。\r\n")
);
out.edge.emdashVar = (({ score, hits }) => ({ score, hits: hits.map((h) => h.id + ":" + h.count) }))(
  lint("他说——不，是我记错了——那件事发生在去年。")
);
out.edge.emdashSingle = (({ score, hits }) => ({ score, hits: hits.map((h) => h.id + ":" + h.count) }))(
  lint("他说—不，是我记错了—那件事发生在去年。这里需要足够多的字来凑够密度测试的长度上限。")
);
out.edge.emojiVariants = (({ score, hits }) => ({ score, hits: hits.map((h) => h.id + ":" + h.count) }))(
  lint("❤️ 很喜欢\n⚠ 注意\n✨ 闪亮\n✅ 完成")
);
out.edge.tablePollutesLines = (({ counts }) => counts)(
  lint("前言一句。\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\n后记一句。")
);
out.edge.quoteNotStripped = (({ chars, hits }) => ({ chars, hits: hits.map((h) => h.id) }))(
  lint("> 首先，明确目标\n> 其次，拆解任务")
);

// 性能
function timeIt(label, text, n = 3) {
  const t0 = performance.now();
  let score = 0;
  for (let i = 0; i < n; i++) score = lint(text).score;
  const ms = (performance.now() - t0) / n;
  out.perf[label] = { chars: text.length, msAvg: Math.round(ms * 100) / 100, score };
}
timeIt("notButRepeated", "不是这样，而是那样的说法。".repeat(3000));
timeIt("longNoPunct", "这是一段没有任何标点的超长中文文本".repeat(2000));
timeIt("triadicStorm", "白菜、萝卜和土豆，".repeat(3000));
timeIt("colonStorm", ("很长的一行内容继续写下去".repeat(50) + "\n").repeat(400));
timeIt("mixedRealistic", "首先，我们要明确目标，其次，拆解任务。这不是能力问题，而是方法问题。".repeat(1500));

writeFileSync(new URL("./out1.json", import.meta.url), JSON.stringify(out, null, 1), "utf8");
console.log("WROTE out1.json cases=" + out.cases.length);
