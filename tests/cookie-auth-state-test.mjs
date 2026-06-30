import assert from "node:assert";
import { inspectCookieStateFromHtml } from "../src/xhsAuth.mjs";

const html = (state) => `<html><head><script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script></head><body></body></html>`;

const guest = inspectCookieStateFromHtml(html({
  user: {
    userInfo: { _value: { guest: true, userId: "guest_user_id" } },
    loggedIn: { value: false }
  }
}));

assert.strictEqual(guest.hasState, true);
assert.strictEqual(guest.isGuest, true);
assert.strictEqual(guest.isLoggedIn, false);

const logged = inspectCookieStateFromHtml(html({
  user: {
    userInfo: { _value: { guest: false, userId: "real_user_id", nickname: "测试用户" } },
    loggedIn: { value: true }
  }
}));

assert.strictEqual(logged.hasState, true);
assert.strictEqual(logged.isGuest, false);
assert.strictEqual(logged.isLoggedIn, true);
assert.strictEqual(logged.nickname, "测试用户");

const loginPage = inspectCookieStateFromHtml("<html><body>手机号登录 登录小红书</body></html>");
assert.strictEqual(loginPage.hasState, false);
assert.strictEqual(loginPage.isLoginPage, true);

console.log("cookie-auth-state-test passed");
