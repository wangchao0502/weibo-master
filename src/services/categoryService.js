const axios = require("axios");
const config = require("../config");
const logger = require("../logger");
const { getCategoriesByIds } = require("../contentCategories");

function fallbackMatch(topicCandidates, selectedCategories) {
  return topicCandidates
    .map((topic) => {
      const categoryIds = selectedCategories
        .filter((category) =>
          category.keywords.some((keyword) => topic.keyword.toLowerCase().includes(keyword.toLowerCase()))
        )
        .map((category) => category.id);

      return categoryIds.length
        ? {
            keyword: topic.keyword,
            categoryIds,
            reason: "keyword-match"
          }
        : null;
    })
    .filter(Boolean);
}

async function classifyTopicCandidatesWithModel(topicCandidates, selectedCategories) {
  const prompt = [
    "你是内容选题助手。请判断下面哪些话题候选属于用户选定的内容板块。",
    "只返回 JSON。",
    `板块列表：${selectedCategories
      .map((category) => `${category.id}:${category.name}(${category.description})`)
      .join("; ")}`,
    `话题候选：${topicCandidates
      .map((topic) => `${topic.rank}. ${topic.keyword}[来源:${topic.sourceName || topic.sourceId || "未知"}]`)
      .join(" | ")}`,
    '返回结构：{"matches":[{"keyword":"...", "category_ids":["technology"], "reason":"..."}]}',
    "规则：",
    "1. 只保留至少命中一个板块的话题",
    "2. category_ids 只能填写板块列表中的 id",
    "3. 如果不确定，不要硬匹配"
  ].join("\n");

  const response = await axios.post(
    `${config.openai.baseUrl}/chat/completions`,
    {
      model: config.openai.textModel,
      temperature: 1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "你只能返回合法 JSON。" },
        { role: "user", content: prompt }
      ]
    },
    {
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        "Content-Type": "application/json"
      },
      timeout: 45000
    }
  );

  const content = response.data?.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(content);
  return Array.isArray(parsed.matches) ? parsed.matches : [];
}

async function matchTopicCandidatesToCategories(topicCandidates, categoryIds) {
  const selectedCategories = getCategoriesByIds(categoryIds);
  if (!selectedCategories.length) {
    return {
      matchedTopics: topicCandidates,
      matchedByKeyword: []
    };
  }

  let matches = [];
  if (config.openai.apiKey) {
    try {
      matches = await classifyTopicCandidatesWithModel(topicCandidates, selectedCategories);
    } catch (error) {
      logger.warn("category", "model classification failed, fallback to keywords", {
        error: error.message
      });
      matches = fallbackMatch(topicCandidates, selectedCategories);
    }
  } else {
    matches = fallbackMatch(topicCandidates, selectedCategories);
  }

  const matchMap = new Map();
  matches.forEach((match) => {
    const ids = Array.isArray(match.category_ids)
      ? match.category_ids
      : Array.isArray(match.categoryIds)
        ? match.categoryIds
        : [];
    if (!ids.length || !match.keyword) {
      return;
    }
    matchMap.set(String(match.keyword), {
      keyword: String(match.keyword),
      categoryIds: ids,
      reason: String(match.reason || "")
    });
  });

  const matchedTopics = topicCandidates.filter((topic) => matchMap.has(topic.keyword));
  logger.info("category", "topic candidate category matching complete", {
    selectedCategoryIds: categoryIds,
    matchedCount: matchedTopics.length
  });

  return {
    matchedTopics,
    matchedByKeyword: Array.from(matchMap.values())
  };
}

module.exports = {
  matchTopicCandidatesToCategories,
  matchHotTopicsToCategories: matchTopicCandidatesToCategories
};
