import { sleep, openXhsContext } from "../xhsSdk.mjs";

export async function collectComments(noteUrl, options = {}) {
  const rootDir = options.rootDir || process.cwd();

  const context = await openXhsContext(rootDir, options.cookie || "", {
    proxy: options.proxy || "", headless: options.headless
  });
  try {
    const page = await context.newPage();
    await page.goto(noteUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(3000);

    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, 800));
      await sleep(800);
    }
    await sleep(1000);

    const comments = await page.evaluate(() => {
      const items = [];
      const commentEls = document.querySelectorAll("[class*='comment'], [class*='reply'], .note-scroller .item, [class*='interact'] [class*='item']");
      for (const el of commentEls) {
        const text = el.textContent?.trim();
        if (!text || text.length < 2) continue;
        const author = el.querySelector("[class*='name'], [class*='author'], [class*='user']")?.textContent?.trim() || "";
        const content = el.querySelector("[class*='content'], [class*='text'], [class*='desc']")?.textContent?.trim() || text.slice(0, 200);
        const likes = el.querySelector("[class*='like'], [class*='count']")?.textContent?.trim() || "";
        const time = el.querySelector("time, [class*='time'], [class*='date']")?.textContent?.trim() || "";
        items.push({ author: author || "用户", content: content.slice(0, 500), likes, time });
      }
      return items.slice(0, 100);
    });

    const initComments = await page.evaluate(() => {
      const state = window.__INITIAL_STATE__;
      if (!state?.note?.commentMap) return [];
      const map = state.note.commentMap;
      const list = [];
      for (const [id, comment] of Object.entries(map)) {
        list.push({
          id: comment.id || id,
          author: comment.user?.nickname || comment.user_name || "",
          content: comment.content || comment.desc || "",
          likes: comment.like_count || comment.likes || 0,
          time: comment.create_time || comment.time || "",
          replies: Array.isArray(comment.sub_comments) ? comment.sub_comments.map((r) => ({
            author: r.user?.nickname || r.user_name || "",
            content: r.content || r.desc || "",
            likes: r.like_count || r.likes || 0
          })) : []
        });
      }
      return list;
    });

    const merged = initComments.length ? initComments : comments;
    return { noteUrl, count: merged.length, comments: merged };
  } finally { await context.close(); }
}
