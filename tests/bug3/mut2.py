# -*- coding: utf-8 -*-
"""第三轮审计 变异测试第二批：score 恒 0 / 恒 100（测恒真断言面）、analyzed 阈值、metricBonus 上限、suggestions 恒空。"""
import json
import os
import re
import shutil
import subprocess

ROOT = r"D:\GitRepos\dsh-deai-style.git"
BASE = os.path.join(ROOT, "tmp", "bug3")
PLUG = os.path.join(BASE, "mut2")
LINT = "lib/lint.js"

SCORE_OLD = (
    "  const score = Math.max(\n"
    "    0,\n"
    "    Math.min(100, Math.round(Math.max(ruleScore, formatNudge) + metricBonus)),\n"
    "  );\n"
)

MUTS = {
    "m2_00_orig": {},
    "m2_01_score0": {LINT: [(SCORE_OLD, "  const score = 0;\n")]},
    "m2_02_score100": {LINT: [(SCORE_OLD, "  const score = 100;\n")]},
    "m2_03_analyzed50": {LINT: [("analyzed: m.chars >= 10,", "analyzed: m.chars >= 50,")]},
    "m2_04_metriccap100": {LINT: [("const metricBonus = ruleWeight === 0 ? 0 : Math.min(4, metricWeight);", "const metricBonus = ruleWeight === 0 ? 0 : Math.min(100, metricWeight);")]},
    "m2_05_nosuggest": {LINT: [("    if (suggestions.length >= limit) break;", "    if (true) break;")]},
}


def build(name, patches):
    dst = os.path.join(PLUG, name)
    if os.path.isdir(dst):
        assert dst.startswith(PLUG)
        shutil.rmtree(dst)
    os.makedirs(dst)
    shutil.copy2(os.path.join(ROOT, "index.js"), dst)
    shutil.copy2(os.path.join(ROOT, "package.json"), dst)
    for sub in ("lib", "tests"):
        shutil.copytree(os.path.join(ROOT, sub), os.path.join(dst, sub),
                        ignore=shutil.ignore_patterns("node_modules", ".git"))
    os.makedirs(os.path.join(dst, "node_modules"), exist_ok=True)
    subprocess.run(["cmd", "/c", "mklink", "/J", os.path.join(dst, "node_modules", "@deepseek-ai"),
                    os.path.join(ROOT, "node_modules", "@deepseek-ai")], capture_output=True, text=True)
    for rel, subs in patches.items():
        p = os.path.join(dst, *rel.split("/"))
        src = open(p, encoding="utf-8").read()
        for old, new in subs:
            assert src.count(old) == 1, "%s anchor: %r" % (name, old[:40])
            src = src.replace(old, new)
        open(p, "w", encoding="utf-8", newline="\n").write(src)
    return dst


def run(dst, script):
    p = subprocess.run(["node", script], cwd=dst, capture_output=True)
    out = p.stdout.decode("utf-8", "replace")
    passed = [l[5:].strip() for l in out.splitlines() if l.startswith("PASS ")]
    failed = [l[5:].strip() for l in out.splitlines() if l.startswith("FAIL ")]
    return {"pass": len(passed), "fail": len(failed), "failed": failed,
            "passed": passed, "stderr": p.stderr.decode("utf-8", "replace")[:200]}


res = {}
for name, patches in MUTS.items():
    dst = build(name, patches)
    c = run(dst, "tests/checks.mjs")
    q = run(dst, "tests/corpus.mjs")
    res[name] = {"checks": c, "corpus": q}
    print("%-20s checks pass=%3d fail=%3d | corpus pass=%2d fail=%2d" % (name, c["pass"], c["fail"], q["pass"], q["fail"]))

zero = set(res["m2_00_orig"]["checks"]["passed"])
s0 = set(res["m2_01_score0"]["checks"]["passed"])
s100 = set(res["m2_02_score100"]["checks"]["passed"])
taut = sorted(s0 & s100 & zero)
print("\nscore 不敏感断言数 = %d / %d" % (len(taut), len(zero)))
print("恒 0 下仍存活 = %d，恒 100 下仍存活 = %d" % (len(s0), len(s100)))
print("恒 0 下失败 =", json.dumps(res["m2_01_score0"]["checks"]["failed"], ensure_ascii=False))
print("恒 100 下失败 =", json.dumps(res["m2_02_score100"]["checks"]["failed"], ensure_ascii=False))
print("suggestions 恒空下失败 =", json.dumps(res["m2_05_nosuggest"]["checks"]["failed"], ensure_ascii=False))
print("analyzed>=50 下失败 =", json.dumps(res["m2_03_analyzed50"]["checks"]["failed"], ensure_ascii=False))
print("metricBonus 上限 100 下失败 =", json.dumps(res["m2_04_metriccap100"]["checks"]["failed"], ensure_ascii=False))
for n, v in res.items():
    if v["checks"]["stderr"]:
        print(n, "stderr:", v["checks"]["stderr"])
with open(os.path.join(BASE, "mut2_result.json"), "w", encoding="utf-8", newline="\n") as fh:
    fh.write(json.dumps(res, ensure_ascii=False, indent=1))
