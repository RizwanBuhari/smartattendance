// Logs every incoming HTTP request with its source address.
//
// Added as a diagnostic: when the mobile app "doesn't work", the first question
// is always whether its requests are arriving at all. Without this the backend
// is silent and a network problem is indistinguishable from a logic problem.
//
// Cheap enough to leave on — one line per request.
import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const startedAt = Date.now();
    // Whoever is really calling: the phone/emulator's address as the cluster
    // sees it. Useful for confirming a device reached us at all.
    const from = req.socket?.remoteAddress ?? 'unknown';

    res.on('finish', () => {
      const ms = Date.now() - startedAt;
      this.logger.log(
        `${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms  from=${from}`,
      );
    });

    next();
  }
}
