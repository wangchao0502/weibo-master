const config = require("../config");
const { getDb } = require("../db");
const { now } = require("../time");
const { getActiveToken, upsertAccountFromProfile } = require("./authService");
const weiboClient = require("./weiboClient");
const logger = require("../logger");

function mapMetric(status) {
  return {
    postId: String(status.idstr || status.id),
    textSnippet: String(status.text || "").slice(0, 200),
    createdAtWeibo: status.created_at || null,
    views: status.read_count || status.reading || null,
    likes: Number(status.attitudes_count || 0),
    comments: Number(status.comments_count || 0),
    reposts: Number(status.reposts_count || 0),
    rawJson: JSON.stringify(status)
  };
}

async function syncStats() {
  const token = await getActiveToken();
  if (!token) {
    throw new Error("No active Weibo token. Please login first.");
  }

  const profile = await weiboClient.getUserProfile(token.access_token, token.user_id);
  await upsertAccountFromProfile(profile);

  const timeline = await weiboClient.getUserTimeline(
    token.access_token,
    token.user_id,
    config.timelineSyncCount
  );
  const statuses = Array.isArray(timeline.statuses) ? timeline.statuses : [];

  const db = await getDb();
  const ts = now().format();
  let upserted = 0;
  for (const status of statuses) {
    const metric = mapMetric(status);
    await db.run(
      `INSERT INTO post_metrics
       (post_id, text_snippet, created_at_weibo, views, likes, comments, reposts, crawled_at, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(post_id) DO UPDATE SET
         text_snippet = excluded.text_snippet,
         created_at_weibo = excluded.created_at_weibo,
         views = excluded.views,
         likes = excluded.likes,
         comments = excluded.comments,
         reposts = excluded.reposts,
         crawled_at = excluded.crawled_at,
         raw_json = excluded.raw_json`,
      [
        metric.postId,
        metric.textSnippet,
        metric.createdAtWeibo,
        metric.views,
        metric.likes,
        metric.comments,
        metric.reposts,
        ts,
        metric.rawJson
      ]
    );
    upserted += 1;
  }

  logger.info("stats", "weibo metrics synced", {
    userId: String(profile.idstr || profile.id),
    postsUpserted: upserted
  });

  return {
    account: {
      userId: String(profile.idstr || profile.id),
      screenName: profile.screen_name || "",
      followersCount: Number(profile.followers_count || 0),
      friendsCount: Number(profile.friends_count || 0),
      statusesCount: Number(profile.statuses_count || 0)
    },
    postsUpserted: upserted,
    crawledAt: ts
  };
}

async function getOverview() {
  const db = await getDb();
  const account = await db.get(`SELECT * FROM accounts ORDER BY updated_at DESC LIMIT 1`);
  const latestMetrics = await db.all(
    `SELECT post_id, text_snippet, created_at_weibo, views, likes, comments, reposts, crawled_at
     FROM post_metrics
     ORDER BY crawled_at DESC
     LIMIT 30`
  );
  const latestSnapshot = await db.get(
    `SELECT followers_count, friends_count, statuses_count, crawled_at
     FROM account_snapshots
     ORDER BY crawled_at DESC
     LIMIT 1`
  );
  return {
    account: account || null,
    latestSnapshot: latestSnapshot || null,
    posts: latestMetrics
  };
}

async function getAccountHistory(limit = 100) {
  const db = await getDb();
  return db.all(
    `SELECT user_id, followers_count, friends_count, statuses_count, crawled_at
     FROM account_snapshots
     ORDER BY crawled_at DESC
     LIMIT ?`,
    [limit]
  );
}

module.exports = {
  syncStats,
  getOverview,
  getAccountHistory
};
