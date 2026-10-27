// dsh-deai-style 规则库
// 规则来源：docs/去AI风格/AI语言范式分析.md
// 每条规则：{ id, cat, sev(1-3), re(带 g 标志的正则), hint, scope?, dedupe? }
//   sev 3 = 人类写作里几乎不出现的指纹（「这是一个非常好的问题」「希望对你有帮助」）
//   sev 2 = 明显的模板腔，密度高才算证据
//   sev 1 = 正常汉语里也常见，只在密度高时才扣分
//   scope: "opening" 只算开头 20%（时代开场套话）；"closing" 只算结尾 35%（总结/升华收尾）
//   dedupe: true = 同一个词重复出现只算一次（「数字化转型」写 3 遍不应该是 3 倍罪）；
//            术语类规则用它，避免长文靠复读同一个词刷分。
//   minHits: n = 全文命中少于 n 次就不算这条规则（低频但高辨识度的句式用它；
//            单次「我把 X 改成 Y」是正常汉语，成串出现才是口癖）。
// 评分不靠单条规则定生死，靠密度（见 lib/lint.js）。

export const CATEGORY_LABELS = {
  lex: "用词",
  syn: "句法",
  dis: "语篇语用",
  fmt: "格式",
  struct: "结构节奏",
};

// 拟人化修辞标记：把无生命的过程/物质写成有脾气、会翻脸、能相依为命的角色。
// 标定（tests/calibrate_structure.py + docs/reviews/rhetoric-calibration.md）：
//   2022 前真人文章 13 篇最高 0%；知识库真人语料 183 篇抽样最高 4.3%（多为「像…一样」的明喻）；
//   目标样本（草木灰科普）22%。差 5 倍以上，所以这一条允许单独定罪——与排版类证据不同。
// 刻意不收「打工」「下岗」「硬通货」：媒体写人形机器人「打工」、写行业「下岗潮」都是真人用法。
export const RHETORIC_MARKERS =
  /(?:缴械|相依为命|抱成一团|抱成团|勾搭|认亲|照拆不误|善茬|泼一盆冷水|封神|伺候|翻脸|暴脾气|脾气怪|性子硬)/;

export const RULES = [
  // ---------- 用词 ----------
  {
    id: "empty-grandeur",
    cat: "lex",
    sev: 2,
    re: /(赋能|助力|彰显|里程碑|新篇章|浓墨重彩|举足轻重|至关重要|不可或缺|大有裨益|意义深远|深远影响|重要一环|必经之路)/g,
    hint: "删掉夸饰词，直接说这件事做了什么、影响了谁。",
  },
  {
    id: "significance-filler",
    cat: "lex",
    sev: 2,
    re: /(标志着|见证(了|着)|开启(了)?.{0,4}(新|全新)|翻开.{0,4}新|谱(写|出)了)/g,
    hint: "「标志着/见证了/开启了」多数是空话，换成具体事实。",
  },
  {
    id: "explainer-frame",
    cat: "lex",
    sev: 2,
    re: /(核心在于|关键在于|根本(原因)?在于|本质上(就)?是|这背后的(逻辑|机制|原理)|究其原因)/g,
    hint: "「核心在于／本质上就是」是解说腔的开场；直接给结论和依据。",
  },
  {
    id: "vague-adverb",
    cat: "lex",
    sev: 2,
    re: /(极大地|显著地|充分地|深刻地|高度地|有效地|成功地|完美地|大幅地|全方位地)/g,
    hint: "去掉「极大地/显著地」，用数字或对比说明程度。",
  },
  {
    id: "transition-cliche",
    cat: "lex",
    sev: 1,
    re: /(首先[，,、]|其次[，,、]|再次[，,、]|最后[，,、]|第[一二三四五六]([，,、]|步)|其[一二三][，,、]|综上所述|综上[，,]|总而言之|总的来说|总体而言|值得一提的是|需要注意的是|值得注意的是|更重要的是|与此同时|不仅如此|另一方面|换句话说|简而言之|一言以蔽之|归根结底|由此可见|此外[，,]|不难看出|显而易见)/g,
    hint: "删掉模板连接词；语序和分段本身就能表达结构。",
  },
  {
    id: "translationese",
    cat: "lex",
    sev: 2,
    re: /(进行(了)?[^。，；\n]{0,6}(分析|研究|探讨|阐述|说明|处理)|对于[^。，；\n]{0,10}来说|基于[^。，；\n]{0,8}的基础上|起到了[^。，；\n]{0,6}的作用|具有[^。，；\n]{0,6}的(特点|特征|意义|优势))/g,
    hint: "「进行分析」→「分析」；「起到…的作用」→直接给动词。",
  },
  {
    id: "buzzword",
    cat: "lex",
    sev: 2,
    dedupe: true,
    re: /(闭环|抓手|颗粒度|生态位|数字化转型|方法论|底层逻辑|顶层设计|协同效应|降本增效|护城河|组合拳|新范式|多维度|全链路)/g,
    hint: "行业黑话换成普通说法，除非对话对象真的在用这个词。",
  },
  {
    id: "over-hedge",
    cat: "lex",
    sev: 1,
    re: /(在某种(程度|意义)上|从某种意义上(讲|说)|或多或少|很大程度上|一般来说|通常情况下|因人而异|视情况而定|取决于(具体)?情况|不能一概而论|没有(绝对|标准)答案)/g,
    hint: "不要用对冲句免责；给出你的判断，并说明条件。",
  },
  {
    id: "both-sides",
    cat: "lex",
    sev: 2,
    re: /(一方面[^。；\n]{0,40}另一方面)/g,
    hint: "「一方面…另一方面」的两面陈述常等于没表态；说清哪一面更重。",
  },
  {
    id: "abstract-noun-stack",
    cat: "lex",
    sev: 1,
    dedupe: true,
    re: /(维度|层面|视角|路径|体系|逻辑|范式|框架|生态|链路|矩阵|向量)(上|中|下|的|里)/g,
    hint: "抽象名词（维度/层面/体系）堆叠会显得空；换成具体对象。",
  },
  {
    id: "hype-positive",
    cat: "lex",
    sev: 1,
    re: /(蓬勃(发展|兴起)?|生机勃勃|令人(振奋|惊叹|瞩目)|充满活力|前景广阔|无限可能)/g,
    hint: "少了「令人振奋/前景广阔」这类广告词，信息量不会变少。",
  },

  // ---------- 句法 ----------
  {
    id: "not-x-but-y",
    cat: "syn",
    sev: 3,
    re: /(不是|并非)[^。！？\n]{1,30}?[，,；;]\s*而是[^。！？\n]{1,30}/g,
    hint: "「不是X，而是Y」是最典型的 AI 反转句式；直接说 Y。",
  },
  {
    id: "not-x-but-y-lite",
    cat: "syn",
    sev: 1,
    re: /(不是|并非)[^。！？\n]{1,30}?[，,；;]\s*(?!而是)(?:而)?是[^。！？\n]{1,30}/g,
    hint: "「不是X，是Y」本身是正常汉语口语，偶尔用没问题；一段里反复出现才像模板。",
  },
  {
    id: "triadic-list",
    cat: "syn",
    sev: 1,
    re: /[^、，。；：\n]{5,14}、[^、，。；：\n]{5,14}(和|与|及)[^、，。；：\n]{5,14}/g,
    hint: "三段式排比是凑数；有几个说几个，两项也合法。",
  },
  {
    id: "not-only-also",
    cat: "syn",
    sev: 1,
    re: /(不仅[^。；\n]{0,25}(而且|还|更)|不但[^。；\n]{0,25}(而且|还))/g,
    hint: "「不仅…而且…」可拆成两句，或直接讲重点那一半。",
  },
  {
    id: "rhetorical-qa",
    cat: "syn",
    sev: 2,
    // 外部校验（2026-10-15，17 篇 2022 年前真人文章）：原写法里的 `\s*` 会跨行，
    // 把「…吗？\n为什么…」这种连续两个真问题当成自问自答（简书 2019 随笔被误报 2 次）。
    // 自问自答必须是同一行、并且下一句真的是答案；「为什么」是问题不是答案，已去掉。
    re: /[？?][ \t]*(那么|所以|答案是|答案就是|原因(是|在于)|这是因为|其实是)/g,
    hint: "自问自答的过渡句可以删掉，直接给答案。",
  },
  {
    id: "meta-scaffold",
    cat: "dis",
    sev: 2,
    re: /(那么[，,]|那么问题来了|这就(引出|涉及)了|接下来(，)?(我|我们)(将|会|来)|下面(，)?(我|我们)(将|会|来)|以下(将|会|从)|让我(来)?(为(你|您))?(解释|分析|说明|梳理|看看)|需要(指出|说明|强调)的是)/g,
    hint: "别预告自己要说什么，直接说。",
  },
  {
    id: "let-us",
    cat: "syn",
    sev: 3,
    re: /让(我们|咱们)/g,
    hint: "「让我们…」是英文 Let's 直译，中文口语里不说。",
  },

  // ---------- 格式 ----------
  // 这五条都标 evidence:"format"：只进 formatWeight（观察信号，上限 25 分），不进 ruleWeight。
  // 依据（第三轮红队实测）：`- **标签**：内容` 在人类技术文档/说明书/周报里同样常见——
  // 技术文档 1/2/3 条 = 29/47/61 分、说明书 2/4 条 = 52/75 分，与 AI 样本完全重叠，不能单独定罪。
  // 真正区分「AI 卡片回答」的是下面 metrics 里的 card-ratio（整篇几乎只剩卡片行）。
  {
    id: "arrow-symbol",
    cat: "fmt",
    sev: 1,
    evidence: "format",
    re: /(→|⇒|➜|=>)/g,
    hint: "箭头符号在散文中少见；改用「变成/导致」这类动词。",
  },
  {
    id: "bold-label-line",
    cat: "fmt",
    sev: 3,
    evidence: "format",
    re: /^[ \t]*(?:[-*+]|\d+[.、])[ \t]+\*\*[^*\n]{2,24}\*\*[：: ]/gm,
    hint: "「- **小标题**：内容」是 DeepSeek 最明显的格式指纹；改写成自然段。",
  },
  {
    id: "bold-start-line",
    cat: "fmt",
    sev: 2,
    evidence: "format",
    re: /^[ \t]*\*\*[^*\n]{2,24}\*\*[：:]/gm,
    hint: "整行加粗当标题，散文里不需要。",
  },
  {
    id: "bold-heading",
    cat: "fmt",
    sev: 2,
    evidence: "format",
    re: /^#{1,6}[ \t]+\*\*/gm,
    hint: "标题里再加粗是重复强调。",
  },
  {
    id: "bold-inline-label",
    cat: "fmt",
    sev: 2,
    evidence: "format",
    re: /\*\*[^*\n]{2,20}\*\*[：:]/g,
    hint: "「**词**：」把句子切成标签，是指令腔；写成正常句子。",
  },

  // ---------- 语篇/语用 ----------
  {
    id: "platitude-open",
    cat: "dis",
    sev: 3,
    scope: "opening",
    re: /^((这是一个|这是个|这确实是(一个|个))[^\n]{0,4}(好|很好|不错|很棒|有意思)的?问题|(好|很好|不错|很棒|有意思)的?问题[！!。，,？?])/gm,
    hint: "别先夸问题；直接进入答案。",
  },
  {
    id: "grateful-open",
    cat: "dis",
    sev: 3,
    scope: "opening",
    re: /^(感谢|谢谢)(你的|您)?(提问|问题|关注|阅读)|^(很高兴|很乐意|乐于)(为(你|您))?(回答|解答|介绍)/gm,
    hint: "别写开场客套；直接给答案。",
  },
  {
    id: "era-opener",
    cat: "dis",
    sev: 1,
    scope: "opening",
    re: /(在当今|在如今|在当下)[^。，\n]{0,12}(时代|社会|背景)|随着[^。，\n]{0,12}的(发展|普及|兴起|推进|应用)/g,
    hint: "「在当今…时代／随着…的发展」是套话开头；直接说事。",
  },
  {
    id: "service-close",
    cat: "dis",
    sev: 3,
    re: /(希望[^\n。！？]{0,6}对(你|您)(有所|有)?帮助|如果[^\n。！？]{0,6}(还)?有(其他|任何)?(问题|疑问|需要)|随时(告诉|问|联系)我|还有什么(可以|能)帮(你|您)|祝你(一切)?(顺利|愉快)|以上就是|感谢(大家的?)?(阅读|观看|关注))/g,
    hint: "结尾不写客服话术。",
  },
  {
    id: "fake-empathy",
    cat: "dis",
    sev: 3,
    re: /(我(完全)?理解(你|您)的(感受|心情|处境|意思)|这(确实|真的)?(很|让(人|你))(难|不容易|痛苦|纠结))/g,
    hint: "共情要具体，否则不如不说。",
  },
  {
    id: "summary-close",
    cat: "dis",
    sev: 1,
    scope: "closing",
    re: /(总之|综上|总结(一下|来看)|最后(再)?(强调|说)一点|概括(一下|起来)|一句话(总结|概括))/g,
    hint: "别在结尾复述；说完就结束。",
  },
  {
    // 2026-10-15 用户指出：AI 味不只是修辞，是「每段都要落到一个判断」的思维习惯。
    // 这句在 55376 字里命中 4 次，而 32189 字真人中文（人民日报评论/果壳/新华网/阮一峰的博客）
    // 一次都没有——真人句首不放判决。绝对频次低，所以 sev 只给 1。
    id: "verdict-opener",
    cat: "dis",
    sev: 1,
    re: /(?:^|[。！？\n])\s*(?:真正|说到底|先说结论|直接说结论|关键(?:是|在于|区分)|核心(?:是|在于|问题|结论))/g,
    hint: "句子一开头就下判断，读着像在训话；把过程写出来，结论让读者自己走到。",
  },
  {
    // 2026-10-25 用户指出：AI 说话爱用第一人称叙述自己的动作——「我把这件事拆解成三个方面」，
    // 而简洁的说法是「这件事拆解之后可以从三个方面去分析」。
    // 实测（55,376 字我的输出 vs 32,189 字 2022 年前公开文章 vs 真人聊天）：
    //   「我+动作」占「我」 13.0% / 17.2%（近期） vs 6.1% vs 7.1%；
    //   「我把」密度 0.09~0.22/千字 vs 0.03 vs 0；「我…了」0.05~0.14 vs 0 vs 0。
    // 绝对密度不足以定罪（真人聊天里「我」本来就多），所以要求成串出现（minHits: 2）：
    // 单句「我把 score 改成 0」是正常汉语，一段里连着四五句「我做了/我加了/我把…」才是口癖。
    id: "first-person-narration",
    cat: "dis",
    sev: 2,
    minHits: 2,
    re: /我(?:来)?把(?!握|关|戏|柄|手|持|脉|式)[^。，；！？\n]{0,10}?(?:做|加|改|写|量|试|跑|查|拆|整理|装|删|补|修|换|算|画|重写|合并|提交|推送|重启|打开|关掉|检查|确认)|我(?:来|先|再|又|也|已经|刚刚?)?(?:做|加|改|写|量|试|跑|查|拆|整理|装|删|补|修|换|算|画|重写|合并|提交|推送|重启|打开|关掉|检查|确认)(?:了|过|一下)/g,
    hint: "少拿「我」当主语讲自己做了什么；写「量下来 872 token」而不是「我量了一下」，以事件或结果作主语。",
  },
  {
    id: "enumerate-all",
    cat: "dis",
    sev: 1,
    // 「等等」从这条里删掉：它是正常汉语的收尾词，外部校验里 3 篇真人博客（博客园 2019）
    // 都因为「接口测试、集成测试等等」被误报。真正的 AI 穷举腔是前面那几个「主要包括以下 /
    // 以下几个方面」式的开场，不是句尾的「等等」。
    re: /(主要包括以下|以下几个方面|以下几点|可以分为(以下)?(几|三|四)类|诸如)/g,
    hint: "穷举会稀释重点；只留最相关的两三条。",
  },
  {
    id: "uplift-close",
    cat: "dis",
    sev: 1,
    scope: "closing",
    re: /(未来(，)?(我们|你)|在.{0,8}(的)?道路上|愿你|迎接.{0,6}挑战|共(创|赴)美好)/g,
    hint: "结尾的升华句删掉，那是 AI 的收尾习惯。",
  },
  {
    id: "you-might-think",
    cat: "dis",
    sev: 2,
    re: /((你|您)(可能|也许|或许)(已经)?(会)?(注意|意识|发现|想|好奇)到?|(你|您)以为|不少人(会|可能)(问|想)|有人(会|可能)(问|说))/g,
    hint: "别替读者脑补心理活动。",
  },
];

// 结构/密度指标（需要统计而非单次匹配）
// measure(text, metrics) 返回 0..cap 的连续分
// evidence 决定这条指标能不能参与定罪（见 lib/lint.js 的 formatNudge）：
//   "format" = 排版指纹（列表/加粗/表格/emoji/冒号定义）。人类写清单、数据表、
//              工作日志同样工整，所以**不能**单独定罪；只有在排版特征极端密集
//              （formatWeight ≥ 5）时才给一点点分，且封顶 25（永远进不了「中等」档）。
//   "rhythm" = 节奏指标（句长均匀、段落等长）。只做加成，不可独立定罪。
export const METRICS = [
  {
    id: "bold-density",
    cat: "struct",
    sev: 2,
    evidence: "format",
    threshold: 6, // 每千字加粗片段数
    hint: "加粗太多；一屏内最多留一处真正需要强调的。",
    measure: (t, m) => scale(m.boldSpans / m.per1000, 6),
  },
  {
    // 「整篇几乎只剩卡片行」——比单看某个加粗标签准，但仍然只是观察信号：
    // 第三轮红队实测人类说明书/产品简介/技术文档同样是纯卡片结构（4 条 = 75 分），
    // 与 AI 样本在结构上不可分。因此进 formatWeight（上限 25 分），不定罪。
    id: "card-ratio",
    cat: "fmt",
    sev: 3,
    evidence: "format",
    threshold: 0.5,
    hint: "整篇几乎只剩「- **标签**：内容」的卡片行，没有真正的段落；把卡片改写成有主次的自然段。",
    measure: (t, m) =>
      m.chars >= 120 && m.cardLines >= 3
        ? scale(m.cardLines / Math.max(m.contentLines, 1), 0.5)
        : 0,
  },
  {
    id: "bullet-ratio",
    cat: "struct",
    sev: 2,
    evidence: "format",
    threshold: 0.45,
    hint: "列表占比过高；叙述性内容请用自然段。",
    measure: (t, m) => scale(m.bulletLines / Math.max(m.contentLines, 1), 0.45),
  },
  {
    id: "heading-ratio",
    cat: "struct",
    sev: 2,
    evidence: "format",
    threshold: 0.18,
    hint: "小标题过密；短回答不需要分节。",
    measure: (t, m) => scale(m.headingLines / Math.max(m.contentLines, 1), 0.18),
  },
  {
    id: "table-ratio",
    cat: "struct",
    sev: 2,
    evidence: "format",
    threshold: 0.5,
    hint: "整篇以表格为主时，说明性内容常常缺席；补一段自然语言的判断。",
    measure: (t, m) => scale(m.tableLines / Math.max(m.contentLines, 1), 0.5),
  },
  {
    id: "colon-definition",
    cat: "struct",
    sev: 1,
    evidence: "format",
    threshold: 0.3,
    hint: "「名词：解释」的格式用得太多会像说明书；换成正常句子。",
    measure: (t, m) => scale(m.colonLines / Math.max(m.contentLines, 1), 0.3),
  },
  {
    id: "emoji-marker",
    cat: "struct",
    sev: 2,
    evidence: "format",
    threshold: 2,
    hint: "行首 emoji 当项目符号是 AI 排版习惯；文字本身足够。",
    measure: (t, m) => (m.emojiStartLines >= 2 ? scale(m.emojiStartLines / 2, 1, 2) : 0),
  },
  {
    id: "emdash-density",
    cat: "struct",
    sev: 1,
    evidence: "rhythm",
    threshold: 3,
    hint: "破折号插入语太多；改用逗号或直接断句。",
    measure: (t, m) => {
      const n = (t.match(/——/g) || []).length;
      if (n < 2) return 0; // 单个破折号是正常汉语，不算证据
      return scale(n / m.per1000, 3);
    },
  },
  {
    id: "emoji-density",
    cat: "struct",
    sev: 1,
    evidence: "format",
    threshold: 3,
    hint: "emoji 用得多；正式回答里少用。",
    measure: (t, m) => (m.emojiCount >= 3 ? scale(m.emojiCount / 3, 1, 2) : 0),
  },
  {
    id: "sentence-burstiness",
    cat: "struct",
    sev: 2,
    evidence: "rhythm",
    threshold: 0.4,
    hint: "句子长度过于均匀；人类写作长短句交错，可以有 5 字短句。",
    measure: (t, m) =>
      m.chars < 300 || m.sentenceCount < 6 ? 0 : scale(0.4 / Math.max(m.sentenceCv, 1e-6), 1, 2),
  },
  {
    id: "paragraph-uniform",
    cat: "struct",
    sev: 2,
    evidence: "rhythm",
    threshold: 0.25,
    hint: "每段字数几乎一样，像模板生成；允许某段只有一句话。",
    measure: (t, m) =>
      m.paragraphCount < 5 ? 0 : scale(0.25 / Math.max(m.paragraphCv, 1e-6), 1, 2),
  },
  {
    // 「每两句话就有一个把人/战争套在化学过程上的比喻」——这是目标样本最重的一条口癖：
    // 63 句里 12 句带拟人化动作（缴械、相依为命、抱成一团），真人语料抽样里最高 4.3%。
    // 与排版证据不同，这条在真人语料上量到了明确的上限，所以走 strong 档，可以单独定罪。
    // 上限放到 6（而不是 2）：修辞占比是可贯穿全文的写法，越 pervasive 分越高才算公平；
    // 只出现一两句的文本仍然回到 0（scale 在 0.5 倍阈值以下直接返回 0）。
    id: "rhetoric-pileup",
    cat: "dis",
    sev: 3,
    evidence: "strong",
    threshold: 0.04,
    hint: "修辞句太多：把过程、物质写成有脾气/会缴械/能相依为命的角色，真人写作里这类句子通常不到 5%。比喻留一两处，其余用直白的说明。",
    measure: (t) => {
      const sents = t
        .split(/[。！？!?]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2);
      // 句数太少时占比是噪声（1/8 句听上去就有 12%）；整篇只有一两处比喻是正常写作。
      if (sents.length < 12) return 0;
      const hits = sents.filter((s) => RHETORIC_MARKERS.test(s)).length;
      if (hits < 5) return 0;
      return scale(hits / sents.length, 0.04, 6);
    },
  },
];

// ratio/threshold → 0..cap 的连续分档
function scale(ratio, threshold, cap = 2) {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  const r = ratio / threshold;
  if (r < 0.5) return 0;
  return Math.min(cap, r);
}
