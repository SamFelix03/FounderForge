export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

export function createLogger(scope: string) {
  function write(level: LogLevel, message: string, fields?: LogFields) {
    const line = {
      ts: new Date().toISOString(),
      level,
      scope,
      message,
      ...fields,
    };
    const payload = JSON.stringify(line);
    if (level === "error") {
      console.error(payload);
    } else if (level === "warn") {
      console.warn(payload);
    } else {
      console.log(payload);
    }
  }

  return {
    debug: (message: string, fields?: LogFields) => write("debug", message, fields),
    info: (message: string, fields?: LogFields) => write("info", message, fields),
    warn: (message: string, fields?: LogFields) => write("warn", message, fields),
    error: (message: string, fields?: LogFields) => write("error", message, fields),
  };
}

export type Logger = ReturnType<typeof createLogger>;

export { loadRootEnv } from "./loadEnv.js";
