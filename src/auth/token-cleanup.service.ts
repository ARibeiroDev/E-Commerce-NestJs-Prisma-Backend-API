import { Injectable } from '@nestjs/common';
import { LoggerService } from '../logger/logger.service';
import { DatabaseService } from '../database/database.service';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class TokenCleanupService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly logger: LoggerService,
  ) {}

  // Separate service for token cleanup to make it easier to test
  // Keeps SOLID S(Single Responsibility Principle) principles and separation of concerns
  // Future scalability (Worker pattern), multiple servers, etc.

  /**
   * Runs every day at midnight
   * Deletes all refresh tokens that have mathematically expired
   * 'Revoked tokens only' aren't deleted to preserve the token reuse detection tripwire
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupExpiredTokens() {
    this.logger.log('Starting scheduled cleanup of expired tokens...');

    try {
      const result = await this.databaseService.refreshToken.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
        },
      });

      this.logger.log(`Successfully purged ${result.count} expired tokens.}`);
    } catch (error: unknown) {
      const errorMsg =
        error instanceof Error
          ? error.message
          : 'Unknown database error occurred';
      const errorTrace = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Failed to clean up expired tokens: ${errorMsg}`,
        errorTrace,
      );
    }
  }
}
