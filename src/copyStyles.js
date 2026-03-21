const COPY_STYLE_OPTIONS = [
  {
    id: "balanced",
    name: "通用博主风",
    description: "信息和表达平衡，适合大多数主题。",
    promptRules: [
      "整体保持均衡：有观点、有信息量，也有自然的人味，不要过度偏激或过度煽情",
      "语言要像成熟博主日常发微博，读起来顺，不端着，也不刻意抖包袱"
    ]
  },
  {
    id: "professional",
    name: "冷静专业风",
    description: "适合科技、教育、健康、财经等严谨主题。",
    promptRules: [
      "语气偏冷静专业，判断清晰，尽量减少情绪化表达",
      "优先保证准确性和边界感，表达像内行人在说人话，而不是像新闻播报"
    ]
  },
  {
    id: "witty",
    name: "轻松机灵风",
    description: "更口语化，允许适度抖机灵和幽默。",
    promptRules: [
      "整体更轻松口语，允许自然的小机灵、小吐槽和轻微反差感",
      "幽默要克制，像真人随手带一句，不要密集玩梗，也不要油腻"
    ]
  },
  {
    id: "warm",
    name: "温和陪伴风",
    description: "更柔和、克制，适合生活、情绪、日常观察类内容。",
    promptRules: [
      "语气温和、松弛、有陪伴感，像在认真分享自己的观察和感受",
      "避免攻击性和过强的表达，更多用细腻、稳妥、让人愿意读下去的写法"
    ]
  },
  {
    id: "insightful",
    name: "观点拆解风",
    description: "强调判断、观察和信息增量。",
    promptRules: [
      "更强调拆解和判断，适合把一个词条讲得更透一点，但不要写成长文评论",
      "可以适度点出表层现象背后的原因、趋势或误区，让内容更有识别度"
    ]
  },
  {
    id: "storytelling",
    name: "叙事分享风",
    description: "更像个人经历或观察式分享，适合生活化主题。",
    promptRules: [
      "可以用更强的场景感和叙事感来组织正文，像我在分享一次观察、经历或感受",
      "段落之间要有自然推进，不要空讲大道理，也不要写成散文腔"
    ]
  }
];

function getCopyStyleById(styleId = "balanced") {
  return COPY_STYLE_OPTIONS.find((item) => item.id === String(styleId || "").trim()) || COPY_STYLE_OPTIONS[0];
}

module.exports = {
  COPY_STYLE_OPTIONS,
  getCopyStyleById
};
