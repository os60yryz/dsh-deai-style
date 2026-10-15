# -*- coding: utf-8 -*-
import json, os
BASE = r"D:\GitRepos\dsh-deai-style.git\tmp\bug2"
res = json.load(open(os.path.join(BASE, "mut_result.json"), encoding="utf-8"))
lines = []
for k, v in res.items():
    lines.append("%-16s pass=%-4d fail=%-4d %s" % (k, v["pass"], v["fail"], v["total"]))
zero = set(res["mut0_orig"]["passLabels"])
m1 = set(res["mut1_score0"]["passLabels"])
m2 = set(res["mut2_score100"]["passLabels"])
taut = sorted(m1 & m2 & zero)
lines.append("")
lines.append("总断言=%d  恒返0仍PASS=%d  恒返100仍PASS=%d  两者都PASS(=分数无关)=%d"
             % (len(zero), len(m1 & zero), len(m2 & zero), len(taut)))
lines.append("--- 分数无关断言清单（%d 条，改动 score 不会失败）---" % len(taut))
for i, t in enumerate(taut, 1):
    lines.append("%2d. %s" % (i, t))
lines.append("")
lines.append("--- mut1(恒返0) 失败的断言 = 只看分数不看内容的 %d 条 ---" % len(res["mut1_score0"]["failLabels"]))
for i, t in enumerate(res["mut1_score0"]["failLabels"], 1):
    lines.append("%2d. %s" % (i, t))
lines.append("")
lines.append("--- mut4(取消区间合并) 失败断言数 = %d ---" % len(res["mut4_nomerge"]["failLabels"]))
for i, t in enumerate(res["mut4_nomerge"]["failLabels"], 1):
    lines.append("%2d. %s" % (i, t))
lines.append("--- mut3(suggestions 恒空) 失败断言 = %d ---" % len(res["mut3_nosuggest"]["failLabels"]))
for i, t in enumerate(res["mut3_nosuggest"]["failLabels"], 1):
    lines.append("%2d. %s" % (i, t))
open(os.path.join(BASE, "mut_summary.txt"), "w", encoding="utf-8", newline="\n").write("\n".join(lines) + "\n")
print("WROTE", os.path.join(BASE, "mut_summary.txt"), len(taut))
