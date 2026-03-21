const config = require("../config");
const { getDb } = require("../db");
const { now, dayjs } = require("../time");
const logger = require("../logger");
const { COMMON_CATEGORIES, getCategoriesByIds } = require("../contentCategories");
const {
  TOPIC_SOURCES,
  getDefaultTopicSourceConfigs,
  normalizeTopicSourceConfigs,
  getTopicSourceById
} = require("../topicSources");
const { inferTextProtocol, normalizeTextProtocol } = require("./modelCompat");
const { COPY_STYLE_OPTIONS, getCopyStyleById } = require("../copyStyles");


const DEFAULT_MODEL_SETTINGS = {
  textApiKey: config.openai.apiKey,
  textBaseUrl: config.openai.baseUrl,
  textProtocol: config.openai.textProtocol,
  textModel: config.openai.textModel,
  kimiThinkingEnabled: config.openai.kimiThinkingEnabled,
  imageApiKey: process.env.OPENAI_IMAGE_API_KEY !== undefined
    ? process.env.OPENAI_IMAGE_API_KEY
    : config.openai.imageApiKey,
  imageBaseUrl: process.env.OPENAI_IMAGE_BASE_URL !== undefined
    ? process.env.OPENAI_IMAGE_BASE_URL
    : config.openai.imageBaseUrl,
  imageProtocol: config.openai.imageProtocol,
  imageModel: process.env.OPENAI_IMAGE_MODEL === undefined ? "gpt-image-1" : (process.env.OPENAI_IMAGE_MODEL || "")
};

function normalizeModelSettings(input = {}) {
  const textApiKey = String(
    input.textApiKey === undefined ? DEFAULT_MODEL_SETTINGS.textApiKey : input.textApiKey
  ).trim();
  const textBaseUrl = String(
    input.textBaseUrl === undefined ? DEFAULT_MODEL_SETTINGS.textBaseUrl : input.textBaseUrl
  ).trim();
  const textProtocol = inferTextProtocol(
    textBaseUrl,
    input.textModel === undefined ? DEFAULT_MODEL_SETTINGS.textModel : input.textModel,
    input.textProtocol === undefined ? DEFAULT_MODEL_SETTINGS.textProtocol : input.textProtocol
  );
  const textModel = String(
    input.textModel === undefined ? DEFAULT_MODEL_SETTINGS.textModel : input.textModel
  ).trim();
  const kimiThinkingEnabled = input.kimiThinkingEnabled === undefined
    ? Boolean(DEFAULT_MODEL_SETTINGS.kimiThinkingEnabled)
    : Boolean(input.kimiThinkingEnabled);
  const imageApiKey = String(
    input.imageApiKey === undefined ? DEFAULT_MODEL_SETTINGS.imageApiKey : input.imageApiKey
  ).trim();
  const imageBaseUrl = String(
    input.imageBaseUrl === undefined ? DEFAULT_MODEL_SETTINGS.imageBaseUrl : input.imageBaseUrl
  ).trim();
  const imageProtocol = String(
    input.imageProtocol === undefined ? DEFAULT_MODEL_SETTINGS.imageProtocol : input.imageProtocol
  ).trim().toLowerCase() || "openai";
  const imageModel = String(
    input.imageModel === undefined ? DEFAULT_MODEL_SETTINGS.imageModel : input.imageModel
  ).trim();

  if (textBaseUrl && !/^https?:\/\//i.test(textBaseUrl)) {
    throw new Error("textBaseUrl must start with http:// or https://.");
  }
  if (imageBaseUrl && !/^https?:\/\//i.test(imageBaseUrl)) {
    throw new Error("imageBaseUrl must start with http:// or https://.");
  }
  if (!["openai", "moonshot"].includes(normalizeTextProtocol(textProtocol))) {
    throw new Error("textProtocol must be one of: openai, moonshot.");
  }
  if (!["openai", "dashscope"].includes(imageProtocol)) {
    throw new Error("imageProtocol must be one of: openai, dashscope.");
  }

  return {
    textApiKey,
    textBaseUrl,
    textProtocol,
    textModel,
    kimiThinkingEnabled,
    imageApiKey,
    imageBaseUrl,
    imageProtocol,
    imageModel
  };
}

function buildEffectiveModelSettings(input = {}) {
  const normalized = normalizeModelSettings(input);
  const textApiKey = normalized.textApiKey || DEFAULT_MODEL_SETTINGS.textApiKey || "";
  const textBaseUrl = normalized.textBaseUrl || DEFAULT_MODEL_SETTINGS.textBaseUrl || "https://api.openai.com/v1";
  const textModel = normalized.textModel || DEFAULT_MODEL_SETTINGS.textModel || "gpt-4o-mini";
  const textProtocol = inferTextProtocol(textBaseUrl, textModel, normalized.textProtocol || DEFAULT_MODEL_SETTINGS.textProtocol || "openai");
  const kimiThinkingEnabled = normalized.kimiThinkingEnabled !== false;
  const imageProtocol = normalized.imageProtocol || DEFAULT_MODEL_SETTINGS.imageProtocol || "openai";
  const imageApiKey = normalized.imageApiKey || textApiKey;
  const imageBaseUrl = normalized.imageBaseUrl || (imageProtocol === "dashscope"
    ? "https://dashscope.aliyuncs.com/api/v1"
    : textBaseUrl);
  const imageModel = normalized.imageModel;

  return {
    textApiKey,
    textBaseUrl,
    textProtocol,
    textModel,
    kimiThinkingEnabled,
    imageApiKey,
    imageBaseUrl,
    imageProtocol,
    imageModel
  };
}


function applyModelSettingsToRuntime(modelSettings) {
  const effective = buildEffectiveModelSettings(modelSettings);
  config.openai.apiKey = effective.textApiKey;
  config.openai.baseUrl = effective.textBaseUrl;
  config.openai.textProtocol = effective.textProtocol;
  config.openai.textModel = effective.textModel;
  config.openai.kimiThinkingEnabled = effective.kimiThinkingEnabled;
  config.openai.imageApiKey = effective.imageApiKey;
  config.openai.imageBaseUrl = effective.imageBaseUrl;
  config.openai.imageProtocol = effective.imageProtocol;
  config.openai.imageModel = effective.imageModel;
  return effective;
}

const DEFAULT_SCHEDULE = {
  enabled: true,
  publishStartHour: 8,
  publishEndHour: 24,
  generateLeadMinutes: 10,
  reminderLeadMinutes: 5,
  hotSearchCount: 20,
  googleNewsTopicCount: 10,
  weiboHotSearchStartRank: 1,
  weiboHotSearchEndRank: 20,
  notificationPushEnabled: true,
  copyStyle: "balanced",
  copyMinLength: 200,
  copyMaxLength: 500,
  llmTimeoutMs: config.openai.requestTimeoutMs,
  categoryTimeoutMs: 45000,
  imageWidth: config.openai.imageWidth,
  imageHeight: config.openai.imageHeight,
  maxImageCount: 3,
  contentCategoryIds: [],
  topicSources: getDefaultTopicSourceConfigs()
};

function parseInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function validateTopicSources(topicSources) {
  const ids = new Set();
  topicSources.forEach((item) => {
    if (!getTopicSourceById(item.id)) {
      throw new Error(`unknown topic source id: ${item.id}`);
    }
    if (ids.has(item.id)) {
      throw new Error(`duplicate topic source id: ${item.id}`);
    }
    ids.add(item.id);
    if (!Number.isInteger(item.priority) || item.priority < 1 || item.priority > 999) {
      throw new Error(`invalid priority for topic source: ${item.id}`);
    }
  });
}

function normalizeSchedule(input = {}) {
  const enabled = input.enabled === undefined ? DEFAULT_SCHEDULE.enabled : Boolean(input.enabled);
  const publishStartHour = parseInteger(input.publishStartHour, DEFAULT_SCHEDULE.publishStartHour);
  const publishEndHour = parseInteger(input.publishEndHour, DEFAULT_SCHEDULE.publishEndHour);
  const generateLeadMinutes = parseInteger(
    input.generateLeadMinutes,
    DEFAULT_SCHEDULE.generateLeadMinutes
  );
  const reminderLeadMinutes = parseInteger(
    input.reminderLeadMinutes,
    DEFAULT_SCHEDULE.reminderLeadMinutes
  );
  const hotSearchCount = parseInteger(input.hotSearchCount, DEFAULT_SCHEDULE.hotSearchCount);
  const googleNewsTopicCount = parseInteger(
    input.googleNewsTopicCount,
    DEFAULT_SCHEDULE.googleNewsTopicCount
  );
  const weiboHotSearchStartRank = parseInteger(
    input.weiboHotSearchStartRank,
    DEFAULT_SCHEDULE.weiboHotSearchStartRank
  );
  const weiboHotSearchEndRank = parseInteger(
    input.weiboHotSearchEndRank,
    DEFAULT_SCHEDULE.weiboHotSearchEndRank
  );
  const notificationPushEnabled =
    input.notificationPushEnabled === undefined
      ? DEFAULT_SCHEDULE.notificationPushEnabled
      : Boolean(input.notificationPushEnabled);
  const copyStyle = getCopyStyleById(
    input.copyStyle === undefined ? DEFAULT_SCHEDULE.copyStyle : input.copyStyle
  ).id;
  const copyMinLength = parseInteger(input.copyMinLength, DEFAULT_SCHEDULE.copyMinLength);
  const copyMaxLength = parseInteger(input.copyMaxLength, DEFAULT_SCHEDULE.copyMaxLength);
  const llmTimeoutMs = parseInteger(input.llmTimeoutMs, DEFAULT_SCHEDULE.llmTimeoutMs);
  const categoryTimeoutMs = parseInteger(input.categoryTimeoutMs, DEFAULT_SCHEDULE.categoryTimeoutMs);
  const imageWidth = parseInteger(input.imageWidth, DEFAULT_SCHEDULE.imageWidth);
  const imageHeight = parseInteger(input.imageHeight, DEFAULT_SCHEDULE.imageHeight);
  const maxImageCount = parseInteger(input.maxImageCount, DEFAULT_SCHEDULE.maxImageCount);
  const contentCategoryIds = Array.isArray(input.contentCategoryIds)
    ? Array.from(new Set(input.contentCategoryIds.map((item) => String(item))))
    : DEFAULT_SCHEDULE.contentCategoryIds;
  const topicSources = normalizeTopicSourceConfigs(input.topicSources || DEFAULT_SCHEDULE.topicSources);

  if (publishStartHour < 0 || publishStartHour > 23) {
    throw new Error("publishStartHour must be between 0 and 23.");
  }
  if (publishEndHour < 1 || publishEndHour > 24) {
    throw new Error("publishEndHour must be between 1 and 24.");
  }
  if (publishEndHour <= publishStartHour && publishEndHour !== 24) {
    throw new Error("publishEndHour must be greater than publishStartHour unless it is 24.");
  }
  if (generateLeadMinutes < 1 || generateLeadMinutes > 180) {
    throw new Error("generateLeadMinutes must be between 1 and 180.");
  }
  if (reminderLeadMinutes < 0 || reminderLeadMinutes > 180) {
    throw new Error("reminderLeadMinutes must be between 0 and 180.");
  }
  if (reminderLeadMinutes >= generateLeadMinutes) {
    throw new Error("reminderLeadMinutes must be smaller than generateLeadMinutes.");
  }
  if (hotSearchCount < 5 || hotSearchCount > 30) {
    throw new Error("hotSearchCount must be between 5 and 30.");
  }
  if (googleNewsTopicCount < 1 || googleNewsTopicCount > 30) {
    throw new Error("googleNewsTopicCount must be between 1 and 30.");
  }
  if (weiboHotSearchStartRank < 1 || weiboHotSearchStartRank > 50) {
    throw new Error("weiboHotSearchStartRank must be between 1 and 50.");
  }
  if (weiboHotSearchEndRank < 1 || weiboHotSearchEndRank > 50) {
    throw new Error("weiboHotSearchEndRank must be between 1 and 50.");
  }
  if (weiboHotSearchEndRank < weiboHotSearchStartRank) {
    throw new Error("weiboHotSearchEndRank must be greater than or equal to weiboHotSearchStartRank.");
  }
  if (copyMinLength < 50 || copyMinLength > 1000) {
    throw new Error("copyMinLength must be between 50 and 1000.");
  }
  if (copyMaxLength < 50 || copyMaxLength > 1000) {
    throw new Error("copyMaxLength must be between 50 and 1000.");
  }
  if (copyMaxLength < copyMinLength) {
    throw new Error("copyMaxLength must be greater than or equal to copyMinLength.");
  }
  if (llmTimeoutMs < 10000 || llmTimeoutMs > 180000) {
    throw new Error("llmTimeoutMs must be between 10000 and 180000.");
  }
  if (categoryTimeoutMs < 5000 || categoryTimeoutMs > 180000) {
    throw new Error("categoryTimeoutMs must be between 5000 and 180000.");
  }
  if (imageWidth < 256 || imageWidth > 2048) {
    throw new Error("imageWidth must be between 256 and 2048.");
  }
  if (imageHeight < 256 || imageHeight > 2048) {
    throw new Error("imageHeight must be between 256 and 2048.");
  }
  if (maxImageCount < 1 || maxImageCount > 9) {
    throw new Error("maxImageCount must be between 1 and 9.");
  }
  if (getCategoriesByIds(contentCategoryIds).length !== contentCategoryIds.length) {
    throw new Error("contentCategoryIds contains unknown category id.");
  }

  validateTopicSources(topicSources);

  return {
    enabled,
    publishStartHour,
    publishEndHour,
    generateLeadMinutes,
    reminderLeadMinutes,
    hotSearchCount,
    googleNewsTopicCount,
    weiboHotSearchStartRank,
    weiboHotSearchEndRank,
    notificationPushEnabled,
    copyStyle,
    copyMinLength,
    copyMaxLength,
    llmTimeoutMs,
    categoryTimeoutMs,
    imageWidth,
    imageHeight,
    maxImageCount,
    contentCategoryIds,
    topicSources
  };
}

async function getScheduleSettings() {
  const db = await getDb();
  const row = await db.get(`SELECT value FROM system_settings WHERE key = 'publishing_schedule'`);
  if (!row) {
    return DEFAULT_SCHEDULE;
  }
  try {
    return normalizeSchedule(JSON.parse(row.value));
  } catch (_) {
    return DEFAULT_SCHEDULE;
  }
}


async function getModelSettings() {
  const db = await getDb();
  const row = await db.get(`SELECT value FROM system_settings WHERE key = 'model_settings'`);
  if (!row) {
    const modelSettings = normalizeModelSettings(DEFAULT_MODEL_SETTINGS);
    applyModelSettingsToRuntime(modelSettings);
    return modelSettings;
  }
  try {
    const modelSettings = normalizeModelSettings(JSON.parse(row.value));
    applyModelSettingsToRuntime(modelSettings);
    return modelSettings;
  } catch (_) {
    const modelSettings = normalizeModelSettings(DEFAULT_MODEL_SETTINGS);
    applyModelSettingsToRuntime(modelSettings);
    return modelSettings;
  }
}

async function getEffectiveModelSettings() {
  return applyModelSettingsToRuntime(await getModelSettings());
}

async function updateModelSettings(input) {
  const db = await getDb();
  const modelSettings = normalizeModelSettings(input);
  applyModelSettingsToRuntime(modelSettings);
  const ts = now().format();
  await db.run(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ('model_settings', ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    [JSON.stringify(modelSettings), ts]
  );
  logger.info("settings", "model settings updated", {
    textBaseUrl: modelSettings.textBaseUrl,
    textProtocol: modelSettings.textProtocol,
    textModel: modelSettings.textModel,
    kimiThinkingEnabled: modelSettings.kimiThinkingEnabled,
    imageBaseUrl: modelSettings.imageBaseUrl,
    imageProtocol: modelSettings.imageProtocol,
    imageModel: modelSettings.imageModel
  });
  return modelSettings;
}

async function updateScheduleSettings(input) {
  const db = await getDb();
  const schedule = normalizeSchedule(input);
  const ts = now().format();
  await db.run(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ('publishing_schedule', ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    [JSON.stringify(schedule), ts]
  );
  logger.info("settings", "publishing schedule updated", schedule);
  return schedule;
}

function isManagedPublishSlot(slotTime, schedule) {
  const hour = slotTime.hour();
  if (hour === 0) {
    return schedule.publishEndHour === 24;
  }
  return hour >= schedule.publishStartHour && hour <= Math.min(schedule.publishEndHour, 23);
}

function getTriggeredPublishSlot(baseTime, leadMinutes) {
  const target = dayjs(baseTime).add(leadMinutes, "minute");
  if (target.minute() !== 0) {
    return null;
  }
  return target.startOf("hour");
}

async function getNextManagedPublishSlot(baseTime = now()) {
  const schedule = await getScheduleSettings();
  let cursor = dayjs(baseTime).add(1, "hour").startOf("hour");
  for (let i = 0; i < 48; i += 1) {
    if (isManagedPublishSlot(cursor, schedule)) {
      return cursor;
    }
    cursor = cursor.add(1, "hour");
  }
  throw new Error("No managed publish slot found in the next 48 hours.");
}

module.exports = {
  DEFAULT_SCHEDULE,
  DEFAULT_MODEL_SETTINGS,
  COMMON_CATEGORIES,
  TOPIC_SOURCES,
  COPY_STYLE_OPTIONS,
  normalizeSchedule,
  normalizeModelSettings,
  buildEffectiveModelSettings,
  applyModelSettingsToRuntime,
  getScheduleSettings,
  getModelSettings,
  getEffectiveModelSettings,
  updateScheduleSettings,
  updateModelSettings,
  isManagedPublishSlot,
  getTriggeredPublishSlot,
  getNextManagedPublishSlot
};
