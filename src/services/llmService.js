const axios = require("axios");
const config = require("../config");
const { now } = require("../time");
const { getScheduleSettings } = require("./settingsService");
const { buildTopicContext, buildCategoryNewsContext } = require("./hotTopicService");
const { matchTopicCandidatesToCategories } = require("./categoryService");
const { getCategoriesByIds } = require("../contentCategories");
const logger = require("../logger");

class GenerationFailedError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "GenerationFailedError";
    this.code = options.code || "generation_failed";
    this.causeMessage = options.causeMessage || "";
    this.retryable = options.retryable !== false;
  }
}

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeInlineText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractJsonObject(text) {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]);
    } catch (_) {
      return null;
    }
  }
}

function formatNewsLines(news = []) {
  if (!news.length) {
    return "暂无补充资讯";
  }
  return news
    .map((item, index) => `${index + 1}) ${item.title}${item.pubDate ? ` | ${item.pubDate}` : ""}`)
    .join("\n");
}

function buildSourceSummary(strategy) {
  if (!strategy.sourceRuns?.length) {
    return "未启用话题来源";
  }
  return strategy.sourceRuns
    .map((item) => `${item.name}(优先级:${item.priority}, 抓取:${item.count}条)`)
    .join("；");
}

function buildCopyLengthHint(schedule) {
  return `${schedule.copyMinLength}-${schedule.copyMaxLength}`;
}

function parseModelPayload(parsed, contextLabel = "微博草稿", options = {}) {
  if (!parsed || !parsed.copy) {
    throw new GenerationFailedError(`模型返回${contextLabel}格式无效，无法继续。`, {
      code: "invalid_model_payload"
    });
  }

  const minCopyLength = Number.isInteger(options.minCopyLength) ? options.minCopyLength : 60;
  const maxCopyLength = Number.isInteger(options.maxCopyLength) ? options.maxCopyLength : null;
  const copy = normalizeInlineText(parsed.copy || "");
  if (copy.length < minCopyLength) {
    throw new GenerationFailedError(`模型返回${contextLabel}过短，未达到 ${minCopyLength} 字要求。`, {
      code: "copy_too_short"
    });
  }
  if (maxCopyLength && copy.length > maxCopyLength) {
    throw new GenerationFailedError(`模型返回${contextLabel}过长，超过 ${maxCopyLength} 字限制。`, {
      code: "copy_too_long"
    });
  }

  return {
    topic: normalizeInlineText(parsed.topic || ""),
    copy,
    imageCount: clamp(Number(parsed.image_count || 1), 1, 6),
    imagePrompts: Array.isArray(parsed.image_prompts)
      ? parsed.image_prompts.map((item) => normalizeInlineText(item)).filter(Boolean).slice(0, 6)
      : []
  };
}


const IMAGE_VARIANT_HINTS = [
  "宏观场景与整体氛围，突出环境和时代感",
  "核心人物或主体动作，突出情绪和表达",
  "关键物件或符号化细节，做近景特写",
  "不同机位和构图，增强画面层次",
  "强调数据、科技感或信息元素的视觉表达",
  "补充一个不同场景的延展画面，避免与前图重复"
];

function buildPerImagePrompts(copy, imagePrompts, imageCount) {
  return Array.from({ length: imageCount }, (_, index) => {
    const basePrompt = normalizeInlineText(
      imagePrompts[index]
      || imagePrompts[0]
      || `围绕这条微博内容生成配图：${copy}`
    );
    const variantHint = IMAGE_VARIANT_HINTS[index % IMAGE_VARIANT_HINTS.length];
    return `${basePrompt}。第${index + 1}张图请突出：${variantHint}。必须与同组其他图片在主体、景别、构图或关注点上明显不同，但不能脱离微博内容。`;
  });
}

function isTimeoutError(error) {
  return error?.code === "ECONNABORTED" || /timeout/i.test(String(error?.message || ""));
}

function toGenerationError(error, fallbackMessage) {
  if (error instanceof GenerationFailedError) {
    return error;
  }
  if (isTimeoutError(error)) {
    return new GenerationFailedError("大模型生成超时，请稍后重试或调大超时配置。", {
      code: "generation_timeout",
      causeMessage: error.message
    });
  }
  return new GenerationFailedError(fallbackMessage, {
    code: "generation_failed",
    causeMessage: error?.message || fallbackMessage
  });
}

function getImageProtocol() {
  return String(config.openai.imageProtocol || "openai").toLowerCase();
}

function buildImageSizeToken(imageWidth, imageHeight) {
  if (getImageProtocol() === "dashscope") {
    return `${imageWidth}*${imageHeight}`;
  }
  return `${imageWidth}x${imageHeight}`;
}

function normalizeImageSourceLabel() {
  if (!config.openai.imageModel) {
    return `llm:${config.openai.textModel}`;
  }
  if (getImageProtocol() === "dashscope") {
    return `llm:${config.openai.textModel}+dashscope:${config.openai.imageModel}`;
  }
  return `llm:${config.openai.textModel}+${config.openai.imageModel}`;
}

function normalizeRefineImageSourceLabel() {
  if (!config.openai.imageModel) {
    return `llm-refine:${config.openai.textModel}`;
  }
  if (getImageProtocol() === "dashscope") {
    return `llm-refine:${config.openai.textModel}+dashscope:${config.openai.imageModel}`;
  }
  return `llm-refine:${config.openai.textModel}+${config.openai.imageModel}`;
}

async function postChatCompletion(payload, timeoutMs) {
  return axios.post(`${config.openai.baseUrl}/chat/completions`, payload, {
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
      "Content-Type": "application/json"
    },
    timeout: timeoutMs
  });
}

async function requestTextPayload(prompt, timeoutMs) {
  const basePayload = {
    model: config.openai.textModel,
    temperature: 1,
    messages: [
      {
        role: "system",
        content: "你是微博运营编辑，只能返回合法 JSON，不要输出多余解释。"
      },
      { role: "user", content: prompt }
    ]
  };

  try {
    return await postChatCompletion(
      {
        ...basePayload,
        response_format: { type: "json_object" }
      },
      timeoutMs
    );
  } catch (error) {
    const status = error.response?.status;
    if (status === 429) {
      logger.warn("llm", "rate limited, retrying text generation", { status });
      await sleep(3000);
      return postChatCompletion(basePayload, timeoutMs);
    }
    if (status === 400 || status === 422) {
      return postChatCompletion(basePayload, timeoutMs);
    }
    throw error;
  }
}

async function decideGenerationStrategy(schedule) {
  const selectedCategories = getCategoriesByIds(schedule.contentCategoryIds);
  const topicContext = await buildTopicContext({
    topicSources: schedule.topicSources,
    topicLimit: schedule.hotSearchCount,
    schedule
  });

  if (!selectedCategories.length) {
    return {
      mode: "topic-source-open",
      selectedCategories,
      topics: topicContext.topics,
      contexts: topicContext.contexts,
      sourceRuns: topicContext.sourceRuns,
      matchedByKeyword: []
    };
  }

  const matchResult = await matchTopicCandidatesToCategories(
    topicContext.topics,
    schedule.contentCategoryIds
  );

  if (matchResult.matchedTopics.length) {
    const matchedKeywords = new Set(matchResult.matchedTopics.map((item) => item.keyword));
    return {
      mode: "topic-source-match",
      selectedCategories,
      topics: matchResult.matchedTopics,
      contexts: topicContext.contexts.filter((item) => matchedKeywords.has(item.keyword)),
      sourceRuns: topicContext.sourceRuns,
      allTopics: topicContext.topics,
      matchedByKeyword: matchResult.matchedByKeyword
    };
  }

  const categoryContexts = await buildCategoryNewsContext(schedule.contentCategoryIds);
  return {
    mode: "category-freeform",
    selectedCategories,
    topics: topicContext.topics,
    contexts: topicContext.contexts,
    categoryContexts,
    sourceRuns: topicContext.sourceRuns,
    matchedByKeyword: []
  };
}

function buildPrompt(slotTime, strategy, schedule) {
  const categoriesLine = strategy.selectedCategories.length
    ? strategy.selectedCategories.map((item) => `${item.name}(${item.description})`).join("；")
    : "未限制板块";
  const sourceLine = buildSourceSummary(strategy);
  const schema = config.openai.imageModel
    ? '{"topic":"...", "copy":"...", "image_count":1-6, "image_prompts":["...", "..."]}'
    : '{"topic":"...", "copy":"..."}';

  if (strategy.mode === "category-freeform") {
    const categoryNews = strategy.categoryContexts
      .map(
        (item) =>
          `板块：${item.categoryName}\n说明：${item.description}\n最新资讯：\n${formatNewsLines(item.news)}`
      )
      .join("\n\n");

    return [
      `发布时间槽位：${slotTime.format("YYYY-MM-DD HH:mm")} ${config.timezone}`,
      `用户选定板块：${categoriesLine}`,
      `启用的话题来源及优先级：${sourceLine}`,
      "当前多来源话题候选没有明显命中这些板块，请基于这些板块的最新资讯自由发挥，生成一条时效性微博。",
      categoryNews || "暂无板块资讯",
      `返回 JSON，结构为：${schema}`,
      "要求：",
      "1. topic 字段写你最终选择的板块或核心话题",
      `2. 文案控制在 ${buildCopyLengthHint(schedule)} 个中文字符`,
      "3. 必须体现“正在发生”或“值得马上关注”的时效性",
      "4. 不要编造事实，信息不足时用保守措辞",
      "5. 带 1-2 个相关话题标签，不要堆砌"
    ].join("\n\n");
  }

  const topicLines = strategy.topics
    .map(
      (item) =>
        `${item.rank}. ${item.keyword} [来源:${item.sourceName}]${item.heat ? ` (热度:${item.heat})` : ""}${
          item.label ? `, 标签:${item.label}` : ""
        }`
    )
    .join("\n");
  const contextLines = strategy.contexts
    .map((topic) => `话题：${topic.keyword} [来源:${topic.sourceName}]\n${formatNewsLines(topic.news)}`)
    .join("\n\n");
  const matchLines = strategy.matchedByKeyword.length
    ? strategy.matchedByKeyword
        .map((item) => `${item.keyword} -> ${item.categoryIds.join(", ")}${item.reason ? ` (${item.reason})` : ""}`)
        .join("\n")
    : "未做板块过滤";

  const strategyHint =
    strategy.mode === "topic-source-match"
      ? "你必须优先从下面这些已命中用户板块的话题候选中选择一个来写。若多个候选都合适，优先选来源优先级更高的。"
      : "请从下面多来源候选中选择最值得发的一条来写，优先考虑来源优先级更高且信息更完整的话题。";

  return [
    `发布时间槽位：${slotTime.format("YYYY-MM-DD HH:mm")} ${config.timezone}`,
    `用户选定板块：${categoriesLine}`,
    `启用的话题来源及优先级：${sourceLine}`,
    strategyHint,
    "话题候选：",
    topicLines || "暂无话题候选",
    "板块匹配结果：",
    matchLines,
    "相关资讯摘要：",
    contextLines || "暂无补充资讯",
    `返回 JSON，结构为：${schema}`,
    "要求：",
    "1. topic 字段必须写你最终采用的话题词",
    `2. 文案控制在 ${buildCopyLengthHint(schedule)} 个中文字符，适合微博发布`,
    "3. 不能只是复述标题，要有观点或信息增量",
    "4. 不要编造事实；上下文不足时使用保守措辞",
    "5. 带 1-2 个相关话题标签，不要堆砌",
    "6. 如果有图片提示词，需要和所选话题强相关",
    "7. image_prompts 必须按图片顺序给出 1-N 条不同提示词，每张图都要有不同的主体、景别、构图或重点，不能只是同义改写"
  ].join("\n\n");
}

async function generateTextPayload(slotTime, strategy, timeoutMs, schedule) {
  if (!config.openai.apiKey) {
    throw new GenerationFailedError("未配置大模型接口，无法生成微博内容。", {
      code: "missing_api_key",
      retryable: false
    });
  }

  const prompt = buildPrompt(slotTime, strategy, schedule);
  const response = await requestTextPayload(prompt, timeoutMs);
  const content = response.data?.choices?.[0]?.message?.content || "";
  const parsed = extractJsonObject(content);
  return parseModelPayload(parsed, "微博草稿", { minCopyLength: schedule.copyMinLength, maxCopyLength: schedule.copyMaxLength });
}

async function generateImages({ copy, imageCount, imagePrompts, timeoutMs, imageWidth, imageHeight }) {
  if (!config.openai.imageApiKey || !config.openai.imageModel) {
    return [];
  }

  const perImagePrompts = buildPerImagePrompts(copy, imagePrompts, imageCount);
  const protocol = getImageProtocol();
  const size = buildImageSizeToken(imageWidth, imageHeight);

  if (protocol === "dashscope") {
    const imageResults = await Promise.all(
      perImagePrompts.map(async (promptBase) => {
        const response = await axios.post(
          `${config.openai.imageBaseUrl}/services/aigc/multimodal-generation/generation`,
          {
            model: config.openai.imageModel,
            input: {
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      text: promptBase
                    }
                  ]
                }
              ]
            },
            parameters: {
              size,
              n: 1,
              prompt_extend: true,
              watermark: false,
              negative_prompt: " "
            }
          },
          {
            headers: {
              Authorization: `Bearer ${config.openai.imageApiKey}`,
              "Content-Type": "application/json"
            },
            timeout: timeoutMs
          }
        );

        const contentItems = response.data?.output?.choices?.[0]?.message?.content || [];
        return contentItems
          .map((item) => item.image || item.url || item.image_url || null)
          .filter(Boolean);
      })
    );

    return imageResults.flat().slice(0, imageCount);
  }

  const imageResults = await Promise.all(
    perImagePrompts.map(async (promptBase) => {
      const response = await axios.post(
        `${config.openai.imageBaseUrl}/images/generations`,
        {
          model: config.openai.imageModel,
          prompt: promptBase,
          n: 1,
          size
        },
        {
          headers: {
            Authorization: `Bearer ${config.openai.imageApiKey}`,
            "Content-Type": "application/json"
          },
          timeout: timeoutMs
        }
      );

      return (response.data?.data || [])
        .map((item) => item.url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : null))
        .filter(Boolean);
    })
  );

  return imageResults.flat().slice(0, imageCount);
}

function buildRefinePrompt(draft, suggestion, options = {}) {
  const refineImages = Boolean(options.refineImages);
  const schedule = options.schedule || { copyMinLength: 200, copyMaxLength: 500 };
  const schema = refineImages && config.openai.imageModel
    ? '{"topic":"...", "copy":"...", "image_count":1-6, "image_prompts":["...", "..."]}'
    : '{"topic":"...", "copy":"..."}';
  const imageHint = refineImages
    ? (Array.isArray(draft.image_urls) && draft.image_urls.length
        ? `当前草稿已有 ${draft.image_urls.length} 张配图。本次需要同时润色图片，请结合用户建议重新设计配图，并返回新的 image_prompts。`
        : "当前草稿没有配图。本次需要为润色后的微博补生成配图，并返回新的 image_prompts。")
    : "本次只润色正文，不需要重生成图片，也不要返回 image_prompts。";

  return [
    "你将根据用户建议，对现有微博草稿做一次重新生成和润色。",
    `当前草稿正文：\n${draft.text || ""}`,
    `用户修改建议：\n${suggestion}`,
    `当前草稿来源：${draft.source || "-"}`,
    imageHint,
    `返回 JSON，结构为：${schema}`,
    "要求：",
    "1. 必须严格吸收用户建议，直接给出新的微博正文，不要解释过程",
    "2. 保留与原草稿一致的核心话题方向，除非用户明确要求改题",
    `3. 文案控制在 ${buildCopyLengthHint(schedule)} 个中文字符，适合微博发布`,
    "4. 不要出现类似【时间】来源、生成说明、提示词说明这类脏内容",
    "5. 不要编造事实；信息不确定时用保守措辞",
    "6. 带 1-2 个相关话题标签，不要堆砌",
    "7. 如果返回图片提示词，需要和新的正文强相关",
    "8. image_prompts 必须按图片顺序给出多条不同提示词，每张图都要有不同重点，不能只换几个词"
  ].join("\n\n");
}

async function generateRefinedDraftPayload({ draft, suggestion, refineImages = false }) {
  const schedule = await getScheduleSettings();

  try {
    if (!config.openai.apiKey) {
      throw new GenerationFailedError("未配置大模型接口，无法执行 AI 润色。", {
        code: "missing_api_key",
        retryable: false
      });
    }
    if (refineImages && (!config.openai.imageApiKey || !config.openai.imageModel)) {
      throw new GenerationFailedError("未配置图片模型，无法执行图片润色。", {
        code: "missing_image_config",
        retryable: false
      });
    }

    const prompt = buildRefinePrompt(draft, suggestion, { refineImages, schedule });
    const response = await requestTextPayload(prompt, schedule.llmTimeoutMs);
    const content = response.data?.choices?.[0]?.message?.content || "";
    const parsed = extractJsonObject(content);
    const textPayload = parseModelPayload(parsed, "润色后的微博正文", { minCopyLength: schedule.copyMinLength, maxCopyLength: schedule.copyMaxLength });

    let imageUrls = [];
    if (refineImages && config.openai.imageModel) {
      try {
        imageUrls = await generateImages({
          copy: textPayload.copy,
          imageCount: textPayload.imageCount,
          imagePrompts: textPayload.imagePrompts,
          timeoutMs: schedule.llmTimeoutMs,
          imageWidth: schedule.imageWidth,
          imageHeight: schedule.imageHeight
        });
      } catch (error) {
        logger.warn("llm", "refine image generation failed", {
          draftId: draft.id,
          error: error.message,
          status: error.response?.status,
          responseData: error.response?.data || null
        });
      }
    }

    logger.info("llm", "draft refined from model", {
      draftId: draft.id,
      topic: textPayload.topic,
      refineImages,
      imageCount: imageUrls.length,
      timeoutMs: schedule.llmTimeoutMs,
      imageProtocol: getImageProtocol()
    });

    return {
      copy: textPayload.copy,
      topic: textPayload.topic,
      imageUrls: imageUrls.slice(0, 6),
      source: normalizeRefineImageSourceLabel()
    };
  } catch (error) {
    logger.warn("llm", "model refinement failed", {
      draftId: draft.id,
      error: error.message,
      timeoutMs: schedule.llmTimeoutMs
    });
    throw toGenerationError(error, "大模型润色失败，未更新微博草稿。");
  }
}

async function generateDraftPayload(slotTime) {
  const schedule = await getScheduleSettings();
  let strategy;
  try {
    strategy = await decideGenerationStrategy(schedule);
  } catch (error) {
    logger.warn("topics", "topic strategy build failed", { error: error.message });
    throw toGenerationError(error, "话题检索失败，未生成微博草稿。");
  }

  if (!strategy.topics.length && !strategy.selectedCategories.length) {
    throw new GenerationFailedError("当前没有可用的话题来源结果，未生成微博草稿。", {
      code: "no_topic_candidates"
    });
  }

  try {
    const textPayload = await generateTextPayload(slotTime, strategy, schedule.llmTimeoutMs, schedule);

    let imageUrls = [];
    if (config.openai.imageModel) {
      try {
        imageUrls = await generateImages({
          copy: textPayload.copy,
          imageCount: textPayload.imageCount,
          imagePrompts: textPayload.imagePrompts,
          timeoutMs: schedule.llmTimeoutMs,
          imageWidth: schedule.imageWidth,
          imageHeight: schedule.imageHeight
        });
      } catch (error) {
        logger.warn("llm", "image generation failed", {
          error: error.message,
          status: error.response?.status,
          responseData: error.response?.data || null
        });
      }
    }

    logger.info("llm", "draft generated from model", {
      topic: textPayload.topic,
      mode: strategy.mode,
      topicCount: strategy.topics.length,
      topicSources: strategy.sourceRuns.map((item) => `${item.id}:${item.priority}`),
      selectedCategories: strategy.selectedCategories.map((item) => item.id),
      imageCount: imageUrls.length,
      timeoutMs: schedule.llmTimeoutMs,
      imageProtocol: getImageProtocol()
    });

    return {
      copy: textPayload.copy,
      topic: textPayload.topic,
      strategyMode: strategy.mode,
      selectedCategories: strategy.selectedCategories.map((item) => item.name),
      topics: strategy.topics,
      hotSearches: strategy.topics,
      topicSources: strategy.sourceRuns,
      relatedContext:
        strategy.mode === "category-freeform" ? strategy.categoryContexts || [] : strategy.contexts || [],
      imageUrls: imageUrls.slice(0, 6),
      source: normalizeImageSourceLabel()
    };
  } catch (error) {
    logger.warn("llm", "model generation failed", {
      error: error.message,
      timeoutMs: schedule.llmTimeoutMs
    });
    throw toGenerationError(error, "大模型生成失败，未生成微博草稿。");
  }
}


const DAILY_KINDNESS_PREFIX = "#每日一善[超话]# [平安果] #每日一善# [心] #阳光信用# [浮云] ";

function ensureDailyKindnessCopy(copy) {
  const body = normalizeInlineText(copy || "");
  const finalCopy = `${DAILY_KINDNESS_PREFIX}${body}`.trim();
  if (finalCopy.length < 100) {
    throw new GenerationFailedError("每日一善文案长度不足 100 字，已放弃本次生成。", {
      code: "daily_kindness_too_short"
    });
  }
  return finalCopy;
}

async function generateDailyKindnessPayload() {
  const schedule = await getScheduleSettings();
  if (!config.openai.apiKey) {
    throw new GenerationFailedError("未配置大模型接口，无法生成每日一善草稿。", {
      code: "missing_api_key",
      retryable: false
    });
  }

  const prompt = [
    "请生成一条用于微博“每日一善”超话的正能量文案。",
    "要求：",
    "1. 只写积极向上、温暖治愈、鼓励善意的正文，不要输出任何 JSON 之外的解释",
    "2. 正文不少于 110 个中文字符",
    "3. 不要输出标签、表情前缀，我会在程序里自动补固定标签",
    "4. 不要涉及热点、营销、负面新闻、争议话题",
    '返回 JSON，结构为：{"copy":"..."}'
  ].join("\n\n");

  try {
    const response = await requestTextPayload(prompt, schedule.llmTimeoutMs);
    const content = response.data?.choices?.[0]?.message?.content || "";
    const parsed = extractJsonObject(content);
    if (!parsed || !parsed.copy) {
      throw new GenerationFailedError("模型返回的每日一善文案格式无效。", {
        code: "invalid_model_payload"
      });
    }

    const copy = ensureDailyKindnessCopy(parsed.copy);
    logger.info("llm", "daily kindness draft generated from model", {
      timeoutMs: schedule.llmTimeoutMs
    });

    return {
      topic: "每日一善",
      copy,
      imageUrls: [],
      source: `llm-daily-kindness:${config.openai.textModel}`
    };
  } catch (error) {
    logger.warn("llm", "daily kindness generation failed", {
      error: error.message,
      timeoutMs: schedule.llmTimeoutMs
    });
    throw toGenerationError(error, "大模型生成每日一善草稿失败。")
  }
}

function makeReminderText(slotTime) {
  return `Draft waiting for approval before ${slotTime.format("HH:mm")} (${config.timezone}).`;
}

module.exports = {
  GenerationFailedError,
  generateDraftPayload,
  generateRefinedDraftPayload,
  generateDailyKindnessPayload,
  makeReminderText,
  now
};
