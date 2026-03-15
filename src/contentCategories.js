const COMMON_CATEGORIES = [
  {
    id: "technology",
    name: "科技",
    description: "互联网、AI、手机、数码、软件、平台产品更新",
    keywords: ["科技", "AI", "人工智能", "手机", "芯片", "互联网", "软件", "数码"]
  },
  {
    id: "finance",
    name: "财经",
    description: "资本市场、公司财报、消费趋势、宏观经济、投资理财",
    keywords: ["财经", "股市", "基金", "理财", "财报", "经济", "消费", "金融"]
  },
  {
    id: "entertainment",
    name: "娱乐",
    description: "明星、影视、综艺、演唱会、文娱事件",
    keywords: ["娱乐", "明星", "电影", "电视剧", "综艺", "演唱会", "艺人", "偶像"]
  },
  {
    id: "military",
    name: "军事",
    description: "国防、军工、装备、国际安全、军演动态",
    keywords: ["军事", "国防", "军工", "装备", "军演", "海军", "空军", "安全"]
  },
  {
    id: "sports",
    name: "体育",
    description: "足球、篮球、电竞、赛事成绩、运动员动态",
    keywords: ["体育", "足球", "篮球", "比赛", "冠军", "运动员", "赛事", "电竞"]
  },
  {
    id: "society",
    name: "社会",
    description: "民生、公共事件、社会议题、热点争议",
    keywords: ["社会", "民生", "通报", "事件", "调查", "公共", "争议", "热点"]
  },
  {
    id: "international",
    name: "国际",
    description: "国际新闻、外交、海外局势、全球热点",
    keywords: ["国际", "外交", "海外", "全球", "局势", "出海", "欧美", "日韩"]
  },
  {
    id: "auto",
    name: "汽车",
    description: "新能源车、车企动态、智能驾驶、出行消费",
    keywords: ["汽车", "新能源", "车企", "智驾", "电动车", "油车", "比亚迪", "特斯拉"]
  },
  {
    id: "gaming",
    name: "游戏",
    description: "手游、主机、PC 游戏、电竞产业、厂商发布",
    keywords: ["游戏", "手游", "主机", "电竞", "Steam", "玩家", "版本", "上线"]
  },
  {
    id: "education",
    name: "教育",
    description: "考试、升学、校园、教育政策、家长关注议题",
    keywords: ["教育", "高考", "考研", "校园", "考试", "升学", "学生", "教师"]
  },
  {
    id: "health",
    name: "健康",
    description: "健康管理、营养、疾病防护、医疗行业动态",
    keywords: ["健康", "医疗", "营养", "医院", "疾病", "医生", "减脂", "药品"]
  },
  {
    id: "lifestyle",
    name: "生活方式",
    description: "消费、旅行、美食、居家、日常趋势",
    keywords: ["生活", "旅行", "美食", "居家", "咖啡", "打卡", "消费", "日常"]
  }
];

const CATEGORY_MAP = new Map(COMMON_CATEGORIES.map((item) => [item.id, item]));

function getCategoryById(id) {
  return CATEGORY_MAP.get(id) || null;
}

function getCategoriesByIds(ids = []) {
  return ids.map((id) => getCategoryById(id)).filter(Boolean);
}

module.exports = {
  COMMON_CATEGORIES,
  getCategoryById,
  getCategoriesByIds
};
