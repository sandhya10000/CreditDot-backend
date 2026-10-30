const fs = require("fs");
const path = require("path");

const LOGS_DIR = path.join(__dirname, "..", "logs");

/**
 * Ensures the logs directory exists.
 */
function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * Returns today's log file path: logs/ai-analysis-YYYY-MM-DD.log
 */
function getLogFilePath() {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  return path.join(LOGS_DIR, `ai-analysis-${today}.log`);
}

/**
 * Formats and writes a log line to file and console.
 * Line format: ISO timestamp | LEVEL | analysisId | step | message | durationMs
 */
function writeLog(level, analysisId, step, message, durationMs = null) {
  const timestamp = new Date().toISOString();
  const idStr = analysisId ? String(analysisId) : "-";
  const stepStr = step || "-";
  const durStr = durationMs !== null && durationMs !== undefined ? `${durationMs}ms` : "-";
  const safeMessage = typeof message === "string" ? message.replace(/[\r\n]+/g, " ") : JSON.stringify(message);

  const line = `${timestamp} | ${level.toUpperCase()} | ${idStr} | ${stepStr} | ${safeMessage} | ${durStr}`;

  // Console output with [AI-ANALYSIS] prefix
  console.log(`[AI-ANALYSIS] ${line}`);

  // Append to log file
  try {
    ensureLogsDir();
    fs.appendFileSync(getLogFilePath(), line + "\n", "utf8");
  } catch (err) {
    console.error(`[AI-ANALYSIS] Failed to write to log file: ${err.message}`);
  }
}

/**
 * Creates an execution tracker for an AI Analysis run.
 * @param {string|mongoose.Types.ObjectId} [analysisId]
 */
function createTracker(analysisId = null) {
  const startTime = Date.now();
  let currentAnalysisId = analysisId ? String(analysisId) : null;
  const stepTimings = {};
  let currentStep = null;
  let currentStepStart = null;

  return {
    setAnalysisId(id) {
      currentAnalysisId = id ? String(id) : null;
    },

    getAnalysisId() {
      return currentAnalysisId;
    },

    /**
     * Mark the start of a step.
     */
    start(step) {
      currentStep = step;
      currentStepStart = Date.now();
    },

    /**
     * Mark the completion of the current step or a specified step with a message.
     */
    end(message, stepOverride = null) {
      const step = stepOverride || currentStep || "step";
      const start = currentStepStart || Date.now();
      const durationMs = Date.now() - start;
      stepTimings[step] = durationMs;
      currentStep = null;
      currentStepStart = null;

      writeLog("INFO", currentAnalysisId, step, message, durationMs);
      return durationMs;
    },

    /**
     * Log an informative message for a step with duration (or null).
     */
    info(step, message, durationMs = null) {
      writeLog("INFO", currentAnalysisId, step, message, durationMs);
    },

    /**
     * Log a warning message.
     */
    warn(step, message, durationMs = null) {
      writeLog("WARN", currentAnalysisId, step, message, durationMs);
    },

    /**
     * Handles failure logging.
     * Logs error name, message, stack, HTTP status, and API error body (error.response?.data).
     * Never logs full document content or API keys.
     * Returns { failedStep, detail } for storing on AIAnalysis document.
     */
    fail(error, extra = {}) {
      const failedStep = extra.step || currentStep || "unknown";
      const durationMs = currentStepStart ? Date.now() - currentStepStart : null;
      if (durationMs !== null) {
        stepTimings[failedStep] = durationMs;
      }

      const errorName = error?.name || "Error";
      const errorMessage = error?.message || String(error);
      const httpStatus = error?.status || error?.response?.status || extra.status || null;
      const apiBody = error?.response?.data || error?.error?.message || null;
      const stack = error?.stack ? error.stack.split("\n").slice(0, 5).join(" -> ").replace(/[\r\n]+/g, " ") : null;

      let msg = `${errorName}: ${errorMessage}`;
      if (httpStatus) msg += ` | HTTP status: ${httpStatus}`;
      if (apiBody) {
        const bodyStr = typeof apiBody === "object" ? JSON.stringify(apiBody) : String(apiBody);
        msg += ` | API body: ${bodyStr}`;
      }
      if (extra.reason) {
        msg += ` | Reason: ${extra.reason}`;
      }
      if (extra.snippet) {
        msg += ` | Snippet: ${extra.snippet}`;
      }
      if (stack) {
        msg += ` | Stack: ${stack}`;
      }

      writeLog("ERROR", currentAnalysisId, failedStep, msg, durationMs);

      // Detail string for DB storage (max 1000 chars)
      let detail = `${errorName}: ${errorMessage}`;
      if (httpStatus) detail += ` (HTTP ${httpStatus})`;
      if (apiBody) {
        const bodyStr = typeof apiBody === "object" ? JSON.stringify(apiBody) : String(apiBody);
        detail += ` | API body: ${bodyStr}`;
      }
      if (extra.reason) {
        detail += ` | ${extra.reason}`;
      }
      detail = detail.substring(0, 1000);

      return {
        failedStep,
        detail,
      };
    },

    /**
     * Logs a TOTAL line with total duration and breakdown of time spent per step.
     */
    finish(status) {
      const totalDurationMs = Date.now() - startTime;
      const breakdown = Object.entries(stepTimings)
        .map(([s, d]) => `${s}: ${d}ms`)
        .join(", ");
      const msg = `Status: ${status} | Total duration: ${totalDurationMs}ms | Steps: [${breakdown || "none"}]`;

      writeLog("TOTAL", currentAnalysisId, "finish", msg, totalDurationMs);
      return { totalDurationMs, stepTimings };
    },

    getTimings() {
      return { totalDurationMs: Date.now() - startTime, stepTimings };
    },
  };
}

module.exports = {
  createTracker,
  writeLog,
};

