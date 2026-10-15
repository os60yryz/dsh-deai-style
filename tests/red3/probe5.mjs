// 探针5：renderPrompt 正确签名下的档位长度 + service-close 覆盖缺口
import { writeFileSync } from "node:fs";
import { renderPrompt, LEVELS } from "../../lib/prompt.js";
import { lint } from "../../lib/lint.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = { len: {}, probes: [] };
for (const lv of LEVELS) out.len[lv] = renderPrompt({ level: lv }).length;
out.len["strict+extra"] = renderPrompt({ level: "strict", extraRules: "额外要求一条。" }).length;
out.len["noArg"] = renderPrompt().length;
const strictTxt = renderPrompt({ level: "strict" });
const softTxt = renderPrompt({ level: "soft" });
out.itemsStrict = strictTxt.split("\n").filter((l) => /^\d+\./.test(l.trim())).length;
out.itemsSoft = softTxt.split("\n").filter((l) => /^\d+\./.test(l.trim())).length;
out.softHas16 = /分点|小标题/.test(softTxt);
out.strictHas16 = /分点|小标题/.test(strictTxt);
out.tailStrict = strictTxt.split("\n").slice(-2).join(" | ");
out.tailSoft = softTxt.split("\n").slice(-2).join(" | ");
out.lenSoftChars = softTxt.length;

const cases = [
  ["S1-以上就是我的回答。", "以上就是我的回答。"],
  ["S2-以上就是这些，谢谢。", "以上就是这些，谢谢。"],
  ["S3-以上就是本次分享。", "以上就是本次分享。"],
  ["S4-感谢阅读。", "感谢阅读。"],
  ["S5-感谢大家的阅读。", "感谢大家的阅读。"],
  ["S6-祝你顺利。", "祝你顺利。"],
  ["S7-祝你一切顺利。", "祝你一切顺利。"],
  ["S8-随时问我。", "随时问我。"],
  ["S9-还有什么可以帮你？", "还有什么可以帮你？"],
  ["S10-如果还有其他问题，欢迎提问。", "如果还有其他问题，欢迎提问。"],
  ["S11-希望对你有所帮助。", "希望对你有所帮助。"],
  ["S12-希望这些内容对你有帮助。", "希望这些内容对你有帮助。"],
];
for (const [id, t] of cases) {
  const r = lint(t);
  out.probes.push({ id, chars: r.chars, score: r.score, band: r.band, rw: r.ruleWeight, an: r.analyzed, hits: r.hits.map((h) => h.id + "x" + h.count) });
}
writeFileSync(join(here, "out5.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ len: out.len, itemsStrict: out.itemsStrict, itemsSoft: out.itemsSoft, softHas16: out.softHas16, strictHas16: out.strictHas16, tailSoft: out.tailSoft, tailStrict: out.tailStrict }, null, 1));
for (const p of out.probes) console.log(`${p.id}\tchars=${p.chars}\tscore=${p.score}\t${p.band}\trw=${p.rw}\tan=${p.an}\t${p.hits}`);
