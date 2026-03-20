const axios = require("axios");
const config = require("../config");
const { now } = require("../time");
const { getScheduleSettings, buildEffectiveModelSettings } = require("./settingsService");
const { buildTopicContext } = require("./hotTopicService");
const { matchTopicCandidatesToCategories } = require("./categoryService");
const { getCategoriesByIds } = require("../contentCategories");
const logger = require("../logger");
const {
  inferTextProtocol,
  isMoonshotKimiModel,
  resolveTextTemperature,
  buildKimiThinkingPayload
} = require("./modelCompat");

class GenerationFailedError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "GenerationFailedError";
    this.code = options.code || "generation_failed";
    this.causeMessage = options.causeMessage || "";
    this.retryable = options.retryable !== false;
  }
}

const TEXT_MODEL_MAX_TOKENS = 1600;
const TEXT_MODEL_CHECK_MAX_TOKENS = 96;
const TEXT_MODEL_CHECK_MAX_TOKENS_REASONING = 256;

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveTextCheckMaxTokens(baseUrl = "", model = "", textProtocol = "") {
  if (isMoonshotKimiModel(baseUrl, model, textProtocol)) {
    return TEXT_MODEL_CHECK_MAX_TOKENS_REASONING;
  }
  return TEXT_MODEL_CHECK_MAX_TOKENS;
}

function normalizeInlineText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeCopyText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractHashtags(text) {
  return String(text || "").match(/#[^#\n\r]{1,80}#/g) || [];
}

function uniqueTags(tags = []) {
  const seen = new Set();
  return tags
    .map((tag) => normalizeInlineText(tag))
    .filter((tag) => tag.startsWith("#") && tag.endsWith("#"))
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function toWeiboHotTag(topic) {
  if (!topic || topic.sourceId !== "weibo_hot_search") {
    return "";
  }
  const keyword = normalizeInlineText(topic.keyword).replace(/^#+|#+$/g, "");
  return keyword ? `#${keyword}#` : "";
}

function findSelectedTopic(strategyTopics = [], topicName = "") {
  const normalizedTopicName = normalizeInlineText(topicName);
  if (!normalizedTopicName) {
    return strategyTopics[0] || null;
  }
  return strategyTopics.find((topic) => normalizeInlineText(topic.keyword) === normalizedTopicName)
    || strategyTopics.find((topic) => normalizedTopicName.includes(normalizeInlineText(topic.keyword)))
    || strategyTopics.find((topic) => normalizeInlineText(topic.keyword).includes(normalizedTopicName))
    || strategyTopics[0]
    || null;
}

function moveTagsToFront(copy, selectedTopic = null) {
  const topicTag = toWeiboHotTag(selectedTopic);
  const inlineTags = extractHashtags(copy);
  const tags = uniqueTags([topicTag, ...inlineTags]);
  const body = normalizeCopyText(String(copy || "").replace(/#[^#\n\r]{1,80}#/g, " "));
  if (!tags.length) {
    return body;
  }
  return body ? `${tags.join(" ")}\n${body}` : tags.join(" ");
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

function extractAssistantContent(responseData) {
  const choice = responseData?.choices?.[0] || {};
  const message = choice.message || {};
  if (typeof message.content === "string") {
    return message.content.trim();
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (typeof item?.text === "string") {
          return item.text;
        }
        if (typeof item?.content === "string") {
          return item.content;
        }
        return "";
      })
      .join("")
      .trim();
  }
  if (typeof choice.text === "string") {
    return choice.text.trim();
  }
  return "";
}

function extractAssistantReasoning(responseData) {
  const choice = responseData?.choices?.[0] || {};
  const message = choice.message || {};
  const reasoning = [];
  if (typeof message.reasoning_content === "string") {
    reasoning.push(message.reasoning_content);
  }
  if (Array.isArray(message.reasoning_content)) {
    reasoning.push(
      message.reasoning_content
        .map((item) => (typeof item === "string" ? item : String(item?.text || item?.content || "")))
        .join("")
    );
  }
  return reasoning.join("").trim();
}

function getProviderErrorMessage(error) {
  const providerMessage = error?.response?.data?.error?.message
    || error?.response?.data?.message
    || error?.response?.data?.error_description
    || "";
  return String(providerMessage || error?.message || "request_failed").trim();
}

function ensureChatCompletionResponse(response, contextLabel = "文本模型") {
  const contentType = String(response?.headers?.["content-type"] || "").toLowerCase();
  if (contentType.includes("text/html")) {
    throw new GenerationFailedError(`${contextLabel}接口返回了 HTML 页面，当前 Base URL 很可能填成了网站首页而不是 API 地址。`, {
      code: "invalid_text_model_base_url",
      retryable: false,
      causeMessage: typeof response?.data === "string" ? response.data.slice(0, 160) : ""
    });
  }
  if (!response || !response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    throw new GenerationFailedError(`${contextLabel}接口返回了非标准 JSON 响应，当前 Base URL 或网关协议不兼容。`, {
      code: "invalid_text_model_response",
      retryable: false,
      causeMessage: typeof response?.data === "string" ? response.data.slice(0, 160) : ""
    });
  }
  return response;
}

function formatNewsLines(news = []) {
  if (!news.length) {
    return "暂无补充资讯";
  }
  return news
    .map((item, index) => `${index + 1}) ${item.title}${item.pubDate ? ` | ${item.pubDate}` : ""}`)
    .join("\n");
}


function normalizeCheckModelSettings(modelSettingsInput = {}) {
  const effective = buildEffectiveModelSettings(modelSettingsInput);
  return {
    textApiKey: effective.textApiKey,
    textBaseUrl: effective.textBaseUrl,
    textProtocol: effective.textProtocol,
    textModel: effective.textModel,
    kimiThinkingEnabled: effective.kimiThinkingEnabled,
    imageApiKey: effective.imageApiKey,
    imageBaseUrl: effective.imageBaseUrl,
    imageProtocol: effective.imageProtocol,
    imageModel: effective.imageModel
  };
}

async function checkTextModelAvailability(modelSettingsInput = {}) {
  const modelSettings = normalizeCheckModelSettings(modelSettingsInput);
  if (!modelSettings.textApiKey || !modelSettings.textModel || !modelSettings.textBaseUrl) {
    throw new GenerationFailedError("文本模型配置不完整，无法检查可用性。", {
      code: "missing_text_model_config",
      retryable: false
    });
  }

  const basePayload = {
    model: modelSettings.textModel,
    temperature: resolveTextTemperature(modelSettings.textBaseUrl, modelSettings.textModel, modelSettings.textProtocol, 0, modelSettings.kimiThinkingEnabled),
    max_tokens: resolveTextCheckMaxTokens(modelSettings.textBaseUrl, modelSettings.textModel, modelSettings.textProtocol),
    ...buildKimiThinkingPayload({
      baseUrl: modelSettings.textBaseUrl,
      model: modelSettings.textModel,
      textProtocol: modelSettings.textProtocol,
      kimiThinkingEnabled: modelSettings.kimiThinkingEnabled
    }),
    messages: [
      {
        role: "system",
        content: "你只能返回合法 JSON，不要输出解释、推理过程或多余文本。"
      },
      {
        role: "user",
        content: '返回 JSON：{"ok":true,"message":"pong"}'
      }
    ]
  };

  async function send(payload) {
    return axios.post(
      `${modelSettings.textBaseUrl}/chat/completions`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${modelSettings.textApiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 20000
      }
    );
  }

  let response;
  let mode = "json_object";
  try {
    response = ensureChatCompletionResponse(await send({
      ...basePayload,
      response_format: { type: "json_object" }
    }), "文本模型");
    if (!extractAssistantContent(response.data)) {
      mode = "plain_json";
      response = ensureChatCompletionResponse(await send(basePayload), "文本模型");
    }
  } catch (error) {
    const status = error.response?.status;
    if (status === 400 || status === 422) {
      mode = "plain_json";
      response = ensureChatCompletionResponse(await send(basePayload), "文本模型");
    } else {
      throw new GenerationFailedError(getProviderErrorMessage(error), {
        code: error?.response?.data?.error?.code || "text_model_check_failed",
        retryable: false,
        causeMessage: getProviderErrorMessage(error)
      });
    }
  }

  const content = extractAssistantContent(response.data);
  const reasoning = extractAssistantReasoning(response.data);
  const parsed = extractJsonObject(content);
  if (!content || !parsed || parsed.ok !== true) {
    const finishReason = response?.data?.choices?.[0]?.finish_reason || "";
    if (!content && reasoning && finishReason === "length") {
      throw new GenerationFailedError("文本模型检测只返回了推理内容，未在限制内产出最终 JSON；请调大检测 token 上限或改用非推理型模型。", {
        code: "text_model_check_truncated",
        retryable: false
      });
    }
    throw new GenerationFailedError("文本模型检测未返回可解析的 JSON 内容，当前模型不兼容生成链路。", {
      code: "text_model_incompatible",
      retryable: false
    });
  }

  return {
    available: true,
    provider: modelSettings.textBaseUrl,
    model: modelSettings.textModel,
    mode,
    content,
    reasoningLength: reasoning.length
  };
}

async function checkImageModelAvailability(modelSettingsInput = {}) {
  const modelSettings = normalizeCheckModelSettings(modelSettingsInput);
  if (!modelSettings.imageApiKey || !modelSettings.imageModel || !modelSettings.imageBaseUrl) {
    throw new GenerationFailedError("图片模型配置不完整，无法检查可用性。", {
      code: "missing_image_model_config",
      retryable: false
    });
  }

  if (String(modelSettings.imageProtocol || "openai").toLowerCase() === "dashscope") {
    const response = await axios.post(
      `${modelSettings.imageBaseUrl}/services/aigc/multimodal-generation/generation`,
      {
        model: modelSettings.imageModel,
        input: {
          messages: [
            {
              role: "user",
              content: [{ text: "生成一张极简抽象测试图片，白底，单个几何图形。" }]
            }
          ]
        },
        parameters: {
          size: "512*512",
          n: 1,
          prompt_extend: true,
          watermark: false,
          negative_prompt: " "
        }
      },
      {
        headers: {
          Authorization: `Bearer ${modelSettings.imageApiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    const contentItems = response.data?.output?.choices?.[0]?.message?.content || [];
    const hasImage = contentItems.some((item) => item.image || item.url || item.image_url);
    if (!hasImage) {
      throw new GenerationFailedError("图片模型检查未返回有效图片。", {
        code: "image_check_failed"
      });
    }

    return {
      available: true,
      protocol: modelSettings.imageProtocol,
      provider: modelSettings.imageBaseUrl,
      model: modelSettings.imageModel
    };
  }

  const response = await axios.post(
    `${modelSettings.imageBaseUrl}/images/generations`,
    {
      model: modelSettings.imageModel,
      prompt: "A minimal abstract test image on white background with one geometric shape.",
      n: 1,
      size: "512x512"
    },
    {
      headers: {
        Authorization: `Bearer ${modelSettings.imageApiKey}`,
        "Content-Type": "application/json"
      },
      timeout: 30000
    }
  );

  const hasImage = Array.isArray(response.data?.data) && response.data.data.some((item) => item.url || item.b64_json);
  if (!hasImage) {
    throw new GenerationFailedError("图片模型检查未返回有效图片。", {
      code: "image_check_failed"
    });
  }

  return {
    available: true,
    protocol: modelSettings.imageProtocol,
    provider: modelSettings.imageBaseUrl,
    model: modelSettings.imageModel
  };
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

const RIGOROUS_CATEGORY_IDS = new Set(["technology", "finance", "education", "health", "military", "international", "auto"]);
const CASUAL_CATEGORY_IDS = new Set(["entertainment", "sports", "gaming", "lifestyle"]);

function buildNumberedRules(start, rules) {
  return rules.map((rule, index) => `${start + index}. ${rule}`);
}

function buildVoiceStyleRules(selectedCategories = []) {
  const selectedIds = selectedCategories.map((item) => item.id);
  const hasRigorous = selectedIds.some((id) => RIGOROUS_CATEGORY_IDS.has(id));
  const hasCasual = selectedIds.some((id) => CASUAL_CATEGORY_IDS.has(id));
  const rules = [
    '必须以“我”的视角写，像真人博主在表达观察、判断和取舍，不要写成新闻播报、通稿或公文口吻',
    '要有信息密度和个人判断，但表达自然，不要堆术语，也不要空泛抒情',
    '正文尽量分成 2-4 个短段落，每段 1-3 句，符合正常用户发微博的阅读节奏，不要写成一整块大段',
    '可以少量使用 1-3 个贴合语气的 emoji 点缀，但不要每句都带，也不要靠 emoji 撑气氛',
    '非必要不要频繁给普通名词、观点或情绪加引号，尤其不要反复出现“这种词”“那种词”的写法'
  ];

  if (hasRigorous && !hasCasual) {
    rules.push('这类偏严谨的话题要专业克制，信息要准确，结论要有边界，不确定内容明确用保守措辞，但也可以有一两句轻巧的人味表达，别板着脸说话');
  } else if (hasCasual && !hasRigorous) {
    rules.push('这类偏生活或娱乐的话题可以自然、轻松、略带幽默，允许适度抖机灵，但不要油腻玩梗，更不要为了活泼牺牲信息量');
  } else {
    rules.push('如果话题偏科技、教育、健康等严谨领域，就专业克制并保留一点人味；如果偏生活、娱乐等轻松领域，可以自然幽默、适度抖机灵，但都要保证信息量和判断力');
  }

  rules.push('可以有一两句自然的小机灵、小反差或轻微吐槽，但要像真人顺手带出来，不要为了段子感牺牲信息和可信度');
  rules.push('不要在结尾引导点赞、评论、转发、关注，也不要写“你怎么看”“欢迎留言”等互动钩子');
  return rules;
}

function shouldRetryStructuredContent(error) {
  if (!(error instanceof GenerationFailedError)) {
    return false;
  }
  return [
    "invalid_model_payload",
    "copy_too_short",
    "copy_too_long",
    "copy_not_segmented",
    "copy_too_many_quoted_terms"
  ].includes(error.code);
}

function buildTextRetryDelayMs(attempt) {
  const base = 1200;
  const jitter = Math.floor(Math.random() * 300);
  return base * attempt + jitter;
}

function parseModelPayload(parsed, contextLabel = "微博草稿", options = {}) {
  if (!parsed || !parsed.copy) {
    throw new GenerationFailedError(`模型返回${contextLabel}格式无效，无法继续。`, {
      code: "invalid_model_payload"
    });
  }

  const minCopyLength = Number.isInteger(options.minCopyLength) ? options.minCopyLength : 60;
  const maxCopyLength = Number.isInteger(options.maxCopyLength) ? options.maxCopyLength : null;
  const copy = normalizeCopyText(parsed.copy || "");
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

  const paragraphCount = copy.split("\n").filter(Boolean).length;
  if (copy.length >= 160 && paragraphCount < 2) {
    throw new GenerationFailedError(`模型返回${contextLabel}没有分段，不符合微博阅读习惯。`, {
      code: "copy_not_segmented"
    });
  }

  const quotedTerms = copy.match(/“[^”]{1,12}”/g) || [];
  if (quotedTerms.length > 3) {
    throw new GenerationFailedError(`模型返回${contextLabel}引号词过多，看起来不像自然表达。`, {
      code: "copy_too_many_quoted_terms"
    });
  }

  return {
    topic: normalizeInlineText(parsed.topic || ""),
    copy,
    imageCount: clamp(Number(parsed.image_count || 1), 1, 9),
    imagePrompts: Array.isArray(parsed.image_prompts)
      ? parsed.image_prompts.map((item) => normalizeInlineText(item)).filter(Boolean).slice(0, 9)
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
  const providerMessage = getProviderErrorMessage(error);
  return new GenerationFailedError(providerMessage === fallbackMessage ? fallbackMessage : `${fallbackMessage} 原因：${providerMessage}`, {
    code: "generation_failed",
    causeMessage: providerMessage || fallbackMessage
  });
}


function buildImageRetryDelayMs(attempt) {
  const base = 1500;
  const jitter = Math.floor(Math.random() * 400);
  return base * (2 ** Math.max(0, attempt - 1)) + jitter;
}

function isRetriableImageError(error) {
  const status = Number(error?.response?.status || 0);
  if (isTimeoutError(error)) {
    return true;
  }
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function withImageRetry(task, meta = {}) {
  const maxAttempts = 3;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!isRetriableImageError(error) || attempt >= maxAttempts) {
        throw error;
      }
      const delayMs = buildImageRetryDelayMs(attempt);
      logger.warn("llm", "image request retry scheduled", {
        attempt,
        maxAttempts,
        delayMs,
        status: error.response?.status,
        error: error.message,
        ...meta
      });
      await sleep(delayMs);
    }
  }
  throw lastError;
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
    temperature: resolveTextTemperature(
      config.openai.baseUrl,
      config.openai.textModel,
      inferTextProtocol(config.openai.baseUrl, config.openai.textModel, config.openai.textProtocol),
      1,
      config.openai.kimiThinkingEnabled
    ),
    max_tokens: TEXT_MODEL_MAX_TOKENS,
    ...buildKimiThinkingPayload({
      baseUrl: config.openai.baseUrl,
      model: config.openai.textModel,
      textProtocol: config.openai.textProtocol,
      kimiThinkingEnabled: config.openai.kimiThinkingEnabled
    }),
    messages: [
      {
        role: "system",
        content: "你是微博运营编辑，只能返回合法 JSON，不要输出多余解释。"
      },
      { role: "user", content: prompt }
    ]
  };

  async function send(payload) {
    return postChatCompletion(payload, timeoutMs);
  }

  try {
    const structuredResponse = ensureChatCompletionResponse(await send({
      ...basePayload,
      response_format: { type: "json_object" }
    }), "文本生成模型");
    const structuredContent = extractAssistantContent(structuredResponse.data);
    if (structuredContent) {
      return structuredResponse;
    }

    logger.warn("llm", "empty model content with structured response, retrying without response_format", {
      timeoutMs,
      model: config.openai.textModel,
      reasoningLength: extractAssistantReasoning(structuredResponse.data).length
    });
    return ensureChatCompletionResponse(await send(basePayload), "文本生成模型");
  } catch (error) {
    const status = error.response?.status;
    if (status === 429) {
      logger.warn("llm", "rate limited, retrying text generation", { status });
      await sleep(3000);
      return ensureChatCompletionResponse(await send(basePayload), "文本生成模型");
    }
    if (status === 400 || status === 422) {
      return ensureChatCompletionResponse(await send(basePayload), "文本生成模型");
    }
    throw error;
  }
}

function pickRandomTopic(topics = []) {
  if (!topics.length) {
    return null;
  }
  const index = Math.floor(Math.random() * topics.length);
  return topics[index] || topics[0] || null;
}

async function decideGenerationStrategy(schedule) {
  const selectedCategories = getCategoriesByIds(schedule.contentCategoryIds);
  const topicContext = await buildTopicContext({
    topicSources: schedule.topicSources,
    topicLimit: schedule.hotSearchCount,
    schedule
  });

  if (!topicContext.topics.length) {
    return {
      mode: selectedCategories.length ? "topic-source-match" : "topic-source-open",
      selectedCategories,
      candidateTopics: [],
      selectedTopic: null,
      topics: [],
      contexts: [],
      sourceRuns: topicContext.sourceRuns,
      matchedByKeyword: []
    };
  }

  if (!selectedCategories.length) {
    const selectedTopic = pickRandomTopic(topicContext.topics);
    return {
      mode: "topic-source-open",
      selectedCategories,
      candidateTopics: topicContext.topics,
      selectedTopic,
      topics: selectedTopic ? [selectedTopic] : [],
      contexts: selectedTopic
        ? topicContext.contexts.filter((item) => item.keyword === selectedTopic.keyword)
        : [],
      sourceRuns: topicContext.sourceRuns,
      matchedByKeyword: []
    };
  }

  const matchResult = await matchTopicCandidatesToCategories(
    topicContext.topics,
    schedule.contentCategoryIds
  );

  const selectedTopic = pickRandomTopic(matchResult.matchedTopics);
  return {
    mode: "topic-source-match",
    selectedCategories,
    candidateTopics: matchResult.matchedTopics,
    selectedTopic,
    topics: selectedTopic ? [selectedTopic] : [],
    contexts: selectedTopic
      ? topicContext.contexts.filter((item) => item.keyword === selectedTopic.keyword)
      : [],
    sourceRuns: topicContext.sourceRuns,
    allTopics: topicContext.topics,
    matchedByKeyword: matchResult.matchedByKeyword
  };
}

function buildPrompt(slotTime, strategy, schedule, retryContext = null) {
  const categoriesLine = strategy.selectedCategories.length
    ? strategy.selectedCategories.map((item) => `${item.name}(${item.description})`).join("；")
    : "未限制板块";
  const sourceLine = buildSourceSummary(strategy);
  const schema = config.openai.imageModel
    ? `{"topic":"...", "copy":"...", "image_count":1-${schedule.maxImageCount}, "image_prompts":["...", "..."]}`
    : '{"topic":"...", "copy":"..."}';
  const selectedTopic = strategy.selectedTopic || strategy.topics[0] || null;
  const selectedContext = strategy.contexts[0] || null;
  const selectedTopicLine = selectedTopic
    ? `${selectedTopic.keyword} [来源:${selectedTopic.sourceName}]${selectedTopic.heat ? ` (热度:${selectedTopic.heat})` : ""}${selectedTopic.label ? `, 标签:${selectedTopic.label}` : ""}`
    : "无";
  const selectedContextLine = selectedContext
    ? `话题：${selectedContext.keyword} [来源:${selectedContext.sourceName}]\n${formatNewsLines(selectedContext.news)}`
    : "暂无补充资讯";
  const matchLines = strategy.matchedByKeyword.length
    ? strategy.matchedByKeyword
        .map((item) => `${item.keyword} -> ${item.categoryIds.join(", ")}${item.reason ? ` (${item.reason})` : ""}`)
        .join("\n")
    : (strategy.selectedCategories.length ? "未命中任何板块" : "未做板块过滤");

  return [
    `发布时间槽位：${slotTime.format("YYYY-MM-DD HH:mm")} ${config.timezone}`,
    `用户选定板块：${categoriesLine}`,
    `启用的话题来源及优先级：${sourceLine}`,
    retryContext ? `上一次生成未通过：${retryContext.reason}。这一次必须严格修正。` : null,
    `已保留 ${strategy.candidateTopics?.length || 0} 个符合主题的词条，本次随机选中这 1 个词条来写，禁止切换到其他词条或自由发挥。`,
    "本次唯一允许使用的词条：",
    selectedTopicLine,
    "板块匹配结果：",
    matchLines,
    "该词条相关资讯：",
    selectedContextLine,
    `返回 JSON，结构为：${schema}`,
    "要求：",
    "1. topic 字段必须写本次选中的词条原文，不能改成别的主题",
    `2. 文案控制在 ${buildCopyLengthHint(schedule)} 个中文字符，适合微博发布`,
    "3. 正文只能围绕这个词条展开，不能跳到其他热点，也不能泛泛而谈",
    "4. 不能只是复述标题，要有观点或信息增量",
    "5. 不要编造事实；上下文不足时使用保守措辞",
    "6. 带 1-2 个相关话题标签，不要堆砌",
    "7. 如果有图片提示词，需要和所选词条强相关",
    "8. image_prompts 必须按图片顺序给出 1-N 条不同提示词，每张图都要有不同的主体、景别、构图或重点，不能只是同义改写",
    ...buildNumberedRules(9, buildVoiceStyleRules(strategy.selectedCategories))
  ].filter(Boolean).join("\n\n");
}

async function generateTextPayload(slotTime, strategy, timeoutMs, schedule) {
  if (!config.openai.apiKey) {
    throw new GenerationFailedError("未配置大模型接口，无法生成微博内容。", {
      code: "missing_api_key",
      retryable: false
    });
  }

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const prompt = buildPrompt(
        slotTime,
        strategy,
        schedule,
        lastError ? { attempt, reason: lastError.message } : null
      );
      logger.debug("llm", "draft generation prompt", {
        attempt,
        timeoutMs,
        prompt
      });
      const response = await requestTextPayload(prompt, timeoutMs);
      const content = extractAssistantContent(response.data);
      logger.debug("llm", "draft generation response", {
        attempt,
        content
      });
      const parsed = extractJsonObject(content);
      return parseModelPayload(parsed, "微博草稿", {
        minCopyLength: schedule.copyMinLength,
        maxCopyLength: schedule.copyMaxLength
      });
    } catch (error) {
      if (attempt >= 3 || !shouldRetryStructuredContent(error)) {
        throw error;
      }
      lastError = error;
      const delayMs = buildTextRetryDelayMs(attempt);
      logger.warn("llm", "retrying text generation after content validation failure", {
        attempt,
        delayMs,
        error: error.message,
        code: error.code || "generation_failed"
      });
      await sleep(delayMs);
    }
  }

  throw lastError || new GenerationFailedError("大模型生成失败，未生成微博草稿。");
}

async function generateImages({ copy, imageCount, imagePrompts, timeoutMs, imageWidth, imageHeight }) {
  const targetImageCount = clamp(Number(imageCount || 1), 1, 9);
  if (!config.openai.imageApiKey || !config.openai.imageModel) {
    return [];
  }

  const perImagePrompts = buildPerImagePrompts(copy, imagePrompts, targetImageCount);
  const protocol = getImageProtocol();
  const size = buildImageSizeToken(imageWidth, imageHeight);

  if (protocol === "dashscope") {
    const imageResults = await Promise.all(
      perImagePrompts.map(async (promptBase, index) => {
        const response = await withImageRetry(() => axios.post(
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
        ), { imageIndex: index + 1, protocol, model: config.openai.imageModel });

        const contentItems = response.data?.output?.choices?.[0]?.message?.content || [];
        return contentItems
          .map((item) => item.image || item.url || item.image_url || null)
          .filter(Boolean);
      })
    );

    return imageResults.flat().slice(0, targetImageCount);
  }

  const imageResults = await Promise.all(
    perImagePrompts.map(async (promptBase, index) => {
      const response = await withImageRetry(() => axios.post(
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
      ), { imageIndex: index + 1, protocol, model: config.openai.imageModel });

      return (response.data?.data || [])
        .map((item) => item.url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : null))
        .filter(Boolean);
    })
  );

  return imageResults.flat().slice(0, targetImageCount);
}

function buildRefinePrompt(draft, suggestion, options = {}) {
  const refineImages = Boolean(options.refineImages);
  const schedule = options.schedule || { copyMinLength: 200, copyMaxLength: 500 };
  const selectedCategories = Array.isArray(options.selectedCategories) ? options.selectedCategories : [];
  const retryContext = options.retryContext || null;
  const schema = refineImages && config.openai.imageModel
    ? `{"topic":"...", "copy":"...", "image_count":1-${schedule.maxImageCount}, "image_prompts":["...", "..."]}`
    : '{"topic":"...", "copy":"..."}';
  const imageHint = refineImages
    ? (Array.isArray(draft.image_urls) && draft.image_urls.length
        ? `当前草稿已有 ${draft.image_urls.length} 张配图。本次需要同时润色图片，请结合用户建议重新设计配图，并返回新的 image_prompts。`
        : "当前草稿没有配图。本次需要为润色后的微博补生成配图，并返回新的 image_prompts。")
    : "本次只润色正文，不需要重生成图片，也不要返回 image_prompts。";

  return [
    "你将根据用户建议，对现有微博草稿做一次重新生成和润色。",
    retryContext ? `上一次润色未通过：${retryContext.reason}。这一次必须严格修正。` : null,
    `当前草稿正文：
${draft.text || ""}`,
    `用户修改建议：
${suggestion}`,
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
    "8. image_prompts 必须按图片顺序给出多条不同提示词，每张图都要有不同重点，不能只换几个词",
    ...buildNumberedRules(9, buildVoiceStyleRules(selectedCategories))
  ].filter(Boolean).join("\n\n");
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

    const selectedCategories = getCategoriesByIds(schedule.contentCategoryIds);
    let lastError = null;
    let textPayload;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const prompt = buildRefinePrompt(draft, suggestion, {
          refineImages,
          schedule,
          selectedCategories,
          retryContext: lastError ? { attempt, reason: lastError.message } : null
        });
        logger.debug("llm", "draft refine prompt", {
          draftId: draft.id,
          attempt,
          refineImages,
          timeoutMs: schedule.llmTimeoutMs,
          prompt
        });
        const response = await requestTextPayload(prompt, schedule.llmTimeoutMs);
        const content = extractAssistantContent(response.data);
        logger.debug("llm", "draft refine response", {
          draftId: draft.id,
          attempt,
          content
        });
        const parsed = extractJsonObject(content);
        textPayload = parseModelPayload(parsed, "润色后的微博正文", {
          minCopyLength: schedule.copyMinLength,
          maxCopyLength: schedule.copyMaxLength
        });
        break;
      } catch (error) {
        if (attempt >= 3 || !shouldRetryStructuredContent(error)) {
          throw error;
        }
        lastError = error;
        const delayMs = buildTextRetryDelayMs(attempt);
        logger.warn("llm", "retrying draft refinement after content validation failure", {
          draftId: draft.id,
          attempt,
          delayMs,
          error: error.message,
          code: error.code || "generation_failed"
        });
        await sleep(delayMs);
      }
    }

    const normalizedCopy = moveTagsToFront(textPayload.copy);
    logger.debug("llm", "refined draft normalized tags", {
      draftId: draft.id,
      copy: normalizedCopy
    });

    let imageUrls = [];
    if (refineImages && config.openai.imageModel) {
      try {
        imageUrls = await generateImages({
          copy: normalizedCopy,
          imageCount: Math.min(textPayload.imageCount, schedule.maxImageCount),
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
      copy: normalizedCopy,
      topic: textPayload.topic,
      imageUrls: imageUrls.slice(0, 9),
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

  if (!strategy.candidateTopics?.length) {
    throw new GenerationFailedError("当前没有抓到任何可用词条，未生成微博草稿。", {
      code: "no_topic_candidates",
      retryable: false
    });
  }

  if (!strategy.selectedTopic) {
    throw new GenerationFailedError("当前没有符合主题的词条，未生成微博草稿。", {
      code: "no_matching_topics",
      retryable: false
    });
  }

  try {
    const textPayload = await generateTextPayload(slotTime, strategy, schedule.llmTimeoutMs, schedule);
    const selectedTopic = findSelectedTopic(strategy.topics, textPayload.topic);
    const normalizedCopy = moveTagsToFront(textPayload.copy, selectedTopic);
    logger.debug("llm", "draft normalized tags", {
      topic: textPayload.topic,
      selectedTopic: selectedTopic
        ? {
            keyword: selectedTopic.keyword,
            label: selectedTopic.label,
            sourceId: selectedTopic.sourceId,
            sourceName: selectedTopic.sourceName
          }
        : null,
      copy: normalizedCopy
    });

    let imageUrls = [];
    if (config.openai.imageModel) {
      try {
        imageUrls = await generateImages({
          copy: normalizedCopy,
          imageCount: Math.min(textPayload.imageCount, schedule.maxImageCount),
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
      copy: normalizedCopy,
      topic: textPayload.topic,
      strategyMode: strategy.mode,
      selectedCategories: strategy.selectedCategories.map((item) => item.name),
      topics: strategy.topics,
      hotSearches: strategy.topics,
      topicSources: strategy.sourceRuns,
      relatedContext:
        strategy.mode === "category-freeform" ? strategy.categoryContexts || [] : strategy.contexts || [],
      imageUrls: imageUrls.slice(0, 9),
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
  const body = normalizeCopyText(copy || "");
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
    logger.debug("llm", "daily kindness prompt", {
      timeoutMs: schedule.llmTimeoutMs,
      prompt
    });
    const response = await requestTextPayload(prompt, schedule.llmTimeoutMs);
    const content = extractAssistantContent(response.data);
    logger.debug("llm", "daily kindness response", {
      content
    });
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
  checkTextModelAvailability,
  checkImageModelAvailability,
  makeReminderText,
  now
};
