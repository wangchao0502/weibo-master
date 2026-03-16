const express = require("express");
const { backupDatabase, listBackups } = require("../services/backupService");
const { sendTestNotification } = require("../services/notificationService");
const { getModelSettings, getEffectiveModelSettings, updateModelSettings, normalizeModelSettings, buildEffectiveModelSettings } = require("../services/settingsService");
const { checkTextModelAvailability, checkImageModelAvailability } = require("../services/llmService");

const router = express.Router();

router.get("/health", async (req, res) => {
  res.json({ ok: true });
});

router.post("/backup", async (req, res) => {
  try {
    const result = await backupDatabase();
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/backups", async (req, res) => {
  try {
    const files = await listBackups();
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


router.get("/model-settings", async (req, res) => {
  try {
    const modelSettings = await getModelSettings();
    const effectiveModelSettings = await getEffectiveModelSettings();
    res.json({ modelSettings, effectiveModelSettings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/model-settings", async (req, res) => {
  try {
    const modelSettings = await updateModelSettings(req.body || {});
    const effectiveModelSettings = buildEffectiveModelSettings(modelSettings);
    res.json({ ok: true, modelSettings, effectiveModelSettings });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/model-settings/check-text", async (req, res) => {
  try {
    const modelSettings = buildEffectiveModelSettings(normalizeModelSettings(req.body || {}));
    const result = await checkTextModelAvailability(modelSettings);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/model-settings/check-image", async (req, res) => {
  try {
    const modelSettings = buildEffectiveModelSettings(normalizeModelSettings(req.body || {}));
    const result = await checkImageModelAvailability(modelSettings);
    res.json({ ok: true, result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/notify/test", async (req, res) => {
  try {
    const result = await sendTestNotification();
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
