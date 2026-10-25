// 改写策略：不是「不要写什么」，而是「改成什么」。每条都对应一次实测到的缺陷。
// 生成侧（系统提示）与改写侧（本文件）分开维护：提示词是约束，这里是重写指令。
export const STRATEGY = `请把下面这段回复改写成更自然的中文。要求：
1. 散文里不出现箭头符号，前后对比写成「从 A 到 B」，流程写成「先……再……」或顿号。
2. 去掉「**标签**：内容」这种把句子切成标签的写法，改成完整句子。
3. 加粗只留真正需要警醒的一处，其余全部去掉。
4. 不用「不是X，而是Y」的句式，直接说结论。
5. 不要为了衔接而加连接词：不写「首先」「其次」「再次」「此外」「最后」「综上所述」「总之」「值得一提的是」「不难看出」。段落直接开始说事，换段就是换话题。
6. 标题能删就删，段落之间靠内容衔接。
7. 少用「我」当主语讲自己做了什么。工作汇报可以整句无主语：把「我量了一下，是 872 token」写成「量下来 872 token」，把「我把 score 改成 0」写成「score 改成 0」，把「我加了 28 条断言」写成「加了 28 条断言」或「新增 28 条断言」。以事件或结果作主语，不写「这件事被我拆成三块」。
8. 数字、路径、命令、错误信息必须原样保留，不得增删事实。
只输出改写后的正文，不要解释。`;

// 单次请求的字符上限。中文场景下 3000 字大约 2k~3k token，留足余量。
export const MAX_CHUNK_CHARS = 3000;

// 按空行分段再贪心拼块，保证不切断段落；单段超长时按句号硬切。
export function chunkText(text, maxChars = MAX_CHUNK_CHARS) {
  const paras = String(text).split(/\n{2,}/);
  const chunks = [];
  let buf = "";
  for (const p of paras) {
    const piece = p.trim();
    if (!piece) continue;
    if (piece.length > maxChars) {
      if (buf) {
        chunks.push(buf);
        buf = "";
      }
      const sentences = piece.split(/(?<=[。！？；])/);
      let sbuf = "";
      for (const s of sentences) {
        if (sbuf.length + s.length > maxChars && sbuf) {
          chunks.push(sbuf);
          sbuf = "";
        }
        sbuf += s;
      }
      if (sbuf) chunks.push(sbuf);
      continue;
    }
    if (buf.length + piece.length + 2 > maxChars && buf) {
      chunks.push(buf);
      buf = "";
    }
    buf = buf ? buf + "\n\n" + piece : piece;
  }
  if (buf) chunks.push(buf);
  return chunks.length ? chunks : [""];
}
