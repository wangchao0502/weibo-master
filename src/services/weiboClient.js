const axios = require("axios");
const config = require("../config");

const WEIBO_AUTH_URL = "https://api.weibo.com/oauth2/authorize";
const WEIBO_TOKEN_URL = "https://api.weibo.com/oauth2/access_token";
const WEIBO_API_BASE = "https://api.weibo.com/2";

function hasWeiboCredentials() {
  return Boolean(config.weibo.appKey && config.weibo.appSecret && config.weibo.redirectUri);
}

function ensureWeiboCredentials() {
  if (!hasWeiboCredentials()) {
    throw new Error("Missing Weibo credentials. Please configure WEIBO_APP_KEY/SECRET/REDIRECT_URI.");
  }
}

function getAuthorizeUrl(state = "") {
  ensureWeiboCredentials();
  const params = new URLSearchParams({
    client_id: config.weibo.appKey,
    redirect_uri: config.weibo.redirectUri,
    response_type: "code"
  });
  if (state) {
    params.set("state", state);
  }
  return `${WEIBO_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  ensureWeiboCredentials();
  const body = new URLSearchParams({
    client_id: config.weibo.appKey,
    client_secret: config.weibo.appSecret,
    grant_type: "authorization_code",
    redirect_uri: config.weibo.redirectUri,
    code
  });

  const { data } = await axios.post(WEIBO_TOKEN_URL, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000
  });
  return data;
}

async function getUserProfile(accessToken, uid) {
  const { data } = await axios.get(`${WEIBO_API_BASE}/users/show.json`, {
    params: {
      access_token: accessToken,
      uid
    },
    timeout: 15000
  });
  return data;
}

async function getUserTimeline(accessToken, uid, count = 20) {
  const { data } = await axios.get(`${WEIBO_API_BASE}/statuses/user_timeline.json`, {
    params: {
      access_token: accessToken,
      uid,
      count
    },
    timeout: 20000
  });
  return data;
}

module.exports = {
  hasWeiboCredentials,
  getAuthorizeUrl,
  exchangeCodeForToken,
  getUserProfile,
  getUserTimeline
};
