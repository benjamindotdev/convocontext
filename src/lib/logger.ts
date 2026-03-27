type LogLevel = "debug" | "info" | "warn" | "error";

type JsonRecord = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[resolveLevel()];
}

function safeError(error: unknown): JsonRecord {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

export type Logger = {
  debug: (message: string, meta?: JsonRecord) => void;
  info: (message: string, meta?: JsonRecord) => void;
  warn: (message: string, meta?: JsonRecord) => void;
  error: (message: string, meta?: JsonRecord) => void;
  child: (extraMeta: JsonRecord) => Logger;
};

export function createLogger(scope: string, baseMeta: JsonRecord = {}): Logger {
  const write = (level: LogLevel, message: string, meta: JsonRecord = {}) => {
    if (!shouldLog(level)) return;

    const payload = {
      ts: new Date().toISOString(),
      level,
      scope,
      message,
      ...baseMeta,
      ...meta,
    };

    if (level === "error") {
      console.error(JSON.stringify(payload));
      return;
    }

    if (level === "warn") {
      console.warn(JSON.stringify(payload));
      return;
    }

    console.log(JSON.stringify(payload));
  };

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
    child: (extraMeta) => createLogger(scope, { ...baseMeta, ...extraMeta }),
  };
}

export function errorMeta(error: unknown): JsonRecord {
  return {
    error: safeError(error),
  };
}
