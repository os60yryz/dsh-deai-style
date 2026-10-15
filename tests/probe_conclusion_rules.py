#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""候选规则的误报体检：拿我的输出和 2022 年前真人中文各跑一遍，看命中率差多少。

规则要进检测器，先得在这两堆文本上分出高低；只在高的一侧命中才值得加。
"""
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CANDIDATES = {
    "opener-verdict": re.compile(
        r"(?:^|[。！？\n])\s*(?:真正|说到底|归根结底|先说结论|一句话|关键(?:是|在于|区分|问题)"
        r"|核心(?:是|在于|问题|结论)|问题(?:就)?在于|本质上)"
    ),
    "reverse-inversion": re.compile(r"的是[^。！？\n]{1,26}[，,][^。！？\n]{0,4}不是"),
    "problem-lies-in": re.compile(r"问题(?:就)?在于"),
    "conclusion-first": re.compile(r"(?:^|[。！？\n])\s*(?:先说结论|直接说结论|结论|一句话)"),
}


def measure_mine(path):
    data = json.load(open(path, encoding="utf-8"))
    rows = data.get("rows", data)
    return [(f"turn{r['turn']}/step{r['step']}", r["text"]) for r in rows]


def measure_human(dirpath):
    out = []
    for name in sorted(os.listdir(dirpath)):
        if name.endswith(".txt"):
            with open(os.path.join(dirpath, name), encoding="utf-8", errors="replace") as f:
                t = f.read()
            if len(t) >= 300:
                out.append((name[:-4], t))
    return out


def main():
    mine = measure_mine(sys.argv[1])
    human = measure_human(sys.argv[2])
    mc = sum(len(t) for _, t in mine)
    hc = sum(len(t) for _, t in human)

    print(f"我的输出 {len(mine)} 篇 / {mc} 字    真人 {len(human)} 篇 / {hc} 字\n")
    for name, rx in CANDIDATES.items():
        m_hits = [(n, m.group(0)) for n, t in mine for m in rx.finditer(t)]
        h_hits = [(n, m.group(0)) for n, t in human for m in rx.finditer(t)]
        mr = len(m_hits) / (mc / 1000.0)
        hr = len(h_hits) / (hc / 1000.0)
        ratio = (mr / hr) if hr else float("inf")
        print(f"[{name}]  我 {mr:.2f}/千字（{len(m_hits)} 次）   真人 {hr:.2f}/千字（{len(h_hits)} 次）   倍数 {ratio:.2f}x")
        if m_hits:
            print("   我的命中样例：")
            for n, s in m_hits[:4]:
                print(f"     {n:<16} {s.strip()[:40]}")
        if h_hits:
            print("   真人命中样例（误报风险）：")
            for n, s in h_hits[:4]:
                print(f"     {n:<16} {s.strip()[:40]}")
        print()


if __name__ == "__main__":
    main()
