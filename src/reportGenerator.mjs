import { num } from "./xhsViralAnalysis.mjs";
import { fmtDate } from "./time.mjs";

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function totalInteractions(m) {
  return num(m.likedCount || m.liked_count || m.likes || 0) + num(m.commentCount || m.comment_count || m.comments || 0)
    + num(m.collectedCount || m.collected_count || m.collects || 0) + num(m.shareCount || m.share_count || m.shares || 0);
}

function periodLabel(type, from, to) {
  if (type === "weekly") return `${fmtDate(from)} ~ ${fmtDate(to)}（近 7 天）`;
  return `${fmtDate(from).slice(0, 7)}（本月）`;
}

export function generateReport(allNotes, type = "weekly", analyzeTitleFn) {
  const now = new Date();
  let fromUtc;
  if (type === "monthly") {
    const beijingWallClock = new Date(now.getTime() + BEIJING_OFFSET_MS);
    fromUtc = new Date(Date.UTC(beijingWallClock.getUTCFullYear(), beijingWallClock.getUTCMonth(), 1) - BEIJING_OFFSET_MS);
  } else {
    fromUtc = new Date(now);
    fromUtc.setUTCDate(fromUtc.getUTCDate() - 7);
  }
  const fromStr = fromUtc.toISOString();
  const toStr = now.toISOString();
  const fromStrBJ = fromStr;
  const toStrBJ = toStr;

  const periodNotes = allNotes.filter((n) => {
    const d = n.collectedAt || "";
    return d >= fromStr && d <= toStr;
  });

  const periodMs = Math.max(1, now.getTime() - fromUtc.getTime());
  const prevFrom = new Date(fromUtc.getTime() - periodMs);
  const prevTo = new Date(fromUtc.getTime() - 1);
  const prevNotes = allNotes.filter((n) => {
    const d = n.collectedAt || "";
    return d >= prevFrom.toISOString() && d <= prevTo.toISOString();
  });

  const totalNotes = periodNotes.length;
  const authors = {};
  const brands = {};
  const contentTypes = {};
  const hookCounts = {};
  const marketingGoals = {};
  const libraries = {};
  let totalHooks = 0;

  for (const note of periodNotes) {
    const author = note.authorName || "未知";
    authors[author] = (authors[author] || 0) + 1;
    const brand = note.brand || "未分组";
    brands[brand] = (brands[brand] || 0) + 1;
    const ct = note.contentType || "未知";
    contentTypes[ct] = (contentTypes[ct] || 0) + 1;
    const mg = note.marketingGoal || "未设置";
    marketingGoals[mg] = (marketingGoals[mg] || 0) + 1;
    const lt = note.libraryType || "未分类";
    libraries[lt] = (libraries[lt] || 0) + 1;

    if (analyzeTitleFn && note.title) {
      const ta = analyzeTitleFn(note.title);
      if (ta.hookPatterns.length > 0) {
        totalHooks++;
        for (const hook of ta.hookPatterns) hookCounts[hook] = (hookCounts[hook] || 0) + 1;
      }
    }
  }

  const sortedNotes = [...periodNotes].sort((a, b) => totalInteractions(b.metrics || {}) - totalInteractions(a.metrics || {}));
  const topNotes = sortedNotes.slice(0, 10).map((n, i) => ({
    rank: i + 1, title: n.title || "未命名", brand: n.brand || "", author: n.authorName || "",
    totalInteractions: totalInteractions(n.metrics || {}),
    likes: num(n.metrics?.likedCount || n.metrics?.liked_count || n.metrics?.likes || 0),
    comments: num(n.metrics?.commentCount || n.metrics?.comment_count || n.metrics?.comments || 0),
    url: n.sourceUrl || ""
  }));

  const authorRanking = Object.entries(authors).sort(([, a], [, b]) => b - a).slice(0, 10).map(([author, count]) => ({ author, count }));
  const brandDistribution = totalNotes > 0 ? Object.entries(brands).sort(([, a], [, b]) => b - a).map(([brand, count]) => ({ brand, count, percentage: +((count / totalNotes) * 100).toFixed(1) })) : [];
  const contentTypeBreakdown = totalNotes > 0 ? Object.entries(contentTypes).sort(([, a], [, b]) => b - a).map(([type, count]) => ({ type, count, percentage: +((count / totalNotes) * 100).toFixed(1) })) : [];
  const marketingGoalBreakdown = totalNotes > 0 ? Object.entries(marketingGoals).sort(([, a], [, b]) => b - a).map(([goal, count]) => ({ goal, count, percentage: +((count / totalNotes) * 100).toFixed(1) })) : [];
  const libraryDistribution = totalNotes > 0 ? Object.entries(libraries).sort(([, a], [, b]) => b - a).map(([library, count]) => ({ library, count, percentage: +((count / totalNotes) * 100).toFixed(1) })) : [];
  const bestNote = sortedNotes[0] ? { title: sortedNotes[0].title, brand: sortedNotes[0].brand, totalInteractions: totalInteractions(sortedNotes[0].metrics || {}) } : null;

  const topAuthor = Object.entries(authors).sort(([, a], [, b]) => b - a)[0];
  const topBrand = Object.entries(brands).sort(([, a], [, b]) => b - a)[0];

  return {
    type, generatedAt: toStrBJ,
    period: { from: fromStrBJ, to: toStrBJ, label: periodLabel(type, fromStrBJ, toStrBJ) },
    summary: {
      totalNotes, totalAssets: periodNotes.reduce((s, n) => s + (n.assets || []).length, 0),
      activeAuthors: Object.keys(authors).length, activeBrands: Object.keys(brands).length,
      topAuthor: topAuthor ? { name: topAuthor[0], count: topAuthor[1] } : null,
      topBrand: topBrand ? { name: topBrand[0], count: topBrand[1] } : null,
      bestNote,
      hookRate: totalNotes > 0 ? +((totalHooks / totalNotes) * 100).toFixed(1) : 0
    },
    topNotes, authorRanking, brandDistribution, contentTypeBreakdown,
    hookPatternSummary: { totalWithHooks: totalHooks, hookRate: totalNotes > 0 ? +((totalHooks / totalNotes) * 100).toFixed(1) : 0, distribution: hookCounts },
    marketingGoalBreakdown, libraryDistribution,
    comparison: {
      prevNotes: prevNotes.length,
      noteChange: prevNotes.length > 0 ? +(((totalNotes - prevNotes.length) / prevNotes.length) * 100).toFixed(1) : 0,
      prevAuthors: new Set(prevNotes.map((n) => n.authorName)).size,
      authorChange: prevNotes.length > 0 ? +(((Object.keys(authors).length - new Set(prevNotes.map((n) => n.authorName)).size) / Math.max(new Set(prevNotes.map((n) => n.authorName)).size, 1)) * 100).toFixed(1) : 0
    }
  };
}
