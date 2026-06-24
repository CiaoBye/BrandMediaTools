const QUESTION_PATTERN = /[？?]\s*$/;
const EMOTION_WORDS = ["太香了", "绝了", "震惊", "真香", "上头", "离谱", "爆了", "神了", "逆天", "炸裂", "绝绝子", "泪目", "天花板"];
const IDENTITY_MARKERS = ["小白", "文科生", "非技术", "新手", "零基础", "0基础", "不会编程", "普通人", "打工人", "宝妈", "学生党"];
const CONTRAST_PATTERNS = [/不是.{1,8}才/, /竟然/, /居然/, /没想到/, /才发现/, /原来/];
const NUMBER_PATTERN = /\d+[个分秒招步天种]/;
const LIST_PATTERN = /^(\d+[\.、]|[①②③④⑤⑥⑦⑧⑨⑩]|[一二三四五六七八九十][、.])/m;
const SERIES_PATTERN = /[（(]\s*[一二三四五六七八九十\d]+\s*[)）]|[Pp]art\s*\d+|第[一二三四五六七八九十\d]+[期篇章集部]/;
const CTA_PATTERN = /关注|点赞|收藏|转发|评论区|留言|私信/;
const EMOJI_PATTERN = /\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu;

const BIGRAM_STOP = new Set(["的是", "是的", "了吗", "什么", "怎么", "真的", "一个", "我的", "你的", "他的", "她的", "不是", "没有", "可以", "这个", "那个", "就是", "还是", "但是", "不过", "所以", "因为", "然后"]);

export function num(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const s = v.trim();
    if (s.endsWith("万")) { const n = parseFloat(s.slice(0, -1)); return isNaN(n) ? 0 : Math.round(n * 10000); }
    if (s.endsWith("亿")) { const n = parseFloat(s.slice(0, -1)); return isNaN(n) ? 0 : Math.round(n * 100000000); }
    const n = parseInt(s, 10); return isNaN(n) ? 0 : n;
  }
  return 0;
}

function ratio(a, b) { return b > 0 ? Math.round((a / b) * 10000) / 100 : 0; }

function hookPatterns(title) {
  const p = [];
  if (NUMBER_PATTERN.test(title)) p.push("数字");
  if (QUESTION_PATTERN.test(title)) p.push("反问");
  if (/[！!]\s*$/.test(title)) p.push("感叹");
  if (LIST_PATTERN.test(title)) p.push("列表");
  if (IDENTITY_MARKERS.some((w) => title.includes(w))) p.push("身份认同");
  if (EMOTION_WORDS.some((w) => title.includes(w))) p.push("情绪词");
  if (CONTRAST_PATTERNS.some((pr) => pr.test(title))) p.push("反差");
  if (SERIES_PATTERN.test(title)) p.push("系列");
  if ((title.match(EMOJI_PATTERN) ?? []).length > 0) p.push("表情");
  return p;
}

export function analyzeTitle(title) {
  const emojis = title.match(EMOJI_PATTERN) ?? [];
  return {
    title, titleLength: [...title].length, emojiCount: emojis.length, emojis, hookPatterns: hookPatterns(title),
    hasNumber: NUMBER_PATTERN.test(title), hasQuestion: QUESTION_PATTERN.test(title), isListFormat: LIST_PATTERN.test(title),
    hasIdentityHook: IDENTITY_MARKERS.some((w) => title.includes(w)), hasEmotionWord: EMOTION_WORDS.some((w) => title.includes(w)),
  };
}

export function analyzeBody(desc) {
  if (!desc) return { bodyLength: 0, paragraphCount: 0, avgParagraphLength: 0, emojiDensity: 0, hashtagCount: 0, hashtags: [], hasCallToAction: false };
  const paras = desc.split(/\n\s*\n|\n/).filter((p) => p.trim());
  const bl = desc.length;
  const emojis = desc.match(EMOJI_PATTERN) ?? [];
  const hashtags = desc.match(/#[^\s#]+/g) ?? [];
  return {
    bodyLength: bl, paragraphCount: paras.length, avgParagraphLength: paras.length > 0 ? Math.round(bl / paras.length) : 0,
    emojiDensity: bl > 0 ? Math.round((emojis.length / bl) * 10000) / 100 : 0,
    hashtagCount: hashtags.length, hashtags, hasCallToAction: CTA_PATTERN.test(desc),
  };
}

export function analyzeEngagement(metrics) {
  const likes = num(metrics?.likedCount ?? metrics?.likes ?? 0);
  const comments = num(metrics?.commentCount ?? metrics?.comments ?? 0);
  const collects = num(metrics?.collectedCount ?? metrics?.collects ?? 0);
  const shares = num(metrics?.shareCount ?? metrics?.shares ?? 0);
  return { likes, comments, collects, shares, total: likes + comments + collects + shares, commentToLikeRatio: ratio(comments, likes), collectToLikeRatio: ratio(collects, likes), shareToLikeRatio: ratio(shares, likes) };
}

export function analyzeComments(comments) {
  if (!comments || !comments.length) return { totalFetched: 0, topComments: [], avgCommentLength: 0, avgCommentLikes: 0, themes: [], questionCount: 0, questionRate: 0 };
  const sorted = [...comments].sort((a, b) => num(b.like_count ?? b.likes ?? 0) - num(a.like_count ?? a.likes ?? 0));
  const topComments = sorted.slice(0, 5).map((c) => ({ author: c.authorName ?? c.author_name ?? c.nickname ?? "?", content: String(c.content ?? ""), likes: num(c.like_count ?? c.likes ?? 0) }));
  const totalLen = comments.reduce((s, c) => s + String(c.content ?? "").length, 0);
  const totalLikes = comments.reduce((s, c) => s + num(c.like_count ?? c.likes ?? 0), 0);
  const qCount = comments.filter((c) => QUESTION_PATTERN.test(String(c.content ?? ""))).length;
  const bigramCounts = new Map();
  for (const c of comments) {
    const chars = [...String(c.content ?? "")].filter((ch) => /[\u4e00-\u9fff]/.test(ch));
    for (let i = 0; i < chars.length - 1; i++) {
      const big = chars[i] + chars[i + 1];
      if (!BIGRAM_STOP.has(big)) bigramCounts.set(big, (bigramCounts.get(big) ?? 0) + 1);
    }
  }
  const themes = [...bigramCounts.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([kw, c]) => ({ keyword: kw, count: c }));
  return { totalFetched: comments.length, topComments, avgCommentLength: Math.round(totalLen / comments.length), avgCommentLikes: Math.round(totalLikes / comments.length), themes, questionCount: qCount, questionRate: comments.length > 0 ? Math.round((qCount / comments.length) * 10000) / 100 : 0 };
}

export function computeScore(titleAnalysis, engagement, bodyAnalysis, commentAnalysis) {
  const hookScore = Math.min(20, titleAnalysis.hookPatterns.length * 4);
  let engScore = 4;
  if (engagement.likes >= 10000) engScore = 20; else if (engagement.likes >= 5000) engScore = 16; else if (engagement.likes >= 1000) engScore = 12; else if (engagement.likes >= 500) engScore = 8;
  let contScore = 0;
  if (bodyAnalysis.bodyLength > 200) contScore += 5;
  if (bodyAnalysis.paragraphCount > 3) contScore += 5;
  if (bodyAnalysis.emojiDensity > 0.5 && bodyAnalysis.emojiDensity < 8) contScore += 5;
  if (bodyAnalysis.hasCallToAction) contScore += 5;
  let cmtScore = 0;
  if (commentAnalysis.totalFetched > 50) cmtScore += 5;
  if (commentAnalysis.avgCommentLength > 15) cmtScore += 5;
  if (commentAnalysis.questionRate > 5) cmtScore += 5;
  if (commentAnalysis.topComments[0]?.likes > 50) cmtScore += 5;
  return { overall: hookScore + engScore + contScore + cmtScore, breakdown: { hook: hookScore, engagement: engScore, content: contScore, comments: cmtScore } };
}

export function analyzeViral(note, comments) {
  const title = note.title ?? "";
  const desc = note.description ?? note.desc ?? "";
  const metrics = note.metrics ?? {};
  const ta = analyzeTitle(title);
  const ba = analyzeBody(desc);
  const eng = analyzeEngagement(metrics);
  const ca = analyzeComments(comments);
  const score = computeScore(ta, eng, ba, ca);
  return { title: ta, body: ba, engagement: eng, comments: ca, score, contentType: note.contentType ?? "图文笔记" };
}
