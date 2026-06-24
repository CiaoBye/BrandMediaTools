import { resolveAiConfig } from "./settings.mjs";

function compact(value, max = 800) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function fallbackAnalysis(note) {
  const title = compact(note.title, 120);
  const desc = compact(note.description, 360);
  const contentType = note.contentType || "内容";
  return {
    model: "local-rule-fallback",
    topicLogic: `围绕"${title || "当前主题"}"建立用户注意力，适合沉淀为${contentType}选题参考。`,
    openingHook: title ? `可从标题中的核心冲突或利益点切入：${title}` : "建议补充标题后再判断开头钩子。",
    videoStructure: "建议拆成：开头吸引注意 - 中段解释卖点/场景 - 结尾给出咨询、收藏或行动引导。",
    sellingPointExpression: desc || "当前正文信息不足，建议人工补充产品卖点、用户痛点和转化话术。",
    visualStyle: note.visualStyle || "根据素材判断光线、场景、人物、构图和包装方式；当前先标记为待复核。",
    conversionScript: "可观察是否存在私信、预约、到店、购买、直播、社群或私域引导。",
    takeaways: "适合进入竞品案例库，后续结合数据表现判断是否做成系列化模板。",
    howWeCanUse: "可改写为品牌自己的选题、脚本结构、画面参考和营销话术。",
    scriptDirections: [
      "同主题口播短视频",
      "同视觉风格产品种草",
      "同转化路径活动预热"
    ],
    raw: { fallback: true }
  };
}

export async function analyzeNote(note, settings = {}) {
  const { apiKey, baseUrl, model } = resolveAiConfig(settings);
  if (!apiKey) return fallbackAnalysis(note);

  const prompt = `请把下面的小红书竞品内容拆解为品牌视频创作可执行方法。只输出 JSON，不要 Markdown。

字段：
topicLogic, openingHook, videoStructure, sellingPointExpression, visualStyle, conversionScript, takeaways, howWeCanUse, scriptDirections。

内容：
标题：${compact(note.title, 200)}
正文：${compact(note.description, 1200)}
品牌：${note.brand || ""}
作者：${note.authorName || ""}
内容类型：${note.contentType || ""}
标签：${(note.tags || []).join(", ")}
`;

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "你是品牌 AI 视频内容策略分析助手，输出必须可落地到镜头、脚本和营销动作。" },
        { role: "user", content: prompt }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const fallback = fallbackAnalysis(note);
    return { ...fallback, raw: { fallback: true, error: `AI 请求失败：HTTP ${response.status}` } };
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(content);
    return {
      model,
      topicLogic: parsed.topicLogic || "",
      openingHook: parsed.openingHook || "",
      videoStructure: parsed.videoStructure || "",
      sellingPointExpression: parsed.sellingPointExpression || "",
      visualStyle: parsed.visualStyle || "",
      conversionScript: parsed.conversionScript || "",
      takeaways: parsed.takeaways || "",
      howWeCanUse: parsed.howWeCanUse || "",
      scriptDirections: Array.isArray(parsed.scriptDirections) ? parsed.scriptDirections : [],
      raw: parsed
    };
  } catch {
    const fallback = fallbackAnalysis(note);
    return { ...fallback, model, raw: { fallback: true, aiText: content } };
  }
}