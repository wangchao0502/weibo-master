const axios = require("axios");
const config = require("../config");
const logger = require("../logger");
const { getCategoriesByIds } = require("../contentCategories");
const { getTopicSourceById, getEnabledTopicSourceConfigs } = require("../topicSources");

const WEIBO_HOT_SEARCH_URL = "https://weibo.com/ajax/side/hotSearch";
const WEIBO_AI_SEARCH_PAGE_URL = "https://s.weibo.com/aisearch";
const WEIBO_AI_SHOW_URL = "https://ai.s.weibo.com/api/wis/show.json";
const WEIBO_STATUS_SHOW_URL = "https://weibo.com/ajax/statuses/show";
const ZHIHU_HOT_URL = "https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total";
const GOOGLE_NEWS_RSS_URL = "https://news.google.com/rss?hl=zh-CN&gl=CN&ceid=CN:zh-Hans";
const SOGOU_WEB_SEARCH_URL = "https://www.sogou.com/web";
const MAX_CONTEXT_TOPICS = 8;
const NEWS_PER_TOPIC = 2;
const RICH_CONTEXT_NEWS_COUNT = 4;
const RICH_CONTEXT_SNIPPET_COUNT = 2;
const SEARCH_RESULT_CANDIDATE_COUNT = 6;
const WEIBO_SEARCH_RESULT_COUNT = 2;
const WEIBO_SEARCH_CHECK_KEYWORD = "微博热搜";

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

function parseNewsItems(xml, limit = NEWS_PER_TOPIC) {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.slice(0, limit).map((itemXml) => ({
    title: stripHtml(parseTag(itemXml, "title")),
    link: decodeXml(parseTag(itemXml, "link")),
    pubDate: stripHtml(parseTag(itemXml, "pubDate")),
    description: stripHtml(parseTag(itemXml, "description"))
  }));
}

function extractMetaContent(html, key, attr = "name") {
  const regex = new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`, "i");
  const reverseRegex = new RegExp(`<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+${attr}=["']${key}["'][^>]*>`, "i");
  const match = html.match(regex) || html.match(reverseRegex);
  return match ? stripHtml(match[1]) : "";
}

function extractTitleFromHtml(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]) : "";
}

function extractBodySnippet(html) {
  const cleaned = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ");
  return stripHtml(cleaned).slice(0, 220);
}

function getWeiboHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    Referer: "https://weibo.com/hot/search",
    Accept: "application/json, text/plain, */*"
  };
}

function getWeiboSearchPageUrl(keyword) {
  return `${WEIBO_AI_SEARCH_PAGE_URL}?q=${encodeURIComponent(keyword)}&Refer=aisearch_aisearch`;
}

function getWeiboSearchHeaders(cookie, keyword = WEIBO_SEARCH_CHECK_KEYWORD) {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    Referer: getWeiboSearchPageUrl(keyword),
    Cookie: cookie
  };
}

function getWeiboAjaxHeaders(cookie, keyword = WEIBO_SEARCH_CHECK_KEYWORD) {
  return {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    Referer: getWeiboSearchPageUrl(keyword),
    Cookie: cookie
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

async function fetchNewsContext(keyword, count = NEWS_PER_TOPIC) {
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  const response = await axios.get(rssUrl, { timeout: 15000 });
  return parseNewsItems(response.data, count);
}

function isBlockedSearchLink(link = "") {
  const normalized = String(link || "").toLowerCase();
  return [
    "sogou.com",
    "m.sogou.com",
    "yuanbao.tencent.com",
    "ima.qq.com",
    "newsa.html5.qq.com",
    "share-video"
  ].some((item) => normalized.includes(item));
}

function isBlockedSearchTitle(title = "") {
  const normalized = safeText(title);
  return ["看看元宝怎么说", "看看ima怎么说", "精选视频", "QQ浏览器", "腾讯网"].some((item) => normalized.includes(item));
}

function isWeiboVisitorSystemResponse(data, contentType = "") {
  const raw = String(data || "");
  return /Sina Visitor System/i.test(raw)
    || /passport\.weibo\.cn/i.test(raw)
    || (String(contentType || "").includes("text/html") && /visitor|passport/i.test(raw));
}

function extractWeiboAiSearchMeta(html) {
  const match = String(html || "").match(
    /<ai-tab[^>]+data-q="([^"]*)"[^>]+data-pageid="([^"]*)"[^>]+data-queryid="([^"]*)"[^>]+data-userpic="([^"]*)"[^>]+data-uid="([^"]*)"[^>]+data-feedcate="([^"]*)"/i
  );
  if (!match) {
    return {
      query: "",
      pageId: "",
      queryId: "",
      feedCate: "0"
    };
  }
  return {
    query: safeText(decodeURIComponent(match[1] || "")),
    pageId: safeText(decodeURIComponent(match[2] || "")),
    queryId: safeText(decodeURIComponent(match[3] || "")),
    feedCate: safeText(decodeURIComponent(match[6] || "0")) || "0"
  };
}

function extractQuotedMblogIds(payload) {
  const ids = new Set();
  const addFromText = (value) => {
    const text = String(value || "");
    const matches = text.matchAll(/mblogid=([0-9]+)/g);
    for (const match of matches) {
      if (match[1]) {
        ids.add(match[1]);
      }
    }
  };

  addFromText(payload?.msg);
  addFromText(payload?.msg_json);
  addFromText(JSON.stringify(payload?.link_list || []));
  addFromText(JSON.stringify(payload?.reliable_tips || {}));

  return Array.from(ids);
}

async function fetchWeiboAiShowPayload(keyword, cookie = config.weibo.searchCookie) {
  const normalizedCookie = String(cookie || "").trim();
  if (!normalizedCookie) {
    throw new Error("微博搜索 Cookie 未配置，无法直连召回微博正文。");
  }

  const pageResponse = await axios.get(getWeiboSearchPageUrl(keyword), {
    headers: getWeiboSearchHeaders(normalizedCookie, keyword),
    timeout: 15000,
    validateStatus: () => true
  });

  const pageContentType = pageResponse.headers?.["content-type"] || "";
  if (isWeiboVisitorSystemResponse(pageResponse.data, pageContentType)) {
    throw new Error("微博搜索 Cookie 不可用，命中了 Visitor System。请更新可用 Cookie。");
  }
  if (pageResponse.status >= 400) {
    throw new Error(`微博智搜页面请求失败，HTTP ${pageResponse.status}`);
  }

  const pageMeta = extractWeiboAiSearchMeta(pageResponse.data);
  if (!pageMeta.feedCate) {
    throw new Error("微博智搜页面返回异常，未拿到 feed_cate。");
  }

  const form = new URLSearchParams();
  form.set("query", keyword);
  form.set("cot", "2");
  form.set("feed_cate", pageMeta.feedCate || "0");
  if (pageMeta.pageId) {
    form.set("page_id", pageMeta.pageId);
  }
  if (pageMeta.queryId) {
    form.set("query_id", pageMeta.queryId);
  }

  const showResponse = await axios.post(WEIBO_AI_SHOW_URL, form.toString(), {
    headers: getWeiboAjaxHeaders(normalizedCookie, keyword),
    timeout: 15000,
    validateStatus: () => true
  });

  if ([401, 403, 418, 432].includes(showResponse.status)) {
    throw new Error(`微博智搜 Cookie 不可用，接口返回 HTTP ${showResponse.status}。`);
  }
  if (showResponse.status >= 400) {
    throw new Error(`微博智搜接口请求失败，HTTP ${showResponse.status}`);
  }
  if (!showResponse.data || typeof showResponse.data !== "object") {
    throw new Error("微博智搜接口返回格式异常，未拿到 JSON。");
  }

  return {
    pageMeta,
    payload: showResponse.data
  };
}

async function fetchWeiboStatusById(statusId, keyword, cookie = config.weibo.searchCookie) {
  const normalizedCookie = String(cookie || "").trim();
  const response = await axios.get(WEIBO_STATUS_SHOW_URL, {
    params: { id: statusId },
    headers: {
      ...getWeiboAjaxHeaders(normalizedCookie, keyword),
      "Content-Type": undefined
    },
    timeout: 15000,
    validateStatus: () => true
  });

  if ([401, 403, 418, 432].includes(response.status)) {
    throw new Error(`微博正文接口不可用，HTTP ${response.status}`);
  }
  if (response.status >= 400) {
    throw new Error(`微博正文接口请求失败，HTTP ${response.status}`);
  }
  if (!response.data || typeof response.data !== "object" || response.data.error) {
    throw new Error(response.data?.msg || response.data?.error || "微博正文接口返回异常");
  }

  return response.data;
}

function buildWeiboSnippetFromStatus(status) {
  const snippet = safeText(status?.text_raw || stripHtml(status?.text || ""));
  if (!snippet || snippet.length < 12) {
    return null;
  }
  const screenName = safeText(status?.user?.screen_name || "微博用户");
  const createdAt = safeText(status?.created_at || "");
  const userId = safeText(status?.user?.idstr || status?.user?.id || "");
  const mblogid = safeText(status?.mblogid || status?.idstr || status?.id || "");
  const link = userId && mblogid
    ? `https://weibo.com/${userId}/${mblogid}`
    : getWeiboSearchPageUrl(screenName || WEIBO_SEARCH_CHECK_KEYWORD);

  return {
    title: `@${screenName}${createdAt ? ` · ${createdAt}` : ""}`,
    snippet,
    link,
    source: "微博智搜引用博文",
    statusId: safeText(status?.idstr || status?.id || "")
  };
}

async function fetchWeiboSearchContext(keyword, cookie = config.weibo.searchCookie) {
  const queryVariants = Array.from(new Set([
    safeText(keyword),
    safeText(keyword).includes("微博") ? "" : `${safeText(keyword)} 微博`
  ].filter(Boolean)));

  let pageMeta = null;
  let quotedIds = [];
  let selectedQuery = queryVariants[0] || keyword;
  for (const queryVariant of queryVariants) {
    const response = await fetchWeiboAiShowPayload(queryVariant, cookie);
    pageMeta = response.pageMeta;
    quotedIds = extractQuotedMblogIds(response.payload);
    selectedQuery = queryVariant;
    if (quotedIds.length) {
      break;
    }
  }

  if (!quotedIds.length) {
    throw new Error("微博智搜未返回可用引用博文。");
  }

  const results = [];
  const seen = new Set();
  for (const statusId of quotedIds) {
    if (results.length >= RICH_CONTEXT_SNIPPET_COUNT) {
      break;
    }
    try {
      const status = await fetchWeiboStatusById(statusId, selectedQuery, cookie);
      const snippet = buildWeiboSnippetFromStatus(status);
      if (!snippet) {
        continue;
      }
      const dedupeKey = `${safeText(status?.idstr || status?.id || "")}:${normalizeKeyword(snippet.snippet)}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      results.push(snippet);
    } catch (error) {
      logger.warn("topics", "weibo cited status fetch failed", {
        keyword,
        statusId,
        error: error.message
      });
    }
  }

  if (!results.length) {
    throw new Error("微博智搜已返回引用博文，但未成功拿到正文内容。");
  }

  logger.debug("topics", "weibo search recall", {
    keyword,
    selectedQuery,
    pageMeta,
    quotedIds,
    resultCount: results.length,
    results: results.map((item) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
      source: item.source
    }))
  });

  return results;
}

async function checkWeiboSearchCookieAvailability(cookieInput) {
  const cookie = String(cookieInput || "").trim();
  if (!cookie) {
    throw new Error("微博 Cookie 为空，无法校验。");
  }

  try {
    const results = await fetchWeiboSearchContext(WEIBO_SEARCH_CHECK_KEYWORD, cookie);
    return {
      available: true,
      resultCount: results.length,
      sampleTitles: results.map((item) => item.title),
      sampleLinks: results.map((item) => item.link)
    };
  } catch (error) {
    if (String(error.message || "").includes("未返回可用引用博文") || String(error.message || "").includes("未成功拿到正文内容")) {
      throw new Error("微博 Cookie 可能无效，或当前账号的微博智搜结果受限。请更换可用 Cookie 后重试。");
    }
    throw error;
  }
}

async function fetchSogouWebContext(keyword) {
  const response = await axios.get(SOGOU_WEB_SEARCH_URL, {
    params: { query: keyword },
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Referer: "https://www.sogou.com/",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    },
    timeout: 15000
  });

  const matches = Array.from(
    response.data.matchAll(/<a[^>]+href="(?<link>https?:\/\/[^\"]+)"[^>]*>(?<title>[\s\S]*?)<\/a>/gi)
  );
  const seen = new Set();
  const candidates = [];

  matches.forEach((match) => {
    if (candidates.length >= SEARCH_RESULT_CANDIDATE_COUNT) {
      return;
    }
    const link = decodeXml(match.groups?.link || "");
    const title = stripHtml(match.groups?.title || "");
    const normalizedTitle = safeText(title);
    if (!link || !normalizedTitle || normalizedTitle.length < 8) {
      return;
    }
    if (isBlockedSearchLink(link) || isBlockedSearchTitle(normalizedTitle)) {
      return;
    }
    const key = `${normalizedTitle}::${link}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push({ title: normalizedTitle, link });
  });

  const settled = await Promise.allSettled(
    candidates.map(async (candidate) => {
      const page = await axios.get(candidate.link, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        },
        timeout: 12000,
        maxRedirects: 5
      });
      const html = String(page.data || "");
      const metaDescription = extractMetaContent(html, "description") || extractMetaContent(html, "og:description", "property");
      const rawTitle = safeText(extractTitleFromHtml(html));
      const title = isBlockedSearchTitle(rawTitle) ? candidate.title : safeText(rawTitle || candidate.title);
      const bodySnippet = safeText(extractBodySnippet(html));
      const snippet = safeText(metaDescription || bodySnippet || candidate.title);
      if (!snippet || snippet.length < 20) {
        throw new Error("page snippet too short");
      }
      return {
        title,
        snippet,
        link: candidate.link,
        source: "搜狗搜索"
      };
    })
  );

  const results = settled
    .filter((item) => item.status === "fulfilled")
    .map((item) => item.value)
    .slice(0, RICH_CONTEXT_SNIPPET_COUNT);

  logger.debug("topics", "sogou search recall", {
    keyword,
    candidateCount: candidates.length,
    resultCount: results.length,
    results: results.map((item) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet
    }))
  });

  return results;
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
      logger.debug("topics", "topic source topics", {
        sourceId: sourceConfig.id,
        priority: sourceConfig.priority,
        topics: topics.map((topic) => ({
          rank: topic.rank,
          keyword: topic.keyword,
          label: topic.label,
          sourceName: topic.sourceName,
          heat: topic.heat
        }))
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
  logger.debug("topics", "merged topic candidates", {
    count: topics.length,
    topics: topics.map((topic) => ({
      rank: topic.rank,
      keyword: topic.keyword,
      label: topic.label,
      sourceId: topic.sourceId,
      sourceName: topic.sourceName
    }))
  });
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

async function buildRichTopicContext(topic) {
  if (!topic) {
    return null;
  }

  let news = Array.isArray(topic.news) ? topic.news : [];
  try {
    news = await fetchNewsContext(topic.keyword, RICH_CONTEXT_NEWS_COUNT);
  } catch (error) {
    logger.warn("topics", "rich news context fetch failed", {
      keyword: topic.keyword,
      sourceId: topic.sourceId,
      error: error.message
    });
  }

  const sourceFacts = [
    topic.label ? `来源标签：${safeText(topic.label)}` : "",
    topic.heat ? `来源热度：${topic.heat}` : "",
    topic.sourceName ? `来源渠道：${topic.sourceName}` : ""
  ].filter(Boolean);

  let snippets = [];
  let snippetSource = config.weibo.searchEnabled && config.weibo.searchCookie ? "weibo_ai_search" : "sogou";

  if (config.weibo.searchEnabled && config.weibo.searchCookie) {
    try {
      snippets = await fetchWeiboSearchContext(topic.keyword);
      sourceFacts.push(`微博直搜召回：${snippets.length} 条`);
    } catch (error) {
      logger.warn("topics", "weibo search recall failed, fallback to sogou", {
        keyword: topic.keyword,
        sourceId: topic.sourceId,
        error: error.message
      });
      snippetSource = "sogou_fallback";
      try {
        snippets = await fetchSogouWebContext(topic.keyword);
      } catch (fallbackError) {
        logger.warn("topics", "rich search context fetch failed", {
          keyword: topic.keyword,
          sourceId: topic.sourceId,
          error: fallbackError.message
        });
      }
    }
  } else {
    try {
      snippets = await fetchSogouWebContext(topic.keyword);
    } catch (error) {
      logger.warn("topics", "rich search context fetch failed", {
        keyword: topic.keyword,
        sourceId: topic.sourceId,
        error: error.message
      });
    }
  }

  logger.debug("topics", "rich topic context built", {
    keyword: topic.keyword,
    sourceId: topic.sourceId,
    newsCount: news.length,
    snippetCount: snippets.length,
    snippetSource,
    sourceFacts,
    news: news.map((item) => ({
      title: item.title,
      pubDate: item.pubDate,
      description: item.description
    })),
    snippets: snippets.map((item) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
      source: item.source
    }))
  });

  return {
    ...topic,
    news,
    snippets,
    sourceFacts
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
  buildRichTopicContext,
  buildCategoryNewsContext,
  fetchNewsContext,
  checkWeiboSearchCookieAvailability
};
