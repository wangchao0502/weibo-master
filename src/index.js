require("dotenv").config();
const config = require("./config");

process.env.TZ = config.timezone;

const { getDb } = require("./db");
const { createApp } = require("./app");
const { startScheduler } = require("./scheduler");
const logger = require("./logger");

async function main() {
  await getDb();
  const app = createApp();
  app.listen(config.port, () => {
    logger.info("server", "server listening", {
      url: `http://localhost:${config.port}`,
      timezone: config.timezone
    });
  });
  startScheduler();
}

main().catch((error) => {
  logger.error("server", "failed to start app", { error: error.message });
  process.exit(1);
});
