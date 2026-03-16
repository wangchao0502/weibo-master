const fs = require("fs/promises");
const path = require("path");
const config = require("./config");

const logFile = path.join(config.logsDir, "app.log");
let initPromise;

function ensureLogDir() {
  if (!initPromise) {
    initPromise = fs.mkdir(config.logsDir, { recursive: true });
  }
  return initPromise;
}

function serializeMeta(meta) {
  if (!meta) {
    return "";
  }
  try {
    return ` ${JSON.stringify(meta)}`;
  } catch (_) {
    return " [unserializable-meta]";
  }
}

function write(level, scope, message, meta) {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} [${scope}] ${message}${serializeMeta(meta)}`;
  const method = level === "error" ? "error" : level === "warn" ? "warn" : "log";
  console[method](line);
  ensureLogDir()
    .then(() => fs.appendFile(logFile, `${line}\n`, "utf8"))
    .catch((error) => {
      console.error(`${new Date().toISOString()} ERROR [logger] failed to write log`, error.message);
    });
}

module.exports = {
  debug(scope, message, meta) {
    write("debug", scope, message, meta);
  },
  info(scope, message, meta) {
    write("info", scope, message, meta);
  },
  warn(scope, message, meta) {
    write("warn", scope, message, meta);
  },
  error(scope, message, meta) {
    write("error", scope, message, meta);
  }
};
