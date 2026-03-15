const TOPIC_SOURCES = [
  {
    id: "weibo_hot_search",
    name: "微博热搜",
    description: "微博站内实时热搜，适合强时效大众议题。",
    type: "trend",
    defaultEnabled: true,
    defaultPriority: 10
  },
  {
    id: "zhihu_hot",
    name: "知乎热榜",
    description: "知乎全站热榜，适合观点型和讨论型话题。",
    type: "trend",
    defaultEnabled: false,
    defaultPriority: 20
  },
  {
    id: "google_news_cn",
    name: "Google 新闻热点",
    description: "中文新闻头条聚合，适合补充更广泛的资讯线索。",
    type: "news",
    defaultEnabled: true,
    defaultPriority: 30
  }
];

const TOPIC_SOURCE_MAP = new Map(TOPIC_SOURCES.map((item) => [item.id, item]));

function getTopicSourceById(id) {
  return TOPIC_SOURCE_MAP.get(String(id || "")) || null;
}

function getDefaultTopicSourceConfigs() {
  return TOPIC_SOURCES.map((item) => ({
    id: item.id,
    enabled: item.defaultEnabled,
    priority: item.defaultPriority
  }));
}

function normalizeTopicSourceConfigs(input = []) {
  const merged = new Map(getDefaultTopicSourceConfigs().map((item) => [item.id, item]));

  if (Array.isArray(input)) {
    input.forEach((item) => {
      const source = getTopicSourceById(item?.id);
      if (!source) {
        return;
      }
      const priority = Number(item.priority);
      merged.set(source.id, {
        id: source.id,
        enabled: item.enabled === undefined ? true : Boolean(item.enabled),
        priority: Number.isInteger(priority) ? Math.max(1, Math.min(priority, 999)) : source.defaultPriority
      });
    });
  }

  return TOPIC_SOURCES.map((item) => merged.get(item.id)).sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }
    return left.id.localeCompare(right.id);
  });
}

function getEnabledTopicSourceConfigs(input = []) {
  return normalizeTopicSourceConfigs(input).filter((item) => item.enabled);
}

module.exports = {
  TOPIC_SOURCES,
  getTopicSourceById,
  getDefaultTopicSourceConfigs,
  normalizeTopicSourceConfigs,
  getEnabledTopicSourceConfigs
};
