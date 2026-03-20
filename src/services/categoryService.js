const axios = require("axios");
const config = require("../config");
const logger = require("../logger");
const { getCategoriesByIds } = require("../contentCategories");
const { getScheduleSettings } = require("./settingsService");
const { inferTextProtocol, resolveTextTemperature, buildKimiThinkingPayload } = require("./modelCompat");

const CATEGORY_MODEL_TIMEOUT_MS = 45000;
const CATEGORY_MODEL_MAX_CANDIDATES = 12;
const CATEGORY_MODEL_MAX_TOKENS = 300;
const CATEGORY_MODEL_MAX_ATTEMPTS = 4;

function resolveCategoryTemperature() {
  return resolveTextTemperature(
    config.openai.baseUrl,
    config.openai.textModel,
    inferTextProtocol(config.openai.baseUrl, config.openai.textModel, config.openai.textProtocol),
    0.2,
    config.openai.kimiThinkingEnabled
  );
}

function fallbackMatch(topicCandidates, selectedCategories) {
  const matches = topicCandidates
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

  logger.debug("category", "keyword fallback result", {
    candidateCount: topicCandidates.length,
    matchedCount: matches.length,
    matches
  });

  return matches;
}

function buildCategoryRetryDelayMs(attempt) {
  const base = 1500;
  const jitter = Math.floor(Math.random() * 500);
  return base * (2 ** Math.max(0, attempt - 1)) + jitter;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableCategoryError(error) {
  const status = Number(error?.response?.status || 0);
  const message = String(error?.message || "");
  return status === 408 || status === 409 || status === 429 || status >= 500 || /timeout/i.test(message);
}

async function classifyTopicCandidatesWithModel(topicCandidates, selectedCategories, schedule) {
  const timeoutMs = Number(schedule?.categoryTimeoutMs || schedule?.llmTimeoutMs || CATEGORY_MODEL_TIMEOUT_MS);
  const candidateTopics = topicCandidates.slice(0, CATEGORY_MODEL_MAX_CANDIDATES);
  const prompt = [
    "你是内容选题助手。请判断下面哪些话题候选属于用户选定的内容板块。",
    "只返回 JSON。",
    `板块列表：${selectedCategories
      .map((category) => `${category.id}:${category.name}(${category.description})`)
      .join("; ")}`,
    `话题候选：${candidateTopics
      .map((topic) => `${topic.rank}. ${topic.keyword}[来源:${topic.sourceName || topic.sourceId || "未知"}]${topic.label ? `[标签:${topic.label}]` : ""}`)
      .join(" | ")}`,
    '{"matches":[{"keyword":"...", "category_ids":["technology"], "reason":"..."}]}',
    "规则：",
    "1. 只保留至少命中一个板块的话题",
    "2. category_ids 只能填写板块列表中的 id",
    "3. 如果不确定，不要硬匹配"
  ].join("\n");

  const temperature = resolveCategoryTemperature();

  logger.debug("category", "classification prompt", {
    candidateCount: candidateTopics.length,
    timeoutMs,
    maxTokens: CATEGORY_MODEL_MAX_TOKENS,
    temperature,
    prompt
  });

  let lastError;
  for (let attempt = 1; attempt <= CATEGORY_MODEL_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await axios.post(
        `${config.openai.baseUrl}/chat/completions`,
        {
          model: config.openai.textModel,
          temperature,
          max_tokens: CATEGORY_MODEL_MAX_TOKENS,
          ...buildKimiThinkingPayload({
            baseUrl: config.openai.baseUrl,
            model: config.openai.textModel,
            textProtocol: config.openai.textProtocol,
            kimiThinkingEnabled: config.openai.kimiThinkingEnabled
          }),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "你是严格的分类器。不要输出思考过程、推理过程或解释，只能返回合法 JSON。" },
            { role: "user", content: prompt }
          ]
        },
        {
          headers: {
            Authorization: `Bearer ${config.openai.apiKey}`,
            "Content-Type": "application/json"
          },
          timeout: timeoutMs
        }
      );

      const content = response.data?.choices?.[0]?.message?.content || "{}";
      logger.debug("category", "classification response", {
        attempt,
        candidateCount: candidateTopics.length,
        timeoutMs,
        content
      });
      const parsed = JSON.parse(content);
      return Array.isArray(parsed.matches) ? parsed.matches : [];
    } catch (error) {
      lastError = error;
      if (attempt >= CATEGORY_MODEL_MAX_ATTEMPTS || !isRetriableCategoryError(error)) {
        throw error;
      }
      const delayMs = buildCategoryRetryDelayMs(attempt);
      logger.warn("category", "classification retry scheduled", {
        attempt,
        delayMs,
        candidateCount: candidateTopics.length,
        timeoutMs,
        error: error.message,
        status: error.response?.status
      });
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function matchTopicCandidatesToCategories(topicCandidates, categoryIds) {
  const selectedCategories = getCategoriesByIds(categoryIds);
  if (!selectedCategories.length) {
    return {
      matchedTopics: topicCandidates,
      matchedByKeyword: []
    };
  }

  const schedule = await getScheduleSettings();
  const categoryTimeoutMs = Number(schedule.categoryTimeoutMs || schedule.llmTimeoutMs || CATEGORY_MODEL_TIMEOUT_MS);

  let matches = [];
  if (config.openai.apiKey) {
    try {
      matches = await classifyTopicCandidatesWithModel(topicCandidates, selectedCategories, schedule);
    } catch (error) {
      logger.warn("category", "model classification failed, fallback to keywords", {
        error: error.message,
        candidateCount: topicCandidates.length,
        timeoutMs: categoryTimeoutMs,
        status: error.response?.status
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
  logger.debug("category", "topic candidate category matches", {
    selectedCategoryIds: categoryIds,
    matches: Array.from(matchMap.values())
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
