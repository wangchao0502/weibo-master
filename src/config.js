const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const imageProtocol = String(process.env.OPENAI_IMAGE_PROTOCOL || "openai").toLowerCase();
const imageBaseUrl = process.env.OPENAI_IMAGE_BASE_URL
  || (imageProtocol === "dashscope"
    ? "https://dashscope.aliyuncs.com/api/v1"
    : process.env.OPENAI_BASE_URL || "https://api.openai.com/v1");

module.exports = {
  rootDir,
  port: Number(process.env.PORT || 3000),
  timezone: process.env.TIMEZONE || "Asia/Shanghai",
  dataDir: path.join(rootDir, "data"),
  backupDir: path.join(rootDir, "backups"),
  logsDir: path.join(rootDir, "logs"),
  dbPath: path.join(rootDir, "data", "weibo_manager.db"),
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    textModel: process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini",
    imageApiKey: process.env.OPENAI_IMAGE_API_KEY || process.env.OPENAI_API_KEY || "",
    imageBaseUrl,
    imageProtocol,
    imageModel:
      process.env.OPENAI_IMAGE_MODEL === undefined ? "gpt-image-1" : process.env.OPENAI_IMAGE_MODEL,
    imageWidth: Number(process.env.OPENAI_IMAGE_WIDTH || 1024),
    imageHeight: Number(process.env.OPENAI_IMAGE_HEIGHT || 1024),
    requestTimeoutMs: Number(process.env.OPENAI_REQUEST_TIMEOUT_MS || 60000)
  },
  weibo: {
    appKey: process.env.WEIBO_APP_KEY || "",
    appSecret: process.env.WEIBO_APP_SECRET || "",
    redirectUri: process.env.WEIBO_REDIRECT_URI || ""
  },
  reminderWebhookUrl: process.env.REMINDER_WEBHOOK_URL || "",
  autoSyncMetrics: String(process.env.AUTO_SYNC_METRICS || "true").toLowerCase() !== "false",
  timelineSyncCount: Number(process.env.TIMELINE_SYNC_COUNT || 20)
};
