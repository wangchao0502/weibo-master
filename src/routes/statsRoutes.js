const express = require("express");
const { syncStats, getOverview, getAccountHistory } = require("../services/statsService");

const router = express.Router();

router.post("/sync", async (req, res) => {
  try {
    const result = await syncStats();
    res.json({ ok: true, result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/overview", async (req, res) => {
  try {
    const payload = await getOverview();
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/history", async (req, res) => {
  try {
    const limit = Number(req.query.limit || 100);
    const history = await getAccountHistory(limit);
    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
