const axios = require("axios");
const logger = require("../logger");
const { getCategoriesByIds } = require("../contentCategories");
const { getTopicSourceById, getEnabledTopicSourceConfigs } = require("../topicSources");

const WEIBO_HOT_SEARCH_URL = "https://weibo.com/ajax/side/hotSearch";
const ZHIHU_HOT_URL = "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total";
const GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss?hl=zh-CN&gl=CN&ceid=CN:zh-Hans";
const MAX_CONTEXT_TOPICS = 8;
const NEWS_PER_TOPIC = 2;

function safeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeKeyword(value) {
  return safeText(value).toLowerCase().replace(/\s+/g, "");
}

function decodeXml(text) {
  return safeText(
    String(text || "")
      .replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  );
}

function stripHtml(text) {
  return decodeXml(String(text || "").replace(/<[^>]+>/g, " "));
}

function parseTag(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i"));
  return match ? match[1] : "";
}

function parseNewsItems(xml) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.slice(0, NEWS_PER_TOPIC).map((itemXml) => ({
    title: stripHtml(parseTag(itemXml, "title")),
    link: decodeXml(parseTag(itemXml, "link")),
    pubDate: stripHtml(parseTag(itemXml, "pubDate")),
    description: stripHtml(parseTag(itemXml, "description"))
  }));
}

function getWeiboHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Referer: "https://weibo.com/hot/search",
    Accept: "application/json, text/plain, */*"
  };
}

function getZhihuHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Referer: "https://www.zhihu.com/hot",
    Accept: "application/json, text/plain, */*"
  };
}

function withSourceMeta(sourceId, topics) {
  const source = getTopicSourceById(sourceId);
  return topics.map((item, index) => ({
    rank: item.rank || index + 1,
    keyword: safeText(item.keyword),
    scheme: safeText(item.scheme || item.keyword),
    heat: Number(item.heat || 0),
    label: safeText(item.label || ""),
    sourceId,
    sourceName: source?.name || sourceId,
    sourceType: source?.type || "trend",
    news: Array.isArray(item.news) ? item.news : []
  }));
}

async function fetchWeiboHotSearches({ count, startRank = 1, endRank = 20 }) {
  const response = await axios.get(WEIBO_HOT_SEARCH_URL, {
    headers: getWeiboHeaders(),
    timeout: 15000
  });

  const realtime = Array.isArray(response.data?.data?.realtime) ? response.data.data.realtime : [];
  const normalized = realtime.map((item, index) => ({
    rank: Number(item.realpos || index + 1),
    keyword: item.note || item.word || item.word_scheme,
    scheme: item.word_scheme || item.note || item.word,
    heat: Number(item.num || 0),
    label: item.label_name || item.icon_desc || item.small_icon_desc || ""
  }));

  const ranked = normalized.filter((item) => item.rank >= startRank && item.rank <= endRank);
  return withSourceMeta("weibo_hot_search", ranked.slice(0, count));
}

function extractNumber(value) {
  const match = String(value || "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

async function fetchZhihuHotTopics(count) {
  const response = await axios.get(ZHIHU_HOT_URL, {
    headers: getZhihuHeaders(),
    params: { limit: count, desktop: true },
    timeout: 15000
  });

  const items = Array.isArray(response.data?.data) ? response.data.data : [];
  return withSourceMeta(
    "zhihu_hot",
    items.slice(0, count).map((item, index) => {
      const target = item.target || {};
      const title =
        target.title_area?.text || target.title || target.question?.title || target.excerpt_area?.text || "";
      const detail = item.detail_text || target.metrics_area?.text || target.follower_count || "";
      const excerpt = target.excerpt_area?.text || target.excerpt || "";
      return {
        rank: index + 1,
        keyword: title,
        scheme: title,
        heat: extractNumber(detail),
        label: safeText(detail || excerpt)
      };
    })
  ).filter((item) => item.keyword);
}

function stripPublisherSuffix(title) {
  const clean = safeText(title);
  const parts = clean.split(/\s[-|｜]\s/);
  return parts.length > 1 ? parts.slice(0, -1).join(" - ") : clean;
}

async function fetchGoogleNewsTopics(count) {
  const response = await axios.get(GOOGLE_NEWS_RSS_URL, { timeout: 15000 });
  const news = parseNewsItems(response.data);
  return withSourceMeta(
    "google_news_cn",
    news.slice(0, count).map((item, index) => ({
      rank: index + 1,
      keyword: stripPublisherSuffix(item.title),
      scheme: item.title,
      label: item.pubDate,
      news: [item]
    }))
  ).filter((item) => item.keyword);
}

async function fetchNewsContext(keyword) {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  const response = await axios.get(rssUrl, { timeout: 15000 });
  return parseNewsItems(response.data);
}

async function fetchTopicsBySource(sourceId, count, schedule) {
  if (sourceId === "weibo_hot_search") {
    return fetchWeiboHotSearches({
      count,
      startRank: schedule.weiboHotSearchStartRank,
      endRank: schedule.weiboHotSearchEndRank
    });
  }
  if (sourceId === "zhihu_hot") {
    return fetchZhihuHotTopics(count);
  }
  if (sourceId === "google_news_cn") {
    return fetchGoogleNewsTopics(schedule.googleNewsTopicCount || count);
  }
  throw new Error(`unsupported topic source: ${sourceId}`);
}

function mergeTopicCandidates(sourceRuns) {
  const seen = new Set();
  const merged = [];

  sourceRuns.forEach((run) => {
    run.topics.forEach((topic) => {
      const key = normalizeKeyword(topic.keyword);
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      merged.push(topic);
    });
  });

  return merged.map((topic, index) => ({ ...topic, rank: index + 1 }));
}

async function buildTopicContext({ topicSources, topicLimit, schedule }) {
  const enabledSources = getEnabledTopicSourceConfigs(topicSources);
  const sourceRuns = [];

  for (const sourceConfig of enabledSources) {
    const source = getTopicSourceById(sourceConfig.id);
    try {
      const topics = await fetchTopicsBySource(sourceConfig.id, topicLimit, schedule);
      sourceRuns.push({
        id: sourceConfig.id,
        name: source?.name || sourceConfig.id,
        priority: sourceConfig.priority,
        topics
      });
      logger.info("topics", "topic source fetched", {
        sourceId: sourceConfig.id,
        priority: sourceConfig.priority,
        count: topics.length,
        weiboHotSearchStartRank:
          sourceConfig.id === "weibo_hot_search" ? schedule?.weiboHotSearchStartRank : undefined,
        weiboHotSearchEndRank:
          sourceConfig.id === "weibo_hot_search" ? schedule?.weiboHotSearchEndRank : undefined
      });
    } catch (error) {
      logger.warn("topics", "topic source fetch failed", {
        sourceId: sourceConfig.id,
        priority: sourceConfig.priority,
        error: error.message
      });
      sourceRuns.push({
        id: sourceConfig.id,
        name: source?.name || sourceConfig.id,
        priority: sourceConfig.priority,
        topics: []
      });
    }
  }

  const topics = mergeTopicCandidates(sourceRuns);
  const contextTopics = topics.slice(0, Math.min(topics.length, MAX_CONTEXT_TOPICS));

  const contexts = await Promise.all(
    contextTopics.map(async (topic) => {
      try {
        const news = topic.news?.length ? topic.news : await fetchNewsContext(topic.keyword);
        return {
          ...topic,
          news
        };
      } catch (error) {
        logger.warn("topics", "news context fetch failed", {
          keyword: topic.keyword,
          sourceId: topic.sourceId,
          error: error.message
        });
        return {
          ...topic,
          news: topic.news || []
        };
      }
    })
  );

  return {
    topics,
    contexts,
    sourceRuns: sourceRuns.map((item) => ({
      id: item.id,
      name: item.name,
      priority: item.priority,
      count: item.topics.length
    }))
  };
}

async function buildCategoryNewsContext(categoryIds) {
  const categories = getCategoriesByIds(categoryIds);
  const contexts = await Promise.all(
    categories.map(async (category) => {
      const query = [category.name, ...category.keywords.slice(0, 3)].join(" ");
      try {
        const news = await fetchNewsContext(query);
        return {
          categoryId: category.id,
          categoryName: category.name,
          description: category.description,
          news
        };
      } catch (error) {
        logger.warn("topics", "category news context fetch failed", {
          categoryId: category.id,
          error: error.message
        });
        return {
          categoryId: category.id,
          categoryName: category.name,
          description: category.description,
          news: []
        };
      }
    })
  );
  return contexts;
}

module.exports = {
  buildTopicContext,
  buildCategoryNewsContext
};
