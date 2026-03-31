const fs = require("fs");
const path = require("path");

const logFilePath = path.join(__dirname, "../Database/Logger.json");
let logData = [];

function init() {
  logData = [];
  saveLog();
  writeLog("SUCCESS", "Logger initialized & log session cleared.");
}

function saveLog() {
  const dir = path.dirname(logFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(logFilePath, JSON.stringify(logData, null, 2));
}

function writeLog(level, message) {
  const now = new Date();
  const timeFull = now.toISOString().replace(/T/, " ").replace(/\..+/, "");
  const timeSort = timeFull.split(" ")[1];

  logData.push({ timestamp: timeFull, level, message });
  saveLog();

  let levelBadge = "";
  let msgColor = "\x1b[0m";

  switch (level) {
    case "INFO":
      levelBadge = "\x1b[46m\x1b[30m INFO \x1b[0m";
      msgColor = "\x1b[36m";
      break;
    case "ERROR":
      levelBadge = "\x1b[41m\x1b[37m ERROR \x1b[0m";
      msgColor = "\x1b[31m";
      break;
    case "CMD":
      levelBadge = "\x1b[45m\x1b[37m CMD \x1b[0m";
      msgColor = "\x1b[35m";
      break;
    case "WARN":
      levelBadge = "\x1b[43m\x1b[30m WARN \x1b[0m";
      msgColor = "\x1b[33m";
      break;
    case "SUCCESS":
      levelBadge = "\x1b[42m\x1b[30m OK \x1b[0m";
      msgColor = "\x1b[32m";
      break;
    case "SEP":
      levelBadge = "\x1b[100m\x1b[37m ---- \x1b[0m";
      msgColor = "\x1b[90m";
      break;
    default:
      levelBadge = `\x1b[100m\x1b[37m ${level} \x1b[0m`;
      msgColor = "\x1b[0m";
  }

  console.log(
    `\x1b[90m[${timeSort}]\x1b[0m ${levelBadge} \x1b[90m›\x1b[0m ${msgColor}${message}\x1b[0m`,
  );
}

function separator(char = "═", length = 56) {
  const line = String(char).repeat(Math.max(1, length));
  writeLog("SEP", line);
}

module.exports = {
  init,
  info: (msg) => writeLog("INFO", msg),
  error: (msg) => writeLog("ERROR", msg),
  cmd: (msg) => writeLog("CMD", msg),
  warn: (msg) => writeLog("WARN", msg),
  success: (msg) => writeLog("SUCCESS", msg),
  separator,
};
