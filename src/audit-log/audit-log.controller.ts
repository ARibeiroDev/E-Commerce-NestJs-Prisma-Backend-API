import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from 'generated/prisma/enums';
import { PaginationQueryDto } from '../common/dtos/pagination-query.dto';
import { PaginatedResponse } from 'src/common/interfaces/paginated-response.interface';

@Controller('audit-log')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Roles(Role.SUPERADMIN)
  @Get()
  async getLogs(
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResponse<any>> {
    const { page, limit } = query;
    return this.auditLogService.getLogs({ page, limit });
  }
}
