"""候选「空洞/堆砌」指标的标定工具。

目的：在把任何一条新指标写进 lib/ruleset.js 之前，先量出它在几套真人语料上的分布，
确保阈值卡在「真人最大值」与「目标文章值」之间，而不是凭感觉定。

用法：
  python tests/calibrate_structure.py            # 全量输出
  python tests/calibrate_structure.py --json out.json
"""
import argparse
import glob
import json
import os
import re
import statistics
import sys

KB = r"D:\GitRepos\知识库.git"
PRE2022 = r"D:\GitRepos\Others\tmp\corpus_pre2022\*.txt"
AI_CORPUS = r"D:\GitRepos\dsh-deai-style.git\tests\corpus\ai_zh.json"
TARGET = r"C:\Users\zhenz\Desktop\Desktop-仅校对稿\【战争与化学 No.19 草木灰】军营里烧出来的万能碱-仅校对稿.md"

SENT_RE = re.compile(r"[^。！？!?\n]+[。！？!?]")

RHETORIC = re.compile(
    r"(?:简直|堪称|无疑|活脱脱|好比|犹如|仿佛|就像|似的|如同|一模一样|"
    r"缴械|封神|狼狈|暴脾气|脾气|性格|硬通货|下岗|打工|工伤|绝了|偏偏|硬是|"
    r"居然|竟然|一不留神|一不小心|当场|瞬间|一下子|偷偷|转身|硬拆|抱成团|相依为命|"
    r"稀稀拉拉|舒舒服服|要多.{0,6}有多|翻了个面|等于|不过是|说到底|说白了|无非)"
)
PERSONIFY = re.compile(
    r"(?:缴械|下岗|打工|上班|下班|加班|辞职|退休|认亲|谈恋爱|吵架|翻脸|脾气|性格|"
    r"伺候|干活|跑路|相依为命|抱成团|认柴)"
)
VAGUE_AGENT = re.compile(r"(?:古人|人们|大家|有人|老辈人|行家|老师傅|工匠|世人|众人|常人)")
FACT = re.compile(
    r"(?:\d+(?:\.\d+)?%?|\d+年|《[^》]{2,20}》|pH\s?\d|[一二三四五六七八九十]{1,3}世纪|"
    r"第[一二三四五六七八九十]步|据[^，。]{2,10}|研究|实验|论文|数据|报告|记载|写到|写成)"
)
TRANSITION_OPENER = re.compile(
    r"^(?:先|首先|接下来|下面|再者|另外|此外|最后|顺带|顺便|值得一提|说到|回到|至于|"
    r"也就是说|换句话说|其实|当然|不过|所以|因此|这是|这就是|第[一二三四五六七八九十]步|"
    r"再说|还有|再说回|别忘了|问题是)"
)
JUDGE_SUFFIX = re.compile(
    r"(?:罢了|而已|就是这么|这就是|才是|才算|才叫|的关系|的本质|的代价|的后果|的底线|"
    r"的根本原因|再合适不过|都难|翻了个面|半座|一个时代|的事|翻了个|过了|都)"
)
CONTRAST_RESTATE = re.compile(
    r"不(?:懂|知道|会|明白|学过|清楚)[^。！？\n]{2,20}[，,；]?\s*(?:但|却|可|反而)"
)


def split_sents(text):
    return [s.strip() for s in SENT_RE.findall(text) if len(s.strip()) >= 2]


def split_paras(text):
    parts = re.split(r"\n\s*\n", text) if re.search(r"\n\s*\n", text) else text.split("\n")
    return [p.replace("\n", "").strip() for p in parts if p.strip()]


def analyze(text):
    chars = len(re.sub(r"\s", "", text))
    k = max(chars, 300) / 1000.0
    sents = split_sents(text)
    paras = split_paras(text)
    # 只统计「成段」的段落：太短的段（一行一句）没有修辞/收束的空间
    full = [p for p in paras if len(p) >= 80]
    n = max(len(full), 1)

    rhet_para = sum(1 for p in full if RHETORIC.search(p))
    final_maxim = 0
    opener_trans = 0
    for p in full:
        ps = split_sents(p)
        if not ps:
            continue
        if TRANSITION_OPENER.search(ps[0]):
            opener_trans += 1
        tail = ps[-1]
        if RHETORIC.search(tail) or JUDGE_SUFFIX.search(tail) or len(tail) <= 14:
            final_maxim += 1

    fact_sents = sum(1 for s in sents if FACT.search(s))
    rhet_sents = sum(1 for s in sents if RHETORIC.search(s))

    return {
        "chars": chars,
        "paragraphs": len(paras),
        "full_paragraphs": len(full),
        "rhetoric_sentence_ratio": round(rhet_sents / max(len(sents), 1), 3),
        "fact_sentence_ratio": round(fact_sents / max(len(sents), 1), 3),
        "para_rhetoric_coverage": round(rhet_para / n, 3),
        "para_final_maxim": round(final_maxim / n, 3),
        "para_opener_transition": round(opener_trans / n, 3),
        "personify_per1000": round(len(PERSONIFY.findall(text)) / k, 2),
        "vague_agent_per1000": round(len(VAGUE_AGENT.findall(text)) / k, 2),
        "contrast_restate": len(CONTRAST_RESTATE.findall(text)),
    }


def load_pattern(patterns, min_chars=300, limit=None, step=1):
    out = []
    seen = 0
    for pat in patterns:
        for p in sorted(glob.glob(pat, recursive=True)):
            if not os.path.isfile(p):
                continue
            try:
                txt = open(p, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            if len(re.sub(r"\s", "", txt)) < min_chars:
                continue
            seen += 1
            if (seen - 1) % step:
                continue
            out.append((os.path.basename(p)[:40], analyze(txt)))
            if limit and len(out) >= limit:
                return out
    return out


def load_ai_corpus():
    out = []
    data = json.load(open(AI_CORPUS, encoding="utf-8"))
    for i, item in enumerate(data, 1):
        txt = item["text"] if isinstance(item, dict) else item
        out.append((f"ai_zh#{i}", analyze(txt)))
    return out


def report(name, rows):
    if not rows:
        print(f"\n## {name}: 无样本")
        return
    keys = [
        "rhetoric_sentence_ratio",
        "para_rhetoric_coverage",
        "para_final_maxim",
        "para_opener_transition",
        "personify_per1000",
        "vague_agent_per1000",
        "contrast_restate",
        "fact_sentence_ratio",
    ]
    print(f"\n## {name}（{len(rows)} 篇）")
    print(f"{'指标':<26}{'p50':>7}{'p90':>7}{'max':>7}   超阈值篇数")
    for key in keys:
        vals = sorted(r[key] for _, r in rows)
        p50 = statistics.median(vals)
        p90 = vals[int(len(vals) * 0.9) - 1] if len(vals) >= 2 else vals[-1]
        print(f"{key:<26}{p50:>7}{p90:>7}{max(vals):>7}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default="")
    a = ap.parse_args()

    target = analyze(open(TARGET, encoding="utf-8").read())

    groups = {
        "2022前真人": load_pattern([PRE2022]),
        "知识库·高老师": load_pattern([os.path.join(KB, "有何高见", "**", "*仅校对稿.md")], limit=40, step=7),
        "知识库·新闻": load_pattern([os.path.join(KB, "新闻", "**", "*仅校对稿.md")], limit=30, step=5),
        "知识库·其他作者": load_pattern(
            [os.path.join(KB, "王帅真", "**", "*仅校对稿.md"),
             os.path.join(KB, "尖峰苏打", "**", "*仅校对稿.md"),
             os.path.join(KB, "大叔的车库书场", "**", "*仅校对稿.md")],
            limit=30, step=5),
        "AI 语料库": load_ai_corpus(),
    }

    print("=" * 96)
    print("目标文章")
    print("=" * 96)
    for k, v in target.items():
        print(f"  {k:<26}{v}")

    for name, rows in groups.items():
        report(name, rows)

    if a.json:
        payload = {"target": target,
                   "groups": {k: [{"name": n, **r} for n, r in v] for k, v in groups.items()}}
        with open(a.json, "w", encoding="utf-8", newline="\n") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"\n已写 {a.json}", file=sys.stderr)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    main()
