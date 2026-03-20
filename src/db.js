const fs = require("fs/promises");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const config = require("./config");
const { now } = require("./time");

let dbPromise;

async function ensureDirs() {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.mkdir(config.backupDir, { recursive: true });
  await fs.mkdir(config.logsDir, { recursive: true });
}

async function ensureColumn(db, tableName, columnName, definition) {
  const columns = await db.all(`PRAGMA table_info(${tableName})`);
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

async function initSchema(db) {
  await db.exec("PRAGMA foreign_keys = ON;");
  await db.exec("PRAGMA journal_mode = WAL;");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL UNIQUE,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at TEXT,
      raw_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      user_id TEXT PRIMARY KEY,
      screen_name TEXT,
      avatar_url TEXT,
      description TEXT,
      followers_count INTEGER DEFAULT 0,
      friends_count INTEGER DEFAULT 0,
      statuses_count INTEGER DEFAULT 0,
      raw_json TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS content_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_time TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      text TEXT NOT NULL,
      image_urls TEXT NOT NULL,
      reminder_at TEXT,
      approved_at TEXT,
      source TEXT,
      generation_mode TEXT NOT NULL DEFAULT 'scheduled',
      planned_publish_time TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      draft_id INTEGER,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unread',
      created_at TEXT NOT NULL,
      FOREIGN KEY (draft_id) REFERENCES content_drafts(id)
    );

    CREATE TABLE IF NOT EXISTS post_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id TEXT NOT NULL UNIQUE,
      text_snippet TEXT,
      created_at_weibo TEXT,
      views INTEGER,
      likes INTEGER,
      comments INTEGER,
      reposts INTEGER,
      crawled_at TEXT NOT NULL,
      raw_json TEXT
    );

    CREATE TABLE IF NOT EXISTS account_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      followers_count INTEGER DEFAULT 0,
      friends_count INTEGER DEFAULT 0,
      statuses_count INTEGER DEFAULT 0,
      crawled_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_content_drafts_slot_time ON content_drafts(slot_time);
    CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
    CREATE INDEX IF NOT EXISTS idx_post_metrics_crawled_at ON post_metrics(crawled_at DESC);
    CREATE INDEX IF NOT EXISTS idx_account_snapshots_crawled_at ON account_snapshots(crawled_at DESC);
  `);

  await ensureColumn(db, "content_drafts", "generation_mode", "TEXT NOT NULL DEFAULT 'scheduled'");
  await ensureColumn(db, "content_drafts", "planned_publish_time", "TEXT");
  await ensureColumn(db, "content_drafts", "deleted_at", "TEXT");
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_content_drafts_deleted_at ON content_drafts(deleted_at)`);
  await db.exec(
    `UPDATE content_drafts
     SET planned_publish_time = COALESCE(planned_publish_time, slot_time),
         generation_mode = COALESCE(generation_mode, 'scheduled')
     WHERE planned_publish_time IS NULL OR generation_mode IS NULL`
  );

  const ts = now().format();
  await db.run(
    `INSERT INTO notifications (type, draft_id, message, status, created_at)
     SELECT 'system', NULL, 'System initialized', 'read', ?
     WHERE NOT EXISTS (SELECT 1 FROM notifications)`,
    [ts]
  );

  await db.run(
    `INSERT INTO system_settings (key, value, updated_at)
     SELECT 'publishing_schedule', ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE key = 'publishing_schedule')`,
    [
      JSON.stringify({
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
        llmTimeoutMs: 60000,
        categoryTimeoutMs: 45000,
        imageWidth: 1024,
        imageHeight: 1024,
        maxImageCount: 3,
        contentCategoryIds: [],
        topicSources: [
          { id: "weibo_hot_search", enabled: true, priority: 10 },
          { id: "zhihu_hot", enabled: true, priority: 20 },
          { id: "google_news_cn", enabled: true, priority: 30 }
        ]
      }),
      ts
    ]
  );

  await db.run(
    `INSERT INTO system_settings (key, value, updated_at)
     SELECT 'model_settings', ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE key = 'model_settings')`,
    [
      JSON.stringify({
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
        imageModel: process.env.OPENAI_IMAGE_MODEL === undefined ? 'gpt-image-1' : (process.env.OPENAI_IMAGE_MODEL || '')
      }),
      ts
    ]
  );
}

async function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      await ensureDirs();
      const db = await open({
        filename: config.dbPath,
        driver: sqlite3.Database
      });
      await initSchema(db);
      return db;
    })();
  }
  return dbPromise;
}

module.exports = {
  getDb
};
