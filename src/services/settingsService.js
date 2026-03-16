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
  copyMinLength: 200,
  copyMaxLength: 500,
  llmTimeoutMs: config.openai.requestTimeoutMs,
  imageWidth: config.openai.imageWidth,
  imageHeight: config.openai.imageHeight,
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
  const copyMinLength = parseInteger(input.copyMinLength, DEFAULT_SCHEDULE.copyMinLength);
  const copyMaxLength = parseInteger(input.copyMaxLength, DEFAULT_SCHEDULE.copyMaxLength);
  const llmTimeoutMs = parseInteger(input.llmTimeoutMs, DEFAULT_SCHEDULE.llmTimeoutMs);
  const imageWidth = parseInteger(input.imageWidth, DEFAULT_SCHEDULE.imageWidth);
  const imageHeight = parseInteger(input.imageHeight, DEFAULT_SCHEDULE.imageHeight);
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
  if (imageWidth < 256 || imageWidth > 2048) {
    throw new Error("imageWidth must be between 256 and 2048.");
  }
  if (imageHeight < 256 || imageHeight > 2048) {
    throw new Error("imageHeight must be between 256 and 2048.");
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
    copyMinLength,
    copyMaxLength,
    llmTimeoutMs,
    imageWidth,
    imageHeight,
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
  COMMON_CATEGORIES,
  TOPIC_SOURCES,
  normalizeSchedule,
  getScheduleSettings,
  updateScheduleSettings,
  isManagedPublishSlot,
  getTriggeredPublishSlot,
  getNextManagedPublishSlot
};
