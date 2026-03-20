function normalizeTextProtocol(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "moonshot" ? "moonshot" : "openai";
}

function inferTextProtocol(baseUrl = "", model = "", currentValue = "") {
  const normalized = normalizeTextProtocol(currentValue);
  if (/api\.moonshot\.cn/i.test(String(baseUrl || ""))) {
    return "moonshot";
  }
  if (currentValue) {
    return normalized;
  }
  if (/^kimi-/i.test(String(model || "").trim())) {
    return "moonshot";
  }
  return "openai";
}

function isMoonshotKimiModel(baseUrl = "", model = "", textProtocol = "") {
  const protocol = inferTextProtocol(baseUrl, model, textProtocol);
  return protocol === "moonshot" && /^kimi-/i.test(String(model || "").trim());
}

function resolveTextTemperature(baseUrl = "", model = "", textProtocol = "", fallback = 1, kimiThinkingEnabled = true) {
  if (isMoonshotKimiModel(baseUrl, model, textProtocol)) {
    return kimiThinkingEnabled === false ? 0.6 : 1;
  }
  return fallback;
}

function buildKimiThinkingPayload(options = {}) {
  const { baseUrl = "", model = "", textProtocol = "", kimiThinkingEnabled = true } = options;
  if (!isMoonshotKimiModel(baseUrl, model, textProtocol)) {
    return {};
  }
  if (kimiThinkingEnabled === false) {
    return {
      thinking: {
        type: "disabled"
      }
    };
  }
  return {};
}

module.exports = {
  normalizeTextProtocol,
  inferTextProtocol,
  isMoonshotKimiModel,
  resolveTextTemperature,
  buildKimiThinkingPayload
};
