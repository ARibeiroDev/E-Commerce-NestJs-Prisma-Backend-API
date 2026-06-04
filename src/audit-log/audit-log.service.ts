import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OnEvent } from '@nestjs/event-emitter';
import { AuditLogEvent } from './events/audit-log.event';
import { LoggerService } from 'src/logger/logger.service';
import { PaginationQueryDto } from 'src/common/dtos/pagination-query.dto';

@Injectable()
export class AuditLogService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly logger: LoggerService,
  ) {}

  @OnEvent('audit.log')
  async handleAuditLogEvent(payload: AuditLogEvent) {
    try {
      await this.databaseService.auditLog.create({
        data: {
          action: payload.action,
          actorId: payload.actorId,
          targetId: payload.targetId,
          targetType: payload.targetType,
          oldValues: payload.oldValues
            ? JSON.parse(JSON.stringify(payload.oldValues))
            : null,
          newValues: payload.newValues
            ? JSON.parse(JSON.stringify(payload.newValues))
            : null,
        },
      });
    } catch (error: unknown) {
      this.logger.error(error instanceof Error ? error.message : error);
    }
  }

  // Helper method to fetch logs for dashboard
  async getLogs(query: PaginationQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const [totalItems, data] = await this.databaseService.$transaction([
      this.databaseService.auditLog.count(),
      this.databaseService.auditLog.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { actor: { select: { username: true, email: true } } },
      }),
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    return {
      data,
      meta: {
        totalItems,
        itemsPerPage: limit,
        totalPages,
        currentPage: page,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages,
      },
    };
  }
}
