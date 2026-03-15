const express = require("express");
const crypto = require("crypto");
const weiboClient = require("../services/weiboClient");
const { saveToken, syncCurrentAccount, getCurrentAccount } = require("../services/authService");

const router = express.Router();
let latestState = "";

router.get("/weibo/login", async (req, res) => {
  try {
    latestState = crypto.randomBytes(12).toString("hex");
    const url = weiboClient.getAuthorizeUrl(latestState);
    res.redirect(url);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/weibo/callback", async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;
  if (error) {
    res.redirect(`/?auth=failed&reason=${encodeURIComponent(errorDescription || String(error))}`);
    return;
  }
  if (!code) {
    res.redirect("/?auth=failed&reason=missing_code");
    return;
  }
  if (latestState && state !== latestState) {
    res.redirect("/?auth=failed&reason=invalid_state");
    return;
  }
  try {
    const token = await weiboClient.exchangeCodeForToken(code);
    await saveToken(token);
    await syncCurrentAccount();
    res.redirect("/?auth=success");
  } catch (err) {
    res.redirect(`/?auth=failed&reason=${encodeURIComponent(err.message)}`);
  }
});

router.get("/me", async (req, res) => {
  try {
    const payload = await getCurrentAccount();
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/sync", async (req, res) => {
  try {
    const profile = await syncCurrentAccount();
    res.json({ ok: true, profile });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
