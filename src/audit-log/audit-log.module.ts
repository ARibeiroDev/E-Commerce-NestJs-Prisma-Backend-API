import { Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { AuditLogController } from './audit-log.controller';
import { LoggerModule } from '../logger/logger.module';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule, LoggerModule],
  controllers: [AuditLogController],
  providers: [AuditLogService],
})
export class AuditLogModule {}
