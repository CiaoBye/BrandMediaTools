const CHINESE_STOP = new Set([
  "的是", "是的", "了吗", "什么", "怎么", "真的", "一个", "我的", "你的", "他的", "她的",
  "不是", "没有", "可以", "这个", "那个", "就是", "还是", "但是", "不过", "所以", "因为",
  "然后", "如果", "虽然", "而且", "或者", "只是", "还是", "已经", "这个", "那个", "他们",
  "我们", "你们", "自己", "知道", "成为", "就是", "不会", "但是", "可以", "时候", "还有",
  "以及", "或者", "并且", "因此", "于是", "从而", "比如", "比如", "关于", "对于"
]);

const TITLE_PATTERNS = [
  { name: "疑问式", regex: /^(为什么|如何|怎么|怎样|咋|凭啥|难道|能否|是否)/ },
  { name: "数字列举", regex: /^\d+[个分秒招步天种]/ },
  { name: "否定式", regex: /^(别再|别|不要|千万别|别让|拒绝)/ },
  { name: "身份代入", regex: /^(小白|文科生|新手|零基础|0基础|普通|打工人|宝妈|学生)/ },
  { name: "对比反差", regex: /(竟然|居然|没想到|才发现|原来)/ },
  { name: "命令式", regex: /^(一定要|必须|快去|建议|赶紧|马上)/ },
  { name: "情绪感叹", regex: /[！!]\s*$/ },
  { name: "含问号", regex: /[？?]/ },
  { name: "含冒号", regex: /[:：]/ },
  { name: "含竖线分隔", regex: /\|/ },
  { name: "含省略号", regex: /…{2,}/ },
  { name: "含话题标签", regex: /#[^\s#]+/ },
];

export function analyzeTitleStructure(title) {
  if (!title) return { pattern: "未知", patternName: "未知" };
  for (const p of TITLE_PATTERNS) {
    if (p.regex.test(title)) return { pattern: p.name, patternName: p.name };
  }
  if (/^["""]/.test(title)) return { pattern: "引语式", patternName: "引语式" };
  return { pattern: "直述式", patternName: "直述式" };
}

export function extractTopics(descriptions, minLen = 2, maxLen = 4, minFreq = 2) {
  const freq = new Map();
  for (const desc of descriptions) {
    if (!desc) continue;
    const chars = [...desc.replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-zA-Z0-9#\s]/g, "")];
    for (let len = minLen; len <= maxLen; len++) {
      for (let i = 0; i <= chars.length - len; i++) {
        const phrase = chars.slice(i, i + len).join("");
        const clean = phrase.replace(/\s+/g, "");
        if (clean.length < minLen || CHINESE_STOP.has(clean)) continue;
        freq.set(clean, (freq.get(clean) || 0) + 1);
      }
    }
  }
  return [...freq.entries()]
    .filter(([, c]) => c >= minFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 50)
    .map(([phrase, count]) => ({ phrase, count }));
}

export function getTitleStats(notes, analyzeTitleFn) {
  const total = notes.length;
  const hookCounts = {};
  const patternCounts = {};
  const titleLengths = [];
  let hookCount = 0;
  for (const note of notes) {
    const title = note.title || "";
    if (!title) continue;
    const ta = analyzeTitleFn(title);
    const ts = analyzeTitleStructure(title);
    titleLengths.push(ta.titleLength);
    for (const hook of ta.hookPatterns) {
      hookCounts[hook] = (hookCounts[hook] || 0) + 1;
      hookCount++;
    }
    patternCounts[ts.patternName] = (patternCounts[ts.patternName] || 0) + 1;
  }
  const avgLen = titleLengths.length > 0
    ? Math.round(titleLengths.reduce((a, b) => a + b, 0) / titleLengths.length) : 0;
  const hookRate = total > 0 ? Math.round((hookCount / total) * 100) : 0;
  return { total, avgTitleLength: avgLen, hookRate, hookDistribution: hookCounts, patternDistribution: patternCounts };
}

export function getBodyStats(notes, analyzeBodyFn) {
  const lengths = [];
  let withCallToAction = 0;
  let withHashtag = 0;
  const descTexts = [];
  let total = 0;
  for (const note of notes) {
    const desc = note.description || "";
    if (desc) {
      const ba = analyzeBodyFn(desc);
      lengths.push(ba.bodyLength);
      if (ba.hasCallToAction) withCallToAction++;
      if (ba.hashtagCount > 0) withHashtag++;
      descTexts.push(desc);
      total++;
    }
  }
  const avgLen = lengths.length > 0 ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0;
  return { total, avgBodyLength: avgLen, withCallToAction, withHashtag, topics: extractTopics(descTexts) };
}

export function getEngagementStats(notes, analyzeEngagementFn) {
  let totalNotes = 0;
  let sumLikes = 0, sumComments = 0, sumCollects = 0, sumShares = 0;
  let maxLikes = 0, maxComments = 0, maxTotal = 0;
  for (const note of notes) {
    const m = note.metrics || {};
    const eng = analyzeEngagementFn(m);
    if (eng.total === 0) continue;
    totalNotes++;
    sumLikes += eng.likes; sumComments += eng.comments; sumCollects += eng.collects; sumShares += eng.shares;
    if (eng.likes > maxLikes) maxLikes = eng.likes;
    if (eng.comments > maxComments) maxComments = eng.comments;
    if (eng.total > maxTotal) maxTotal = eng.total;
  }
  return {
    totalNotes, avgLikes: totalNotes > 0 ? Math.round(sumLikes / totalNotes) : 0,
    avgComments: totalNotes > 0 ? Math.round(sumComments / totalNotes) : 0,
    avgCollects: totalNotes > 0 ? Math.round(sumCollects / totalNotes) : 0,
    avgShares: totalNotes > 0 ? Math.round(sumShares / totalNotes) : 0,
    maxLikes, maxComments, maxTotal,
    totalLikes: sumLikes, totalComments: sumComments
  };
}

export function getLibraryStats(notes) {
  const libs = { 选题库: 0, 脚本模板库: 0, 视觉参考库: 0, 营销话术库: 0, 未分类: 0 };
  for (const note of notes) {
    const lt = note.libraryType || "未分类";
    libs[lt] = (libs[lt] || 0) + 1;
  }
  return libs;
}

export function getVisualStyleStats(notes) {
  const freq = {};
  for (const note of notes) {
    const vs = note.analysis?.visualStyle || note.visualStyle || "";
    if (vs) {
      for (const style of vs.split(/[,，、]/)) {
        const s = style.trim();
        if (s) freq[s] = (freq[s] || 0) + 1;
      }
    }
  }
  return Object.entries(freq).sort(([, a], [, b]) => b - a).slice(0, 20).map(([style, count]) => ({ style, count }));
}

export function getMarketingGoalStats(notes) {
  const freq = {};
  for (const note of notes) {
    const mg = note.marketingGoal || "未设置";
    freq[mg] = (freq[mg] || 0) + 1;
  }
  return Object.entries(freq).sort(([, a], [, b]) => b - a).map(([goal, count]) => ({ goal, count }));
}

export function getContentTypeStats(notes) {
  const freq = {};
  for (const note of notes) {
    const ct = note.contentType || "未知";
    freq[ct] = (freq[ct] || 0) + 1;
  }
  return Object.entries(freq).sort(([, a], [, b]) => b - a).map(([type, count]) => ({ type, count }));
}

export function getAuthorStats(notes) {
  const freq = {};
  for (const note of notes) {
    const author = note.authorName || "未知";
    freq[author] = (freq[author] || 0) + 1;
  }
  return Object.entries(freq).sort(([, a], [, b]) => b - a).slice(0, 20).map(([author, count]) => ({ author, count }));
}
