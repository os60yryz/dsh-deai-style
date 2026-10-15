#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""量「下结论的密度」：把对偶反转句和判断词标记按千字率算出来，跟 2022 年前的真人中文比。

用法：
  python scripts/measure_conclusion_density.py <我的语料.json> <真人语料目录>

我的语料取自 tmp/my_messages.json（rows[].text），真人语料取 tmp/corpus_pre2022/*.txt。
"""
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# 对偶反转：「不是 X，（而）是 Y」与「……是 X，不是 Y」
DUAL = re.compile(r"(不是|并非)[^。！？；\n]{1,30}[，,]\s*(?:而)?是[^。！？；\n]{1,30}")
DUAL_REV = re.compile(r"[^。！？；\n]{2,24}[，,]\s*不是[^。！？；\n]{1,24}")
# 判断词：段落里出现这些，多半是在下结论
VERDICT = re.compile(
    r"(真正|本质上|关键在于|核心在于|核心是|根本原因|问题在于|说到底|归根结底"
    r"|结论是|这说明|这意味着|也就是说|恰恰|正是因为|正是因为|其实|无非|只能说明)"
)
# 句首断言：句子一开头就是判断，人类口语里少见
OPENER = re.compile(r"(?:^|[。！？\n])\s*(真正|关键|本质|问题|核心|结论|重点|答案|原因)")
# 收尾陈词：结尾段落的总结口吻
CLOSER = re.compile(r"(总之|综上|小结|一句话|总结一下|说到底|最后还是)")


def sentences(text):
    parts = [s for s in re.split(r"[。！？\n]+", text) if s.strip()]
    return parts


def measure(text):
    chars = len(text)
    sents = sentences(text)
    dual = len(DUAL.findall(text)) + len(DUAL_REV.findall(text))
    verdict = len(VERDICT.findall(text))
    verdict_sents = sum(1 for s in sents if VERDICT.search(s))
    opener = len(OPENER.findall(text))
    closer = len(CLOSER.findall(text))
    k = max(chars, 1) / 1000.0
    return {
        "chars": chars,
        "sents": len(sents),
        "dual": dual,
        "dual_per_1k": dual / k,
        "verdict": verdict,
        "verdict_per_1k": verdict / k,
        "verdict_sent_share": (verdict_sents / len(sents)) if sents else 0.0,
        "opener": opener,
        "opener_per_1k": opener / k,
        "closer": closer,
    }


def load_mine(path):
    data = json.load(open(path, encoding="utf-8"))
    rows = data.get("rows", data)
    return [(f"turn{r['turn']}/step{r['step']}", r["text"]) for r in rows]


def load_human(dirpath):
    out = []
    for name in sorted(os.listdir(dirpath)):
        if not name.endswith(".txt"):
            continue
        p = os.path.join(dirpath, name)
        with open(p, encoding="utf-8", errors="replace") as f:
            t = f.read()
        if len(t) >= 300:
            out.append((name[:-4], t))
    return out


def summarize(label, items):
    ms = [measure(t) for _, t in items]
    if not ms:
        print(f"{label}: 无样本")
        return None
    total_chars = sum(m["chars"] for m in ms)
    total_sents = sum(m["sents"] for m in ms)
    agg = {
        "n": len(ms),
        "chars": total_chars,
        "dual_per_1k": sum(m["dual"] for m in ms) / (total_chars / 1000.0),
        "verdict_per_1k": sum(m["verdict"] for m in ms) / (total_chars / 1000.0),
        "opener_per_1k": sum(m["opener"] for m in ms) / (total_chars / 1000.0),
        "verdict_sent_share": sum(1 for m in ms for _ in [0] if False) if False else None,
        "closer": sum(m["closer"] for m in ms),
    }
    # 句级占有率的正确算法：总「带判断词的句子数」/ 总句数
    vs = 0
    for _, t in items:
        for s in sentences(t):
            if VERDICT.search(s):
                vs += 1
    agg["verdict_sent_share"] = vs / total_sents if total_sents else 0.0
    print(f"\n=== {label}（{agg['n']} 篇 / {total_chars} 字） ===")
    print(f"  对偶反转    {agg['dual_per_1k']:.2f} 次/千字")
    print(f"  判断词      {agg['verdict_per_1k']:.2f} 次/千字")
    print(f"  句首断言    {agg['opener_per_1k']:.2f} 次/千字")
    print(f"  带判断的句子占全部句子  {agg['verdict_sent_share'] * 100:.1f}%")
    print(f"  收尾陈词    {agg['closer']} 次")
    return agg


def main():
    mine = load_mine(sys.argv[1])
    human = load_human(sys.argv[2])
    a = summarize("我的输出", mine)
    b = summarize("2022 年前真人中文", human)

    print("\n=== 最频繁下结论的我的文本 Top 8 ===")
    scored = sorted(((measure(t)["verdict_per_1k"], name, t) for name, t in mine), reverse=True)
    for rate, name, t in scored[:8]:
        m = measure(t)
        print(f"  {name:<16} {rate:6.2f} 次/千字  句 {m['sents']:>3}  对偶 {m['dual']}  {t[:34]}…")

    if a and b:
        print("\n=== 对比 ===")
        for key, label in (
            ("dual_per_1k", "对偶反转"),
            ("verdict_per_1k", "判断词密度"),
            ("opener_per_1k", "句首断言"),
            ("verdict_sent_share", "带判断句子占比"),
        ):
            ratio = (a[key] / b[key]) if b[key] else float("inf")
            print(f"  {label:<14} 我 {a[key]:8.2f}   真人 {b[key]:8.2f}   倍数 {ratio:6.2f}x")


if __name__ == "__main__":
    main()
