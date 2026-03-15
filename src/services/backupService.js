const fs = require("fs/promises");
const path = require("path");
const config = require("../config");
const { now } = require("../time");
const logger = require("../logger");

async function backupDatabase() {
  const timestamp = now().format("YYYYMMDD-HHmmss");
  const fileName = `weibo-manager-${timestamp}.db`;
  const target = path.join(config.backupDir, fileName);
  await fs.mkdir(config.backupDir, { recursive: true });
  await fs.copyFile(config.dbPath, target);
  logger.info("backup", "database backup created", { path: target });
  return {
    fileName,
    path: target,
    createdAt: now().format()
  };
}

async function listBackups() {
  await fs.mkdir(config.backupDir, { recursive: true });
  const items = await fs.readdir(config.backupDir, { withFileTypes: true });
  const files = items
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  return files;
}

module.exports = {
  backupDatabase,
  listBackups
};
