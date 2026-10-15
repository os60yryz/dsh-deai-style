#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""dsh-deai-style 功能开关回归（AGENTS.md §12）

跑法（任意 cwd）：
    python tests/regression_deai_style.py [--debug]

覆盖：
  A 文件完整性   —— 交付所需文件齐备
  B 编码纪律     —— 无 BOM、LF 换行、UTF-8 可解码（§2）
  C 语法可解析   —— node --check 每个 .js；ESM 入口可 import
  D 包清单结构   —— package.json 字段、cordis.patch.yml 顶层为数组且含 deai-style 行
  E 单元检查     —— node tests/checks.mjs 全 PASS
  F 开关两套断言 —— 开：注册 section+tool；关（enabled:false / level:"off"）：零注册
  G 效果区分度   —— AI 样例高分、人写样例低分、区分度达标

退出码 0 = 全部 PASS；1 = 有 FAIL（明细按 [PASS]/[FAIL] 打印）。
"""
import argparse
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # plugins/dsh-deai-style

REQUIRED = [
    "package.json",
    "index.js",
    "cordis.patch.yml",
    "README.md",
    "lib/ruleset.js",
    "lib/lint.js",
    "lib/prompt.js",
    "lib/plan.js",
    "tests/checks.mjs",
    "tests/fixtures/ai_style_sample.txt",
    "tests/fixtures/human_style_sample.txt",
    "tests/fixtures/edge_code_only.txt",
    "tests/fixtures/edge_empty.txt",
]
TEXT_EXT = {".json", ".js", ".mjs", ".yml", ".yaml", ".md", ".txt", ".ps1", ".py"}

RESULTS = []
DEBUG = False


def record(name, ok, detail=""):
    RESULTS.append((bool(ok), name, detail))
    if DEBUG or not ok:
        print("[%s] %s%s" % ("PASS" if ok else "FAIL", name, (" :: " + str(detail)) if detail else ""))


def run_node(args, timeout=120):
    """跑 node，返回 (returncode, stdout, stderr)。"""
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    proc = subprocess.run(
        ["node"] + args,
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        timeout=timeout,
    )
    out = proc.stdout.decode("utf-8", "replace")
    err = proc.stderr.decode("utf-8", "replace")
    return proc.returncode, out, err


def node_json(js, timeout=120):
    """跑一段 node 表达式，要求它打印单行 JSON；返回解析结果或 None。"""
    rc, out, err = run_node(["-e", js], timeout=timeout)
    if rc != 0:
        return None, "node 退出码 %d: %s" % (rc, err.strip()[:300])
    line = ""
    for ln in out.strip().splitlines():
        if ln.strip().startswith("{") or ln.strip().startswith("["):
            line = ln.strip()
    if not line:
        return None, "node 无 JSON 输出: %s" % out.strip()[:200]
    try:
        return json.loads(line), ""
    except Exception as exc:  # noqa: BLE001
        return None, "JSON 解析失败 %s: %s" % (exc, line[:200])


# ---------------------------------------------------------------- A 文件完整性
def check_files():
    missing = [p for p in REQUIRED if not os.path.isfile(os.path.join(ROOT, p.replace("/", os.sep)))]
    record("A1 必需文件齐备（%d 个）" % len(REQUIRED), not missing, "缺: %s" % missing)


# ---------------------------------------------------------------- B 编码纪律
def check_encoding():
    bad_bom, bad_eol, bad_utf8 = [], [], []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "__pycache__")]
        for fn in filenames:
            if os.path.splitext(fn)[1].lower() not in TEXT_EXT:
                continue
            path = os.path.join(dirpath, fn)
            rel = os.path.relpath(path, ROOT)
            with open(path, "rb") as fh:
                raw = fh.read()
            if raw.startswith(b"\xef\xbb\xbf"):
                bad_bom.append(rel)
            if b"\r\n" in raw:
                bad_eol.append(rel)
            try:
                raw.decode("utf-8")
            except UnicodeDecodeError:
                bad_utf8.append(rel)
    record("B1 无 UTF-8 BOM", not bad_bom, bad_bom)
    record("B2 换行为 LF", not bad_eol, bad_eol)
    record("B3 UTF-8 可解码", not bad_utf8, bad_utf8)


# ---------------------------------------------------------------- C 语法可解析
def check_syntax():
    js_files = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "__pycache__")]
        for fn in filenames:
            if fn.endswith(".js") or fn.endswith(".mjs"):
                js_files.append(os.path.relpath(os.path.join(dirpath, fn), ROOT).replace(os.sep, "/"))
    bad = []
    for rel in sorted(js_files):
        rc, _out, err = run_node(["--check", rel])
        if rc != 0:
            bad.append("%s: %s" % (rel, err.strip().splitlines()[:1]))
    record("C1 node --check 通过（%d 个文件）" % len(js_files), not bad, bad)

    js = (
        'import("./index.js").then((m)=>{'
        'console.log(JSON.stringify({keys:Object.keys(m).sort(),'
        'name:m.name,inject:m.inject,hasApply:typeof m.apply==="function",hasConfig:!!m.Config}));'
        '}).catch((e)=>{console.error(e&&e.message);process.exit(1);});'
    )
    data, err = node_json(js)
    ok = bool(data) and data.get("hasApply") and data.get("hasConfig") and data.get("name") == "deai-style"
    record("C2 ESM 入口可 import 且导出齐备", ok, err or data)


# ---------------------------------------------------------------- D 包清单结构
def check_manifest():
    pkg = json.load(open(os.path.join(ROOT, "package.json"), encoding="utf-8"))
    ok_main = pkg.get("main") == "index.js"
    ok_exports = pkg.get("exports", {}).get(".") == "./index.js" and "./package.json" in pkg.get("exports", {})
    ok_types = pkg.get("type") == "module"
    ok_patch = pkg.get("dsh", {}).get("bundle", {}).get("patch") == "./cordis.patch.yml"
    ok_files = isinstance(pkg.get("files"), list) and "index.js" in pkg["files"] and "lib" in pkg["files"]
    record("D1 package.json main/index.js", ok_main, pkg.get("main"))
    record("D2 package.json exports 含 . 与 ./package.json", ok_exports, pkg.get("exports"))
    record("D3 package.json type=module", ok_types, pkg.get("type"))
    record("D4 package.json dsh.bundle.patch 指向 cordis.patch.yml", ok_patch)
    record("D5 package.json files 白名单存在", ok_files, pkg.get("files"))
    record("D6 版本号为 x.y.z", bool(re.match(r"^\d+\.\d+\.\d+$", str(pkg.get("version")))), pkg.get("version"))

    raw = open(os.path.join(ROOT, "cordis.patch.yml"), encoding="utf-8").read()
    code_lines = [ln for ln in raw.splitlines() if ln.strip() and not ln.strip().startswith("#")]
    try:
        import yaml  # type: ignore

        parsed = yaml.safe_load(raw)
        top_is_list = isinstance(parsed, list) and len(parsed) >= 1 and isinstance(parsed[0], dict) and "insert" in parsed[0]
        detail = "yaml.safe_load -> %s" % type(parsed).__name__
    except Exception:  # PyYAML 不可用时退回文本判定
        top_is_list = bool(code_lines) and code_lines[0].startswith("-")
        detail = "文本判定（PyYAML 不可用）"
    has_insert = "insert:" in raw
    has_row = re.search(r"id:\s*deai-style", raw) is not None
    has_name = re.search(r"name:\s*dsh-deai-style", raw) is not None
    record("D7 cordis.patch.yml 顶层是 YAML 数组且含 insert", top_is_list and has_insert, detail)
    record("D8 patch 行 id=deai-style / name=dsh-deai-style", has_row and has_name)
    record("D9 patch 顶层不是空数组（[] 会静默禁用）", raw.strip() not in ("[]", ""))


# ---------------------------------------------------------------- E 单元检查
def check_unit():
    rc, out, err = run_node(["tests/checks.mjs"])
    ok_exit = rc == 0
    m = re.search(r"TOTAL pass=(\d+) fail=(\d+)", out)
    ok_total = bool(m) and int(m.group(2)) == 0
    record("E1 node tests/checks.mjs 退出码 0", ok_exit, err.strip()[:300])
    record("E2 单元检查 fail=0（%s）" % (m.group(0) if m else "无 TOTAL 行"), ok_total)
    if m:
        record("E3 单元检查用例数 >= 60（%s）" % m.group(1), int(m.group(1)) >= 60)


# ---------------------------------------------------------------- F 开关两套断言
PLAN_JS = (
    'import("./lib/plan.js").then((p)=>{'
    "const orders={personaPrefix:0,personaSuffix:10200};"
    "const on=p.planRegistrations({},orders);"
    "const off1=p.planRegistrations({enabled:false},orders);"
    "const off2=p.planRegistrations({level:'off'},orders);"
    "const soft=p.planRegistrations({level:'soft',position:'top',injectLintTool:false},orders);"
    "console.log(JSON.stringify({"
    "onSection:on&&on.section.name,onOrder:on&&on.section.order,onTextLen:on&&on.section.text.length,onTool:on&&on.tool,"
    "off1:off1,off2:off2,"
    "softOrder:soft&&soft.section.order,softTool:soft&&soft.tool,softHasToolName:soft?soft.section.text.includes(p.TOOL_NAME):null"
    "}));}).catch((e)=>{console.error(e&&e.message);process.exit(1);});"
)


def check_switch():
    data, err = node_json(PLAN_JS)
    if not data:
        record("F0 注册计划可求值", False, err)
        return
    record("F1 开：section 名 deai:style", data.get("onSection") == "deai:style", data.get("onSection"))
    record("F2 开：section order = 10201（挂在 persona suffix 之后）", data.get("onOrder") == 10201, data.get("onOrder"))
    record("F3 开：section 文本非空", (data.get("onTextLen") or 0) > 200, data.get("onTextLen"))
    record("F4 开：注册 lint 工具", data.get("onTool") is True, data.get("onTool"))
    record("F5 关（enabled:false）：零注册", data.get("off1") is None, data.get("off1"))
    record("F6 关（level:'off'）：零注册", data.get("off2") is None, data.get("off2"))
    record("F7 soft+top：order = 1（挂在 persona prefix 之后）", data.get("softOrder") == 1, data.get("softOrder"))
    record("F8 soft+top：不注册工具", data.get("softTool") is False, data.get("softTool"))
    record("F9 soft+top：文本不含工具名（关=旧行为路径）", data.get("softHasToolName") is False, data.get("softHasToolName"))


# ---------------------------------------------------------------- G 效果区分度
LINT_JS = (
    'Promise.all([import("./lib/lint.js"),import("node:fs")]).then(([L,fs])=>{'
    "const g=(f)=>fs.readFileSync('tests/fixtures/'+f,'utf8');"
    "const r=(t)=>L.lint(t);"
    "const ai=r(g('ai_style_sample.txt')),hu=r(g('human_style_sample.txt')),"
    "co=r(g('edge_code_only.txt')),em=r(g('edge_empty.txt'));"
    "console.log(JSON.stringify({ai:ai.score,aiBand:ai.band,human:hu.score,humanHits:hu.hits.length,"
    "code:co.score,empty:em.score,emptyHits:em.hits.length,"
    "aiHits:ai.hits.map((h)=>h.id)}));}).catch((e)=>{console.error(e&&e.message);process.exit(1);});"
)


def check_effect():
    data, err = node_json(LINT_JS)
    if not data:
        record("G0 检测器可求值", False, err)
        return
    ai = data.get("ai")
    hu = data.get("human")
    record("G1 AI 样例判为 AI 腔（>=60，实际 %s）" % ai, (ai or 0) >= 60, data.get("aiBand"))
    record("G2 人写样例判为干净（<=15，实际 %s）" % hu, (hu or 0) <= 15)
    record("G3 区分度 >= 45（实际 %s）" % ((ai or 0) - (hu or 0)), (ai or 0) - (hu or 0) >= 45)
    record("G4 空文本 0 分 0 命中", data.get("empty") == 0 and data.get("emptyHits") == 0)
    record("G5 纯代码样例 <= 10 分（实际 %s）" % data.get("code"), (data.get("code") or 0) <= 10)
    for rid in ("not-x-but-y", "bold-label-line", "service-close"):
        record("G6 AI 样例命中 %s" % rid, rid in (data.get("aiHits") or []))


def main():
    global DEBUG
    ap = argparse.ArgumentParser()
    ap.add_argument("--debug", action="store_true", help="打印全部断言明细")
    args = ap.parse_args()
    DEBUG = args.debug
    print("== dsh-deai-style 回归 @ %s ==" % ROOT)
    check_files()
    check_encoding()
    check_syntax()
    check_manifest()
    check_unit()
    check_switch()
    check_effect()
    total = len(RESULTS)
    failed = [r for r in RESULTS if not r[0]]
    print("-" * 60)
    print("TOTAL %d assertions, %d PASS, %d FAIL" % (total, total - len(failed), len(failed)))
    if failed:
        print("FAILED:")
        for _ok, nm, dt in failed:
            print("  - %s%s" % (nm, (" :: " + str(dt)) if dt else ""))
    print("RESULT=%s" % ("PASS" if not failed else "FAIL"))
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
