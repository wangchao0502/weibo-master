const path = require("path");
const express = require("express");
const cors = require("cors");
const config = require("./config");
const authRoutes = require("./routes/authRoutes");
const contentRoutes = require("./routes/contentRoutes");
const statsRoutes = require("./routes/statsRoutes");
const systemRoutes = require("./routes/systemRoutes");
const logger = require("./logger");

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      logger.info("http", `${req.method} ${req.originalUrl}`, {
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt
      });
    });
    next();
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/content", contentRoutes);
  app.use("/api/stats", statsRoutes);
  app.use("/api/system", systemRoutes);

  app.use(express.static(path.join(config.rootDir, "public")));

  app.get("*", (req, res) => {
    res.sendFile(path.join(config.rootDir, "public", "index.html"));
  });

  return app;
}

module.exports = {
  createApp
};
