import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dtos/pagination-query.dto';
import { OrderStatus } from 'generated/prisma/enums';

export class OrderQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['createdAt', 'status'])
  sortBy?: 'createdAt' | 'status';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  orderBy?: 'asc' | 'desc';

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsString()
  search?: string;
}
