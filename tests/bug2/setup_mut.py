# -*- coding: utf-8 -*-
"""第二轮审计：变异测试。复制 5 份被测仓库（排除 node_modules/.git），
分别注入 恒返0 / 恒返100 / suggestions恒空 / 关闭区间合并 四种变异，
跑 node tests/checks.mjs，统计哪些断言在变异下仍然 PASS（= 对该变异恒真/空过）。
"""
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = r"D:\GitRepos\dsh-deai-style.git"
BASE = os.path.join(ROOT, "tmp", "bug2")
PLUG = os.path.join(BASE, "mut")

SCORE_OLD = (
    "  const score = Math.max(\n"
    "    0,\n"
    "    Math.min(100, Math.round(Math.max(ruleScore, strongScore) + metricBonus)),\n"
    "  );\n"
)
MUTS = {
    "mut0_orig": [],
    "mut1_score0": [(SCORE_OLD, "  const score = 0;\n")],
    "mut2_score100": [(SCORE_OLD, "  const score = 100;\n")],
    "mut3_nosuggest": [("    if (suggestions.length >= limit) break;\n", "    if (true) break;\n")],
    "mut4_nomerge": [("  const merged = mergeSpans(spans);\n", "  const merged = spans;\n")],
}


def build(name, patches):
    dst = os.path.join(PLUG, name)
    if os.path.isdir(dst):
        assert dst.startswith(BASE)
        shutil.rmtree(dst)
    os.makedirs(dst)
    shutil.copy2(os.path.join(ROOT, "index.js"), dst)
    shutil.copy2(os.path.join(ROOT, "package.json"), dst)
    for sub in ("lib", "tests"):
        shutil.copytree(os.path.join(ROOT, sub), os.path.join(dst, sub),
                        ignore=shutil.ignore_patterns("node_modules", ".git"))
    os.makedirs(os.path.join(dst, "node_modules"), exist_ok=True)
    link = os.path.join(dst, "node_modules", "@deepseek-ai")
    rc = subprocess.run(["cmd", "/c", "mklink", "/J", link,
                         os.path.join(ROOT, "node_modules", "@deepseek-ai")],
                        capture_output=True, text=True)
    lintp = os.path.join(dst, "lib", "lint.js")
    src = open(lintp, encoding="utf-8").read()
    for old, new in patches:
        assert src.count(old) == 1, "patch anchor not unique: %r" % old[:40]
        src = src.replace(old, new)
    open(lintp, "w", encoding="utf-8", newline="\n").write(src)
    return dst, rc.returncode


def run_checks(dst):
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    p = subprocess.run(["node", "tests/checks.mjs"], cwd=dst, capture_output=True, env=env)
    out = p.stdout.decode("utf-8", "replace")
    passed = [l[5:].strip() for l in out.splitlines() if l.startswith("PASS ")]
    failed = [l[5:].strip() for l in out.splitlines() if l.startswith("FAIL ")]
    m = re.search(r"TOTAL pass=(\d+) fail=(\d+)", out)
    return {"rc": p.returncode, "pass": len(passed), "fail": len(failed),
            "total": m.group(0) if m else None, "passLabels": passed, "failLabels": failed,
            "stderr": p.stderr.decode("utf-8", "replace")[:300]}


res = {}
for name, patches in MUTS.items():
    dst, rc = build(name, patches)
    res[name] = run_checks(dst)
    res[name]["mklink_rc"] = rc

zero = set(res["mut0_orig"]["passLabels"])
summary = {k: {"pass": v["pass"], "fail": v["fail"], "total": v["total"], "rc": v["rc"]} for k, v in res.items()}
taut = sorted(set(res["mut1_score0"]["passLabels"]) & set(res["mut2_score100"]["passLabels"]) & zero)
insens_sugg = sorted(set(res["mut3_nosuggest"]["passLabels"]) & zero)
insens_merge = sorted(set(res["mut4_nomerge"]["passLabels"]) & zero)

out = {
    "summary": summary,
    "mut1_still_pass_count": len(res["mut1_score0"]["passLabels"]),
    "mut2_still_pass_count": len(res["mut2_score100"]["passLabels"]),
    "tautology_score_labels": taut,
    "tautology_score_count": len(taut),
    "mut3_fail_labels": res["mut3_nosuggest"]["failLabels"],
    "mut3_insensitive_count": len(insens_sugg),
    "mut4_fail_labels": res["mut4_nomerge"]["failLabels"],
    "mut4_insensitive_count": len(insens_merge),
    "stderr": {k: v["stderr"] for k, v in res.items() if v["stderr"]},
}
with open(os.path.join(BASE, "mut_result.json"), "w", encoding="utf-8", newline="\n") as fh:
    fh.write(json.dumps(res, ensure_ascii=False, indent=1))
print(json.dumps(out, ensure_ascii=False, indent=1))
