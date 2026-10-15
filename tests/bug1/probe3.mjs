// 临时探针 3：分数上界与 CRLF 空白行的性能
import { readFileSync } from "node:fs";
import { lint, stripCode } from "../../lib/lint.js";

const out = [];
const say = (...a) => out.push(a.join(" "));
const ai = readFileSync("tests/fixtures/ai_style_sample.txt", "utf8");

say(`单份 AI 样例: ${lint(ai).score}`);
for (const n of [2, 5, 20]) say(`AI 样例 x${n}: ${lint(ai.repeat(n)).score}`);
say(`AI 样例 + 全规则叠加: ${lint(ai + "首先，其次，最后。综上所述，值得注意的是。这是一个很好的问题。" + "让我们 look。既方便又便宜还好用。此外，赋能助力彰显里程碑。" ).score}`);

let max = 0, maxText = "";
const frag = ai.split("\n").filter((l) => l.trim());
for (let i = 0; i < 2000; i += 1) {
  const k = 3 + Math.floor(Math.random() * 20);
  let s = "";
  for (let j = 0; j < k; j += 1) s += frag[Math.floor(Math.random() * frag.length)] + "\n";
  const r = lint(s);
  if (r.score > max) {
    max = r.score;
    maxText = s.slice(0, 60);
  }
  if (r.score > 100 || r.score < 0) say(`越界! score=${r.score}`);
}
say(`随机拼装 2000 例最高分 = ${max} :: ${JSON.stringify(maxText)}`);

say("== CRLF 空白行（Windows 粘贴）==");
for (const n of [10000, 20000, 40000]) {
  const t0 = Date.now();
  lint("\r\n".repeat(n));
  say(`lint '\\r\\n'x${n} (${n * 2} 字符): ${Date.now() - t0}ms`);
}
for (const n of [10000, 20000]) {
  const t0 = Date.now();
  lint("  \r\n".repeat(n));
  say(`lint '  \\r\\n'x${n} (${n * 4} 字符): ${Date.now() - t0}ms`);
}
say("== 其它可能的二次源：制表符空行 ==");
for (const n of [10000, 20000]) {
  const t0 = Date.now();
  lint("\t\n".repeat(n));
  say(`lint '\\t\\n'x${n}: ${Date.now() - t0}ms`);
}
console.log(out.join("\n"));
