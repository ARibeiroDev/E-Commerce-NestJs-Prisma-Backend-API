import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { LoggerService } from '../logger.service';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  constructor(private readonly logger: LoggerService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('user-agent') || 'unknown';

    // Mask IP, for privacy under GDPR regulations
    // IPv4: 1.2.3.4 -> 1.2.3.XXX
    // IPv6: 1:2:3:4 -> masked
    const maskedIp =
      ip && ip.includes('.') ? ip.replace(/\.\d+$/, '.XXX') : 'masked';

    const startTime = Date.now();

    // Log incoming request
    this.logger.log(
      `[Incoming] ${method} ${originalUrl} - ${maskedIp} - ${userAgent}`,
      'HTTP',
    );

    res.on('finish', () => {
      const duration = Date.now() - startTime;

      // Log response
      this.logger.log(
        `[Response] ${method} ${originalUrl} - ${res.statusCode} - ${duration}ms`,
        'HTTP',
      );
    });

    next();
  }
}
