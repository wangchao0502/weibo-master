const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const config = require("./config");

dayjs.extend(utc);
dayjs.extend(timezone);

function now() {
  return dayjs().tz(config.timezone);
}

function formatIso(input) {
  return dayjs(input).tz(config.timezone).format();
}

module.exports = {
  dayjs,
  now,
  formatIso
};
