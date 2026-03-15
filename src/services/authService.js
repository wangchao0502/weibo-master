const { getDb } = require("../db");
const { now } = require("../time");
const weiboClient = require("./weiboClient");
const logger = require("../logger");

async function saveToken(tokenPayload) {
  const db = await getDb();
  const ts = now().format();
  const userId = String(tokenPayload.uid);
  const expiresAt = tokenPayload.expires_in
    ? now().add(Number(tokenPayload.expires_in), "second").format()
    : null;

  await db.run(
    `INSERT INTO oauth_tokens (user_id, access_token, refresh_token, expires_at, raw_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       raw_json = excluded.raw_json,
       updated_at = excluded.updated_at`,
    [
      userId,
      tokenPayload.access_token,
      tokenPayload.refresh_token || null,
      expiresAt,
      JSON.stringify(tokenPayload),
      ts,
      ts
    ]
  );

  logger.info("auth", "token saved", {
    userId,
    expiresAt
  });

  return {
    userId,
    accessToken: tokenPayload.access_token,
    expiresAt
  };
}

async function getActiveToken() {
  const db = await getDb();
  const row = await db.get(
    `SELECT user_id, access_token, refresh_token, expires_at, updated_at
     FROM oauth_tokens
     ORDER BY updated_at DESC
     LIMIT 1`
  );
  return row || null;
}

async function upsertAccountFromProfile(profile) {
  const db = await getDb();
  const ts = now().format();
  const userId = String(profile.idstr || profile.id);

  await db.run(
    `INSERT INTO accounts (
      user_id, screen_name, avatar_url, description,
      followers_count, friends_count, statuses_count, raw_json, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      screen_name = excluded.screen_name,
      avatar_url = excluded.avatar_url,
      description = excluded.description,
      followers_count = excluded.followers_count,
      friends_count = excluded.friends_count,
      statuses_count = excluded.statuses_count,
      raw_json = excluded.raw_json,
      updated_at = excluded.updated_at`,
    [
      userId,
      profile.screen_name || "",
      profile.avatar_large || profile.profile_image_url || "",
      profile.description || "",
      Number(profile.followers_count || 0),
      Number(profile.friends_count || 0),
      Number(profile.statuses_count || 0),
      JSON.stringify(profile),
      ts
    ]
  );

  await db.run(
    `INSERT INTO account_snapshots (user_id, followers_count, friends_count, statuses_count, crawled_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      userId,
      Number(profile.followers_count || 0),
      Number(profile.friends_count || 0),
      Number(profile.statuses_count || 0),
      ts
    ]
  );
}

async function syncCurrentAccount() {
  const token = await getActiveToken();
  if (!token) {
    throw new Error("No active Weibo token. Please login first.");
  }
  const profile = await weiboClient.getUserProfile(token.access_token, token.user_id);
  await upsertAccountFromProfile(profile);
  logger.info("auth", "account synced", {
    userId: token.user_id,
    screenName: profile.screen_name || ""
  });
  return profile;
}

async function getCurrentAccount() {
  const db = await getDb();
  const account = await db.get(`SELECT * FROM accounts ORDER BY updated_at DESC LIMIT 1`);
  const token = await getActiveToken();
  return {
    hasToken: Boolean(token),
    tokenUpdatedAt: token ? token.updated_at : null,
    account: account || null
  };
}

module.exports = {
  saveToken,
  getActiveToken,
  upsertAccountFromProfile,
  syncCurrentAccount,
  getCurrentAccount
};
