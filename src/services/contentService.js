const config = require("../config");
const { getDb } = require("../db");
const { dayjs, now } = require("../time");
const {
  GenerationFailedError,
  generateDraftPayload,
  generateRefinedDraftPayload,
  generateDailyKindnessPayload,
  makeReminderText
} = require("./llmService");
const { createNotification } = require("./notificationService");
const { getScheduleSettings } = require("./settingsService");
const logger = require("../logger");

function parseDraft(row) {
  if (!row) {
    return null;
  }
  return {
    ...row,
    image_urls: JSON.parse(row.image_urls || "[]")
  };
}

function normalizeSlotTime(slotTimeInput) {
  return dayjs(slotTimeInput).tz(config.timezone).startOf("hour");
}

function buildFailureMessage({ scope, slotTime, draftId, error }) {
  if (scope === "manual") {
    return `立即生成失败：${error.message}`;
  }
  if (scope === "refine") {
    return `AI 润色失败(草稿 #${draftId})：${error.message}`;
  }
  return `定时生成失败(${slotTime.format("MM-DD HH:mm")})：${error.message}`;
}

async function notifyGenerationFailure({ scope, slotTime, draftId, error, extra = {} }) {
  const message = buildFailureMessage({ scope, slotTime, draftId, error });
  await createNotification({
    type: scope === "refine" ? "draft_refine_failed" : "draft_generation_failed",
    draftId: draftId || null,
    message,
    webhookPayload: {
      type: scope === "refine" ? "draft_refine_failed" : "draft_generation_failed",
      title:
        scope === "manual"
          ? "微博草稿生成失败"
          : scope === "refine"
            ? `微博草稿 AI 润色失败 #${draftId}`
            : `微博定时草稿生成失败 ${slotTime.format("MM-DD HH:mm")}`,
      scope,
      slotTime: slotTime ? slotTime.format() : null,
      draftId: draftId || null,
      errorCode: error.code || "generation_failed",
      errorMessage: error.message,
      causeMessage: error.causeMessage || "",
      ...extra
    }
  });
  logger.warn("content", scope === "refine" ? "draft refine failed" : "draft generation failed", {
    scope,
    slotTime: slotTime ? slotTime.format() : null,
    draftId: draftId || null,
    error: error.message,
    errorCode: error.code || "generation_failed"
  });
}

async function getDraftBySlot(slotTimeInput) {
  const db = await getDb();
  const slotTime = normalizeSlotTime(slotTimeInput).format();
  const row = await db.get(
    `SELECT * FROM content_drafts WHERE slot_time = ? AND deleted_at IS NULL`,
    [slotTime]
  );
  return parseDraft(row);
}

async function getDraftById(id) {
  const db = await getDb();
  const row = await db.get(`SELECT * FROM content_drafts WHERE id = ? AND deleted_at IS NULL`, [id]);
  return parseDraft(row);
}

async function generateDraftForSlot(slotTimeInput, { force = false } = {}) {
  const db = await getDb();
  const slotTime = normalizeSlotTime(slotTimeInput);
  const slotKey = slotTime.format();
  const existing = await db.get(
    `SELECT * FROM content_drafts
     WHERE slot_time = ? AND generation_mode = 'scheduled' AND deleted_at IS NULL`,
    [slotKey]
  );

  if (existing && !force) {
    return parseDraft(existing);
  }

  let payload;
  try {
    payload = await generateDraftPayload(slotTime);
  } catch (error) {
    const generationError =
      error instanceof GenerationFailedError
        ? error
        : new GenerationFailedError("微博草稿生成失败。", { causeMessage: error.message });
    await notifyGenerationFailure({ scope: "scheduled", slotTime, error: generationError });
    throw generationError;
  }

  const ts = now().format();
  const schedule = await getScheduleSettings();
  const reminderAt = slotTime.subtract(schedule.reminderLeadMinutes, "minute").format();

  if (existing) {
    await db.run(
      `UPDATE content_drafts
       SET status = 'pending',
           text = ?,
           image_urls = ?,
           reminder_at = ?,
           approved_at = NULL,
           source = ?,
           planned_publish_time = ?,
           updated_at = ?
       WHERE slot_time = ?`,
      [
        payload.copy,
        JSON.stringify(payload.imageUrls),
        reminderAt,
        payload.source,
        slotKey,
        ts,
        slotKey
      ]
    );
  } else {
    await db.run(
      `INSERT INTO content_drafts
       (
         slot_time, status, text, image_urls, reminder_at, approved_at, source,
         generation_mode, planned_publish_time, created_at, updated_at
       )
       VALUES (?, 'pending', ?, ?, ?, NULL, ?, 'scheduled', ?, ?, ?)`,
      [
        slotKey,
        payload.copy,
        JSON.stringify(payload.imageUrls),
        reminderAt,
        payload.source,
        slotKey,
        ts,
        ts
      ]
    );
  }

  const draft = await getDraftBySlot(slotKey);
  await createNotification({
    type: "draft_generated",
    draftId: draft.id,
    message: `Draft prepared for ${slotTime.format("YYYY-MM-DD HH:mm")}: ${payload.copy}`,
    webhookPayload: {
      type: "draft_generated",
      title: `微博草稿待审批 ${slotTime.format("MM-DD HH:mm")}`,
      slotTime: slotKey,
      topic: payload.topic || "",
      strategyMode: payload.strategyMode || "",
      selectedCategories: payload.selectedCategories || [],
      content: payload.copy,
      imageUrls: payload.imageUrls,
      hotSearches: (payload.hotSearches || []).slice(0, 10),
      relatedContext: payload.relatedContext || []
    }
  });
  logger.info("content", "draft generated", {
    slotTime: slotKey,
    draftId: draft.id,
    force,
    imageCount: draft.image_urls.length,
    source: draft.source
  });
  return draft;
}

async function generateImmediateDraft() {
  const db = await getDb();
  const schedule = await getScheduleSettings();
  const plannedPublishTime = getNextPublishSlot(now()).format();
  const generatedAt = now().format("YYYY-MM-DDTHH:mm:ss.SSSZ");

  let payload;
  try {
    payload = await generateDraftPayload(now());
  } catch (error) {
    const generationError =
      error instanceof GenerationFailedError
        ? error
        : new GenerationFailedError("微博草稿生成失败。", { causeMessage: error.message });
    await notifyGenerationFailure({ scope: "manual", slotTime: now(), error: generationError });
    throw generationError;
  }

  const result = await db.run(
    `INSERT INTO content_drafts
     (
       slot_time, status, text, image_urls, reminder_at, approved_at, source,
       generation_mode, planned_publish_time, created_at, updated_at
     )
     VALUES (?, 'pending', ?, ?, NULL, NULL, ?, 'manual', ?, ?, ?)`,
    [
      generatedAt,
      payload.copy,
      JSON.stringify(payload.imageUrls),
      payload.source,
      plannedPublishTime,
      generatedAt,
      generatedAt
    ]
  );

  const draft = await getDraftById(result.lastID);
  await createNotification({
    type: "draft_generated",
    draftId: draft.id,
    message: `Draft prepared at ${now().format("YYYY-MM-DD HH:mm")}: ${payload.copy}`,
    webhookPayload: {
      type: "draft_generated",
      title: `微博草稿待审批 ${now().format("MM-DD HH:mm")}`,
      slotTime: generatedAt,
      topic: payload.topic || "",
      strategyMode: payload.strategyMode || "",
      selectedCategories: payload.selectedCategories || [],
      content: payload.copy,
      imageUrls: payload.imageUrls,
      hotSearches: (payload.hotSearches || []).slice(0, schedule.hotSearchCount),
      relatedContext: payload.relatedContext || []
    }
  });
  logger.info("content", "manual draft generated", {
    draftId: draft.id,
    slotTime: generatedAt,
    plannedPublishTime,
    imageCount: draft.image_urls.length,
    source: draft.source
  });
  return draft;
}


async function generateDailyKindnessDraft() {
  const db = await getDb();
  const plannedPublishTime = getNextPublishSlot(now()).format();
  const generatedAt = now().format("YYYY-MM-DDTHH:mm:ss.SSSZ");

  let payload;
  try {
    payload = await generateDailyKindnessPayload();
  } catch (error) {
    const generationError =
      error instanceof GenerationFailedError
        ? error
        : new GenerationFailedError("每日一善草稿生成失败。", { causeMessage: error.message });
    await notifyGenerationFailure({ scope: "manual", slotTime: now(), error: generationError, extra: { draftType: "daily_kindness" } });
    throw generationError;
  }

  const result = await db.run(
    `INSERT INTO content_drafts
     (
       slot_time, status, text, image_urls, reminder_at, approved_at, source,
       generation_mode, planned_publish_time, created_at, updated_at
     )
     VALUES (?, 'pending', ?, ?, NULL, NULL, ?, 'manual', ?, ?, ?)`,
    [
      generatedAt,
      payload.copy,
      JSON.stringify(payload.imageUrls || []),
      payload.source,
      plannedPublishTime,
      generatedAt,
      generatedAt
    ]
  );

  const draft = await getDraftById(result.lastID);
  await createNotification({
    type: "draft_generated",
    draftId: draft.id,
    message: `每日一善草稿已生成：${payload.copy}`,
    webhookPayload: {
      type: "draft_generated",
      title: `每日一善超话草稿待审批 ${now().format("MM-DD HH:mm")}`,
      slotTime: generatedAt,
      topic: payload.topic || "每日一善",
      strategyMode: "daily_kindness",
      selectedCategories: ["每日一善"],
      content: payload.copy,
      imageUrls: payload.imageUrls || []
    }
  });
  logger.info("content", "daily kindness draft generated", {
    draftId: draft.id,
    slotTime: generatedAt,
    plannedPublishTime,
    source: draft.source
  });
  return draft;
}

async function refineDraft(id, suggestionInput, options = {}) {
  const db = await getDb();
  const draft = await getDraftById(id);
  if (!draft) {
    throw new Error("草稿不存在或已删除。");
  }

  const suggestion = String(suggestionInput || "").trim();
  const refineImages = Boolean(options.refineImages);
  if (suggestion.length < 2) {
    throw new Error("请输入更明确的修改建议。");
  }

  let payload;
  try {
    payload = await generateRefinedDraftPayload({ draft, suggestion, refineImages });
  } catch (error) {
    const refineError =
      error instanceof GenerationFailedError
        ? error
        : new GenerationFailedError("微博草稿润色失败。", { causeMessage: error.message });
    await notifyGenerationFailure({
      scope: "refine",
      draftId: draft.id,
      error: refineError,
      extra: {
        suggestion,
        originalContent: draft.text
      }
    });
    throw refineError;
  }

  const ts = now().format();
  const nextImages = payload.imageUrls.length ? payload.imageUrls : draft.image_urls;
  await db.run(
    `UPDATE content_drafts
     SET text = ?,
         image_urls = ?,
         source = ?,
         status = 'pending',
         approved_at = NULL,
         updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [payload.copy, JSON.stringify(nextImages), payload.source, ts, id]
  );

  const updatedDraft = await getDraftById(id);
  await createNotification({
    type: "draft_refined",
    draftId: updatedDraft.id,
    message: `草稿 #${updatedDraft.id} 已根据建议完成 AI 润色：${payload.copy}`,
    webhookPayload: {
      type: "draft_refined",
      title: `微博草稿已润色 #${updatedDraft.id}`,
      draftId: updatedDraft.id,
      suggestion,
      content: updatedDraft.text,
      imageUrls: updatedDraft.image_urls,
      source: updatedDraft.source,
      updatedAt: updatedDraft.updated_at
    }
  });
  logger.info("content", "draft refined", {
    draftId: updatedDraft.id,
    source: updatedDraft.source,
    refineImages,
    imageCount: updatedDraft.image_urls.length
  });
  return updatedDraft;
}

async function listDraftsByRange(startInput, endInput) {
  const db = await getDb();
  const rows = await db.all(
    `SELECT * FROM content_drafts
     WHERE created_at >= ?
       AND created_at < ?
       AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [startInput, endInput]
  );
  return rows.map(parseDraft);
}

async function listDraftsByDate(dateInput) {
  const dateLabel = dateInput || now().format("YYYY-MM-DD");
  const start = dayjs(dateLabel).tz(config.timezone).startOf("day");
  const end = start.add(1, "day");
  return listDraftsByRange(start.format(), end.format());
}

async function getDraftStorageSummary() {
  const db = await getDb();
  const row = await db.get(
    `SELECT
       count(*) as total,
       sum(case when deleted_at is null then 1 else 0 end) as active,
       sum(case when deleted_at is not null then 1 else 0 end) as deleted,
       sum(case when deleted_at is null and generation_mode = 'manual' then 1 else 0 end) as manualActive,
       sum(case when deleted_at is null and generation_mode = 'scheduled' then 1 else 0 end) as scheduledActive,
       max(created_at) as latestCreatedAt
     FROM content_drafts`
  );
  return {
    total: Number(row?.total || 0),
    active: Number(row?.active || 0),
    deleted: Number(row?.deleted || 0),
    manualActive: Number(row?.manualActive || 0),
    scheduledActive: Number(row?.scheduledActive || 0),
    latestCreatedAt: row?.latestCreatedAt || null
  };
}

async function updateDraftStatus(id, status) {
  const db = await getDb();
  const ts = now().format();
  const approvedAt = status === "approved" ? ts : null;
  await db.run(
    `UPDATE content_drafts
     SET status = ?, approved_at = ?, updated_at = ?
    WHERE id = ?`,
    [status, approvedAt, ts, id]
  );
  logger.info("content", "draft status updated", { draftId: id, status });
  return getDraftById(id);
}

async function sendReminderForSlot(slotTimeInput) {
  const draft = await getDraftBySlot(slotTimeInput);
  if (!draft || draft.status !== "pending" || draft.generation_mode !== "scheduled") {
    return null;
  }
  const slotTime = normalizeSlotTime(slotTimeInput);
  await createNotification({
    type: "approval_reminder",
    draftId: draft.id,
    message: makeReminderText(slotTime)
  });
  logger.info("content", "approval reminder sent", {
    draftId: draft.id,
    slotTime: slotTime.format()
  });
  return draft;
}

async function deleteDraft(id) {
  const db = await getDb();
  const ts = now().format();
  await db.run(
    `UPDATE content_drafts
     SET deleted_at = ?, updated_at = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [ts, ts, id]
  );
  logger.info("content", "draft logically deleted", { draftId: id });
}

function getNextPublishSlot(baseTime = now()) {
  const next = dayjs(baseTime).tz(config.timezone).add(1, "hour").startOf("hour");
  return next;
}

module.exports = {
  getDraftBySlot,
  getDraftById,
  generateDraftForSlot,
  generateImmediateDraft,
  generateDailyKindnessDraft,
  refineDraft,
  listDraftsByDate,
  listDraftsByRange,
  getDraftStorageSummary,
  updateDraftStatus,
  deleteDraft,
  sendReminderForSlot,
  getNextPublishSlot
};
