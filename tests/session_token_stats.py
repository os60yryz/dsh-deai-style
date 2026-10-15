#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""插件到底让请求贵了多少：拿本机真实会话记账。

两个口径：
  1. 每次请求的输入分布（未命中缓存 / 命中缓存），算固定开销占比；
  2. deai_scan 真实被调用了多少次、每次往返多大。
"""
import json
import os
import statistics
import sys

import zstandard as zstd

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\zhenz\.dsh\sessions"
FIXED = 932          # 实测：系统提示段 542 + 工具 schema 390
CACHE_DISCOUNT = 0.1  # DeepSeek 缓存命中按约 0.1 倍计价


def sessions():
    out = []
    for slug in os.listdir(ROOT):
        d = os.path.join(ROOT, slug)
        if not os.path.isdir(d):
            continue
        for sid in os.listdir(d):
            p = os.path.join(d, sid, "session.v4.jsonl.zstd")
            if os.path.isfile(p):
                out.append((os.path.getmtime(p), p))
    return [p for _, p in sorted(out)]


def read(p):
    dctx = zstd.ZstdDecompressor()
    with open(p, "rb") as fh, dctx.stream_reader(fh) as r:
        return r.read().decode("utf-8", "replace")


def main():
    req = []
    calls = []
    results = []
    scanned = 0
    for p in sessions()[-12:]:
        try:
            raw = read(p)
        except Exception:
            continue
        scanned += 1
        pending = None
        for line in raw.split("\n"):
            if not line.strip():
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            t = o.get("type")
            d = o.get("data") or {}
            if t == "assistant/message" and d.get("usage"):
                req.append(d["usage"])
            elif t == "tool/call":
                name = d.get("name") or d.get("toolName") or (d.get("call") or {}).get("name")
                if name == "deai_scan":
                    args = d.get("args") or d.get("arguments") or (d.get("call") or {}).get("arguments")
                    calls.append(len(json.dumps(args, ensure_ascii=False)))
                    pending = True
            elif t == "tool/result" and pending:
                txt = json.dumps(d.get("content") or d.get("result") or "", ensure_ascii=False)
                results.append(len(txt))
                pending = None

    print(f"扫了 {scanned} 个会话\n")
    if req:
        unc = [r["inputTokens"] for r in req]
        cac = [r.get("cacheReadTokens", 0) for r in req]
        eff = [u + CACHE_DISCOUNT * c for u, c in zip(unc, cac)]
        su, sc = sum(unc), sum(cac)
        print(f"=== 每次请求输入（{len(req)} 次） ===")
        print(f"未命中缓存：中位 {int(statistics.median(unc))}，均值 {int(statistics.mean(unc))}")
        print(f"命中缓存  ：中位 {int(statistics.median(cac))}，均值 {int(statistics.mean(cac))}")
        print(f"有效输入量（缓存按 0.1 折算）：中位 {int(statistics.median(eff))}，合计 {int(sum(eff)):,}")
        print(f"全量输入合计：未命中 {su:,} + 命中 {sc:,}")
        print()
        print(f"=== 插件固定开销 {FIXED} token/请求 ===")
        print(f"占总输入合计（{len(req)} 次 × {FIXED} = {FIXED * len(req):,}）")
        print(f"  按未命中全价算：{FIXED * len(req) / su * 100:.1f}% 的未命中输入")
        print(f"  按缓存 0.1 折算：{FIXED * len(req) * CACHE_DISCOUNT:,.0f} 等价 token，"
              f"占有效输入 {FIXED * len(req) * CACHE_DISCOUNT / sum(eff) * 100:.2f}%")
        print(f"  摊到每次请求：{FIXED * CACHE_DISCOUNT:.0f} 等价 token")
    print()
    print(f"=== deai_scan 真实使用 ===")
    print(f"被调用 {len(calls)} 次" + (f"，入参长度 中位 {int(statistics.median(calls))} 字符" if calls else ""))
    if results:
        print(f"返回报告长度 中位 {int(statistics.median(results))} 字符，合计 {sum(results):,} 字符")
    if calls and req:
        print(f"相对 {len(req)} 次模型请求，调用率 {len(calls) / len(req) * 100:.1f}%")


if __name__ == "__main__":
    main()
