import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dtos/pagination-query.dto';

export class OrderQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['createdAt', 'status'])
  sortBy?: 'createdAt' | 'status';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  orderBy?: 'asc' | 'desc';
}
