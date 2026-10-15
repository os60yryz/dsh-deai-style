# -*- coding: utf-8 -*-
"""第三轮审计：变异测试。把 lib/index.js/tests 复制到 tmp/bug3/mut/<name>，
注入 12 组变异，各跑 node tests/checks.mjs 与 node tests/corpus.mjs，
统计每组变异杀死多少条断言 / 存活多少条。只写 tmp/bug3/，不动仓库。
"""
import json
import os
import re
import shutil
import subprocess

ROOT = r"D:\GitRepos\dsh-deai-style.git"
BASE = os.path.join(ROOT, "tmp", "bug3")
PLUG = os.path.join(BASE, "mut")

LINT = "lib/lint.js"
RULE = "lib/ruleset.js"

MUTS = {
    "mut00_orig": {},
    # M1 formatNudge 阈值 5 -> 0
    "mut01_nudge_thr0": {LINT: [("ruleWeight === 0 && formatWeight >= 5", "ruleWeight === 0 && formatWeight >= 0")]},
    # M2 formatNudge 封顶 25 -> 100
    "mut02_nudge_cap100": {LINT: [("Math.min(25, Math.round(formatWeight * 2))", "Math.min(100, Math.round(formatWeight * 2))")]},
    # M3 metricBonus 去掉 ruleWeight===0 门
    "mut03_metric_no_gate": {LINT: [("const metricBonus = ruleWeight === 0 ? 0 : Math.min(4, metricWeight);", "const metricBonus = Math.min(4, metricWeight);")]},
    # M4 mergeSpans 不合并
    "mut04_nomerge": {LINT: [("const merged = mergeSpans(spans);", "const merged = spans;")]},
    # M5 scope 用去空白字数而非 text.length
    "mut05_scope_chars": {LINT: [
        ("const limit = Math.max(60, Math.min(200, text.length * 0.2));", "const limit = Math.max(60, Math.min(200, text.replace(/\\s/g, \"\").length * 0.2));"),
        ("const from = text.length * 0.65;", "const from = text.replace(/\\s/g, \"\").length * 0.65;"),
    ]},
    # M6 dedupe 失效
    "mut06_nodedupe": {LINT: [("if (rule.dedupe) {", "if (false) {")]},
    # M7 service-close 回退旧正则（删掉裸「有」）
    "mut07_service_old": {RULE: [("希望对(你|您)(有所|有)?帮助", "希望对(你|您)(有所)?帮助")]},
    # M8 analyzed 恒 true
    "mut08_analyzed_true": {LINT: [("analyzed: m.chars >= 10,", "analyzed: true,")]},
    # M9 k 去掉长度项
    "mut09_k_const": {LINT: [("const k = 4.5 + m.chars / 100;", "const k = 4.5;")]},
    # M10 关掉零宽字符归一化
    "mut10_no_zerowidth": {LINT: [('String(text ?? "").replace(ZERO_WIDTH_RE, "")', 'String(text ?? "")')]},
    # M11 uplift-close 恢复裸「希望(能|可以|你)」
    "mut11_uplift_back": {RULE: [("共(创|赴)美好)", "共(创|赴)美好|希望(能|可以|你))")]},
    # M12 renderReport 分数不夹取
    "mut12_noclamp": {LINT: [("const score = Math.max(0, Math.min(100, Math.round(rawScore)));", "const score = Math.round(rawScore);")]},
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
    link = os.path.join(dst, "node_modules", "@deepseek-ai")
    subprocess.run(["cmd", "/c", "mklink", "/J", link, os.path.join(ROOT, "node_modules", "@deepseek-ai")],
                   capture_output=True, text=True)
    for rel, subs in patches.items():
        p = os.path.join(dst, *rel.split("/"))
        src = open(p, encoding="utf-8").read()
        for old, new in subs:
            assert src.count(old) == 1, "%s anchor not unique in %s: %r" % (name, rel, old[:50])
            src = src.replace(old, new)
        open(p, "w", encoding="utf-8", newline="\n").write(src)
    return dst


def run(dst, script):
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    p = subprocess.run(["node", script], cwd=dst, capture_output=True, env=env)
    out = p.stdout.decode("utf-8", "replace")
    passed = [l[5:].strip() for l in out.splitlines() if l.startswith("PASS ")]
    failed = [l[5:].strip() for l in out.splitlines() if l.startswith("FAIL ")]
    m = re.search(r"(TOTAL pass=(\d+) fail=(\d+)|CORPUS pass=(\d+) fail=(\d+) total=(\d+))", out)
    return {"rc": p.returncode, "pass": len(passed), "fail": len(failed),
            "summary": m.group(0) if m else None, "failed": failed, "stderr": p.stderr.decode("utf-8", "replace")[:200]}


res = {}
for name, patches in MUTS.items():
    dst = build(name, patches)
    c = run(dst, "tests/checks.mjs")
    q = run(dst, "tests/corpus.mjs")
    res[name] = {"checks": c, "corpus": q}
    print("%-22s checks pass=%3d fail=%2d | corpus pass=%2d fail=%2d" % (name, c["pass"], c["fail"], q["pass"], q["fail"]))
    if c["stderr"]:
        print("   stderr:", c["stderr"][:200])

base_pass = set(res["mut00_orig"]["checks"]["failed"])  # should be empty
table = []
for name, v in res.items():
    if name == "mut00_orig":
        continue
    table.append({
        "mutation": name,
        "checks_killed": v["checks"]["fail"],
        "checks_alive": v["checks"]["pass"],
        "corpus_killed": v["corpus"]["fail"],
        "corpus_alive": v["corpus"]["pass"],
        "killed_labels": v["checks"]["failed"],
        "corpus_killed_labels": v["corpus"]["failed"],
    })
out = {"baseline": {"checks": res["mut00_orig"]["checks"]["summary"], "corpus": res["mut00_orig"]["corpus"]["summary"]},
       "table": table}
with open(os.path.join(BASE, "mut_result.json"), "w", encoding="utf-8", newline="\n") as fh:
    fh.write(json.dumps({**out, "raw": res}, ensure_ascii=False, indent=1))
print("\n===== 变异矩阵 =====")
for t in table:
    print("%-22s checks killed=%2d alive=%3d | corpus killed=%d" % (t["mutation"], t["checks_killed"], t["checks_alive"], t["corpus_killed"]))
    for l in t["killed_labels"]:
        print("      - " + l)
