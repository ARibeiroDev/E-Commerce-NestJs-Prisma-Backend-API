import { ConsoleLogger, Injectable } from '@nestjs/common';

@Injectable()
export class LoggerService extends ConsoleLogger {
  // Centralized formatter for all logs, ensures structured JSON output
  private format(level: string, message: unknown, context?: string) {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      context,
      message,
    });
  }

  log(message: unknown, context?: string) {
    super.log(this.format('log', message, context));
  }

  warn(message: unknown, context?: string) {
    super.warn(this.format('warn', message, context));
  }

  error(message: unknown, trace?: string, context?: string) {
    const formattedMessage = this.format('error', message, context);

    // Only include stack in development to avoid leaking sensitive information like file paths, internal structure, sensitive debug info
    if (process.env.NODE_ENV === 'development') {
      super.error(formattedMessage, trace);
    } else {
      super.error(formattedMessage);
    }
  }
}
