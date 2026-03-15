const express = require("express");
const { dayjs, now } = require("../time");
const {
  generateDraftForSlot,
  generateImmediateDraft,
  generateDailyKindnessDraft,
  refineDraft,
  listDraftsByDate,
  listDraftsByRange,
  getDraftStorageSummary,
  updateDraftStatus,
  deleteDraft
} = require("../services/contentService");
const {
  COMMON_CATEGORIES,
  TOPIC_SOURCES,
  getScheduleSettings,
  updateScheduleSettings,
  getNextManagedPublishSlot
} = require("../services/settingsService");
const { listNotifications, markNotificationRead, markAllNotificationsRead } = require("../services/notificationService");

const router = express.Router();

function resolvePresetRange(presetInput) {
  const current = now();
  const todayStart = current.startOf("day");
  const preset = String(presetInput || "today").toLowerCase();

  if (preset === "yesterday") {
    return {
      preset,
      label: "昨日微博",
      start: todayStart.subtract(1, "day"),
      end: todayStart
    };
  }

  if (preset === "this_week") {
    const weekday = todayStart.day();
    const diffToMonday = weekday === 0 ? 6 : weekday - 1;
    const start = todayStart.subtract(diffToMonday, "day");
    return {
      preset,
      label: "本周微博",
      start,
      end: todayStart.add(1, "day")
    };
  }

  if (preset === "last_7d") {
    return {
      preset,
      label: "近7天微博",
      start: todayStart.subtract(6, "day"),
      end: todayStart.add(1, "day")
    };
  }

  if (preset === "last_30d") {
    return {
      preset,
      label: "近30天微博",
      start: todayStart.subtract(29, "day"),
      end: todayStart.add(1, "day")
    };
  }

  return {
    preset: "today",
    label: "今日微博",
    start: todayStart,
    end: todayStart.add(1, "day")
  };
}

router.get("/drafts", async (req, res) => {
  try {
    const summary = await getDraftStorageSummary();

    if (req.query.date) {
      const date = dayjs(req.query.date).format("YYYY-MM-DD");
      const drafts = await listDraftsByDate(date);
      res.json({
        date,
        label: `${date} 微博`,
        drafts,
        filteredCount: drafts.length,
        summary
      });
      return;
    }

    const range = resolvePresetRange(req.query.preset);
    const drafts = await listDraftsByRange(range.start.format(), range.end.format());
    res.json({
      preset: range.preset,
      label: range.label,
      range: {
        start: range.start.format(),
        end: range.end.format()
      },
      drafts,
      filteredCount: drafts.length,
      summary
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/generate-next", async (req, res) => {
  try {
    if (req.body?.immediate) {
      const draft = await generateImmediateDraft();
      res.json({ ok: true, draft });
      return;
    }
    const slotTime = req.body?.slotTime || (await getNextManagedPublishSlot(now())).format();
    const force = Boolean(req.body?.force);
    const draft = await generateDraftForSlot(slotTime, { force });
    res.json({ ok: true, draft });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


router.post("/generate-daily-kindness", async (req, res) => {
  try {
    const draft = await generateDailyKindnessDraft();
    res.json({ ok: true, draft });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/drafts/:id/refine", async (req, res) => {
  try {
    const suggestion = String(req.body?.suggestion || "").trim();
    const refineImages = Boolean(req.body?.refineImages);
    if (suggestion.length < 2) {
      res.status(400).json({ error: "请输入更明确的修改建议。" });
      return;
    }
    const draft = await refineDraft(req.params.id, suggestion, { refineImages });
    res.json({ ok: true, draft });
  } catch (error) {
    const status = error.message === "草稿不存在或已删除。" ? 404 : 500;
    res.status(status).json({ error: error.message });
  }
});

router.get("/settings", async (req, res) => {
  try {
    const schedule = await getScheduleSettings();
    const nextSlot = await getNextManagedPublishSlot(now());
    res.json({
      schedule,
      nextSlot: nextSlot.format(),
      availableCategories: COMMON_CATEGORIES,
      availableTopicSources: TOPIC_SOURCES
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const schedule = await updateScheduleSettings(req.body || {});
    const nextSlot = await getNextManagedPublishSlot(now());
    res.json({ ok: true, schedule, nextSlot: nextSlot.format(), availableTopicSources: TOPIC_SOURCES });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/drafts/:id/approve", async (req, res) => {
  try {
    const draft = await updateDraftStatus(req.params.id, "approved");
    res.json({ ok: true, draft });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/drafts/:id/reject", async (req, res) => {
  try {
    const draft = await updateDraftStatus(req.params.id, "rejected");
    res.json({ ok: true, draft });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/drafts/:id/sent", async (req, res) => {
  try {
    const draft = await updateDraftStatus(req.params.id, "sent");
    res.json({ ok: true, draft });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/drafts/:id", async (req, res) => {
  try {
    await deleteDraft(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/notifications", async (req, res) => {
  try {
    const unreadOnly = String(req.query.unreadOnly || "false").toLowerCase() === "true";
    const notifications = await listNotifications({ unreadOnly });
    res.json({ notifications });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/notifications/:id/read", async (req, res) => {
  try {
    await markNotificationRead(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/notifications/read-all", async (req, res) => {
  try {
    await markAllNotificationsRead();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
