const cron = require("node-cron");
const config = require("./config");
const { now } = require("./time");
const {
  generateDraftForSlot,
  sendReminderForSlot
} = require("./services/contentService");
const { backupDatabase } = require("./services/backupService");
const { syncStats } = require("./services/statsService");
const {
  getScheduleSettings,
  isManagedPublishSlot,
  getTriggeredPublishSlot
} = require("./services/settingsService");
const logger = require("./logger");

let runningGenerate = false;
let runningReminder = false;
let runningSync = false;

async function runHourlyGenerate() {
  if (runningGenerate) {
    return;
  }
  runningGenerate = true;
  try {
    const schedule = await getScheduleSettings();
    if (!schedule.enabled) {
      return;
    }
    const slotTime = getTriggeredPublishSlot(now(), schedule.generateLeadMinutes);
    if (!slotTime || !isManagedPublishSlot(slotTime, schedule)) {
      return;
    }
    logger.info("scheduler", "running generate job", {
      slotTime: slotTime.format(),
      leadMinutes: schedule.generateLeadMinutes
    });
    await generateDraftForSlot(slotTime);
  } catch (error) {
    logger.error("scheduler", "generate job failed", { error: error.message });
  } finally {
    runningGenerate = false;
  }
}

async function runHourlyReminder() {
  if (runningReminder) {
    return;
  }
  runningReminder = true;
  try {
    const schedule = await getScheduleSettings();
    if (!schedule.enabled) {
      return;
    }
    const slotTime = getTriggeredPublishSlot(now(), schedule.reminderLeadMinutes);
    if (!slotTime || !isManagedPublishSlot(slotTime, schedule)) {
      return;
    }
    logger.info("scheduler", "running reminder job", {
      slotTime: slotTime.format(),
      leadMinutes: schedule.reminderLeadMinutes
    });
    await sendReminderForSlot(slotTime);
  } catch (error) {
    logger.error("scheduler", "reminder job failed", { error: error.message });
  } finally {
    runningReminder = false;
  }
}

async function runMetricsSync() {
  if (!config.autoSyncMetrics || runningSync) {
    return;
  }
  runningSync = true;
  try {
    await syncStats();
  } catch (error) {
    logger.error("scheduler", "metrics sync failed", { error: error.message });
  } finally {
    runningSync = false;
  }
}

function startScheduler() {
  cron.schedule("* * * * *", runHourlyGenerate, { timezone: config.timezone });
  cron.schedule("* * * * *", runHourlyReminder, { timezone: config.timezone });
  cron.schedule("30 0 * * *", async () => {
    try {
      await backupDatabase();
    } catch (error) {
      logger.error("scheduler", "backup job failed", { error: error.message });
    }
  }, { timezone: config.timezone });
  cron.schedule("10 */2 * * *", runMetricsSync, { timezone: config.timezone });
  logger.info("scheduler", "scheduler started", { timezone: config.timezone });
}

module.exports = {
  startScheduler,
  runHourlyGenerate,
  runHourlyReminder,
  runMetricsSync
};
