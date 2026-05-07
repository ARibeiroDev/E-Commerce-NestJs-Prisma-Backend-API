import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ProductVariantDto {
  @ApiProperty({
    example: 'Red',
    description: 'Variant color',
  })
  @IsString({ message: 'Color must be a string' })
  @MinLength(1, { message: 'Color must be at least 1 character long' })
  @MaxLength(30, { message: 'Color cannot exceed 30 characters' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as string),
  )
  color: string;

  @ApiProperty({
    example: 'M',
    description: 'Variant size',
  })
  @IsString({ message: 'Size must be a string' })
  @MinLength(1, { message: 'Size must be at least 1 character long' })
  @MaxLength(20, { message: 'Size cannot exceed 20 characters' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as string),
  )
  size: string;

  @ApiProperty({
    example: 50,
    description: 'Available stock',
    minimum: 0,
  })
  @IsInt({ message: 'Stock must be an integer' })
  @Min(0, { message: 'Stock cannot be less than 0' })
  stock: number;

  @ApiPropertyOptional({
    example: 10,
    description: 'Discount percentage (0-100)',
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber({}, { message: 'Discount must be a number' })
  @Min(0, { message: 'Discount cannot be less than 0' })
  @Max(100, { message: 'Discount cannot exceed 100' })
  discountPercentage?: number;
}
