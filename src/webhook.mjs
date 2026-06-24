import { loadSettings } from "./settings.mjs";

const PLATFORMS = {
  feishu: { label: "飞书", format: (msg) => ({ msgtype: "markdown", markdown: { content: msg } }) },
  dingtalk: { label: "钉钉", format: (msg) => ({ msgtype: "markdown", markdown: { title: "品牌情报通知", text: msg } }) },
  wecom: { label: "企业微信", format: (msg) => ({ msgtype: "markdown", markdown: { content: msg } }) },
};

export async function sendWebhook(rootDir, title, message, override = {}) {
  const settings = loadSettings(rootDir);
  const config = { ...(settings.notification || {}), ...override };
  const url = config.webhookUrl || "";
  const platform = config.webhookPlatform || "feishu";
  if (!url) return { sent: false, reason: "未配置 Webhook URL" };

  const pf = PLATFORMS[platform];
  if (!pf) throw new Error(`不支持的 Webhook 平台：${platform}`);

  const time = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 19).replace("T", " ");
  const msg = `**${title}**\n${message}\n---\n_${time}_`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pf.format(msg)),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`);
    return { sent: true };
  } catch (e) {
    if (override.webhookUrl) throw e;
    console.warn("[webhook] 发送失败:", e.message);
    return { sent: false, reason: e.message };
  }
}
