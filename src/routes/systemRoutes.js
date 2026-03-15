const express = require("express");
const { backupDatabase, listBackups } = require("../services/backupService");
const { sendTestNotification } = require("../services/notificationService");

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

router.post("/notify/test", async (req, res) => {
  try {
    const result = await sendTestNotification();
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
