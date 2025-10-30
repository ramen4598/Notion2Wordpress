import { config } from '../config/index.js';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const logLevelMap: Record<string, LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
};

class Logger {
  private level: LogLevel;

  constructor() {
    this.level = logLevelMap[config.logLevel.toLowerCase()] || LogLevel.INFO;
  }

  private log(level: LogLevel, message: string, data?: any) {
    if (level < this.level) return;

    const timestamp = new Date().toISOString();
    const levelName = LogLevel[level];
    const logMessage = data
      ? `[${timestamp}] [${levelName}] ${message} ${JSON.stringify(data)}`
      : `[${timestamp}] [${levelName}] ${message}`;

    if (level >= LogLevel.ERROR) {
      console.error(logMessage);
    } else {
      console.log(logMessage);
    }
  }

  debug(message: string, data?: any) {
    this.log(LogLevel.DEBUG, message, data);
  }

  info(message: string, data?: any) {
    this.log(LogLevel.INFO, message, data);
  }

  warn(message: string, data?: any) {
    this.log(LogLevel.WARN, message, data);
  }

  error(message: string, error?: Error | any) {
    const errorData = error
      ? {
          message: error.message,
          stack: error.stack,
          ...error,
        }
      : undefined;
    this.log(LogLevel.ERROR, message, errorData);
  }
}

export const logger = new Logger();
