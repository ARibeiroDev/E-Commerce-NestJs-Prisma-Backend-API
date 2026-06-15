import {
  IsOptional,
  IsString,
  IsBoolean,
  IsArray,
  IsIn,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '../../common/dtos/pagination-query.dto';

export class ProductQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true') // Parse query string to boolean
  featured?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value === 'true')
  isArchived?: boolean;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsArray()
  @Transform(({ value }) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.map((v) => String(v));
    return [String(value)];
  })
  tags?: string[];

  @IsOptional()
  @IsIn(['createdAt', 'basePrice', 'title'])
  sortBy?: 'createdAt' | 'basePrice' | 'title';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  orderBy?: 'asc' | 'desc';
}
