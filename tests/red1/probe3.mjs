// 红队第一轮探针 3：长文摊薄定量、围栏配对、提示词/计划纯函数
import { lint } from "../../lib/lint.js";
import { renderPrompt } from "../../lib/prompt.js";
import { planRegistrations, normalizeConfig } from "../../lib/plan.js";
import { writeFileSync } from "node:fs";

const AI_SEG = "作为一个中年人，我不觉得故宫是最标志性的北京。对我来说是胡同口那家早点铺。一般来说，游客不会往那儿去，可那才是日子。";
const FILL_A = "今天的天气说不上好，云压得很低。我在楼下站了一会儿就上去了。";
const FILL_B = "锅里水开了，我把面下进去，搅了两下，盖上盖子。窗外有小孩在喊，听不清喊什么。";

const out = { thin: {}, fence: {}, human: {}, prompt: {}, plan: {} };

for (const n of [0, 30, 80, 150]) {
  const t = AI_SEG + (FILL_B + FILL_A).repeat(n);
  const r = lint(t);
  out.thin["repeat_" + n] = { chars: r.chars, score: r.score, band: r.band, hits: r.hits.map((h) => h.id + "x" + h.count) };
}

out.fence.tripleFence = (() => {
  const r = lint("```js\nconst a = '```';\n```\n首先，结束语。综上所述。");
  return { chars: r.chars, score: r.score, hits: r.hits.map((h) => h.id) };
})();
out.fence.oneFence = (() => {
  const r = lint("```\n代码没写完就开始讲散文了。首先，我们要明确目标。\n");
  return { chars: r.chars, score: r.score, hits: r.hits.map((h) => h.id) };
})();
out.fence.tabBullet = (() => {
  const r = lint("前言。\n\t- 第一条\n\t- 第二条\n\t- 第三条");
  return { counts: r.counts, score: r.score, hits: r.hits.map((h) => h.id + "x" + h.count) };
})();

const HUMAN_LONG = [
  "我妈今年六十二，学会了用手机买菜。一开始我挺担心，她连支付密码都记不住，每次都要给我打电话。",
  "后来我发现，她有自己的办法：把密码写在存折夹层里，再拍张照片存进相册。她说这样丢不了，反正手机丢了照片也没了。",
  "我听完觉得好笑，又觉得有点心酸。我们这代人总觉得工具越简单越好，恨不得一键完成；她那一代人恰好相反，凡是要紧的东西都得留个实物凭证。",
  "上周她第一次自己在上面买了排骨，打电话过来报账，说比菜场便宜四块钱，语气里带着点得意。我说那你以后别跑菜场了，她说不行，菜场要挑，肉得看颜色。",
  "等等，她还说了句让我印象很深的话：机器挑的肉，看不见眼睛。这句话我琢磨了好几天。",
].join("\n\n");

const HUMAN_MID = [
  "首先说明一件事，我不是反对加班，我是反对没意义的加班。",
  "去年我们组连着三个月周末在线，做的那个功能上线两周就下线了。",
  "其次，如果真是紧急故障，我半夜爬起来也认。这种事我干过，不止一次。",
  "怕的是把「随时待命」当成默认状态，然后所有人都假装很忙。",
].join("\n");

out.human.long = (() => {
  const r = lint(HUMAN_LONG);
  return { chars: r.chars, score: r.score, band: r.band, hits: r.hits.map((h) => h.id + "(sev" + h.sev + ")x" + h.count) };
})();
out.human.mid = (() => {
  const r = lint(HUMAN_MID);
  return { chars: r.chars, score: r.score, band: r.band, hits: r.hits.map((h) => h.id + "(sev" + h.sev + ")x" + h.count) };
})();

out.prompt.strict = renderPrompt({ level: "strict", toolName: "deai_scan" }).length;
out.prompt.soft = renderPrompt({ level: "soft" }).length;
out.prompt.off = JSON.stringify(renderPrompt({ level: "off" }));
out.plan.off1 = JSON.stringify(planRegistrations({ enabled: false }, { personaPrefix: 0, personaSuffix: 100 }));
out.plan.off2 = JSON.stringify(planRegistrations({ level: "off" }, { personaPrefix: 0, personaSuffix: 100 }));
out.plan.normal = (() => {
  const p = planRegistrations({}, { personaPrefix: 0, personaSuffix: 100 });
  return { name: p.section.name, order: p.section.order, tool: p.tool, textLen: p.section.text.length };
})();
out.plan.badLevel = normalizeConfig({ level: "nonsense" }).level;
out.plan.promptHasNoOutputGate = /重写|改写/.test(renderPrompt({ level: "strict", toolName: "deai_scan" }));

writeFileSync(new URL("./out3.json", import.meta.url), JSON.stringify(out, null, 1), "utf8");
console.log("WROTE out3.json");
