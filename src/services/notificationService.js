const axios = require("axios");
const config = require("../config");
const { getDb } = require("../db");
const { now } = require("../time");
const logger = require("../logger");
const { getScheduleSettings } = require("./settingsService");

async function postWebhook(payload) {
  if (!config.reminderWebhookUrl) {
    throw new Error("REMINDER_WEBHOOK_URL is not configured.");
  }

  const response = await axios.post(config.reminderWebhookUrl, payload, {
    timeout: 10000,
    headers: {
      "Content-Type": "application/json"
    }
  });

  return response.data;
}

async function createNotification({
  type,
  message,
  draftId = null,
  sendWebhook = true,
  webhookPayload = null
}) {
  const db = await getDb();
  const ts = now().format();

  const result = await db.run(
    `INSERT INTO notifications (type, draft_id, message, status, created_at)
     VALUES (?, ?, ?, 'unread', ?)`,
    [type, draftId, message, ts]
  );

  const schedule = await getScheduleSettings();
  const shouldPush = sendWebhook && config.reminderWebhookUrl && schedule.notificationPushEnabled !== false;

  if (shouldPush) {
    try {
      await postWebhook({
        type,
        draftId,
        message,
        createdAt: ts,
        ...(webhookPayload || {})
      });
      logger.info("notification", "webhook notification sent", { type, draftId });
    } catch (_) {
      // Keep local reminder even if webhook push fails.
      logger.warn("notification", "webhook notification failed", { type, draftId });
    }
  }

  return result.lastID;
}

async function listNotifications({ unreadOnly = false, limit = 100 } = {}) {
  const db = await getDb();
  const whereClause = unreadOnly ? "WHERE status = 'unread'" : "";
  const rows = await db.all(
    `SELECT id, type, draft_id, message, status, created_at
     FROM notifications
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT ?`,
    [limit]
  );
  return rows;
}

async function markNotificationRead(id) {
  const db = await getDb();
  await db.run(`UPDATE notifications SET status = 'read' WHERE id = ?`, [id]);
}

async function markAllNotificationsRead() {
  const db = await getDb();
  await db.run(`UPDATE notifications SET status = 'read' WHERE status = 'unread'`);
}

async function sendTestNotification() {
  const ts = now().format("YYYY-MM-DD HH:mm:ss");
  const response = await postWebhook({
    type: "manual_test",
    title: "Weibo Smart Manager Test",
    message: `Webhook connectivity test at ${ts}`,
    createdAt: now().format()
  });
  logger.info("notification", "test webhook sent", response);
  return response;
}

module.exports = {
  createNotification,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  sendTestNotification
};
