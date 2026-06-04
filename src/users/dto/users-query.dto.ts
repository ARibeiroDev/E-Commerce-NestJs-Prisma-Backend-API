import { IsOptional, IsString, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../common/dtos/pagination-query.dto';

export class GetUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value as boolean;
  })
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value as boolean;
  })
  @IsBoolean()
  isVerified?: boolean;
}
