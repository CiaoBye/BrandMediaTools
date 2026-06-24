// xhsCrawler.mjs — Re-export hub for all crawler modules
export { crawlXhs } from "./crawler/flow.mjs";
export { followAccount, extractAccountLinks, extractAccountNotes } from "./crawler/account.mjs";
export { searchXhs } from "./crawler/search.mjs";
export { collectComments } from "./crawler/comment.mjs";
export { saveXhsCookieFromBrowser, whoami } from "./crawler/auth.mjs";
export { extractNote, fetchNoteViaHttp } from "./crawler/extract.mjs";
export { extractAccountLinks as extractPageLinks } from "./crawler/account.mjs";

// Re-exports from xhsSdk (preserved for backward compat)
export {
  extractXhsId, isXhsNoteUrl, mergeXhsLinks,
  extractXhsUrls, extractXhsUrl, normalizeXhsNoteUrl,
  openXhsContext, createBrowser
} from "./xhsSdk.mjs";
