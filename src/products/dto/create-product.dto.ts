import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ProductVariantDto } from './create-variant.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductDto {
  @ApiProperty({
    example: 'Nike Air Max 90',
    description: 'Product title',
    minLength: 2,
    maxLength: 100,
  })
  @IsString({ message: 'Product title must be a string' })
  @MinLength(2, { message: 'Product title must be at least 2 characters long' })
  @MaxLength(100, { message: 'Product title cannot exceed 100 characters' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as string),
  )
  title: string;

  @ApiProperty({
    example: 'Comfortable running shoes with great cushioning',
    description: 'Detailed product description',
    minLength: 10,
    maxLength: 1000,
  })
  @IsString({ message: 'Description must be a string' })
  @MinLength(10, { message: 'Description must be at least 10 characters long' })
  @MaxLength(1000, { message: 'Description cannot exceed 1000 characters' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as string),
  )
  description: string;

  @ApiPropertyOptional({
    example: [
      'https://example.com/image1.jpg',
      'https://example.com/image2.jpg',
    ],
    description: 'List of product image URLs',
    type: [String],
  })
  @IsArray({ message: 'Images must be an array' })
  @IsString({ each: true, message: 'Each image must be a string URL' })
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return []; // return empty array
    if (Array.isArray(value)) return value.map((v) => String(v)); // ensure string[]
    return [String(value)]; // single string => array
  })
  images?: string[];

  @ApiProperty({
    example: 'clx123abc456',
    description: 'Category ID (must exist)',
  })
  @IsString({ message: 'Category ID must be a string' })
  @MinLength(2, { message: 'Category ID must be at least 2 characters' })
  @MaxLength(100, { message: 'Category ID cannot exceed 100 characters' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as string),
  )
  categoryId: string;

  @ApiProperty({
    example: 129.99,
    description: 'Base price before discounts',
    minimum: 0,
  })
  @IsNumber({}, { message: 'Price must be a number' })
  @Min(0, { message: 'Price cannot be less than 0' })
  basePrice: number;

  @ApiPropertyOptional({
    example: ['shoes', 'nike', 'sport'],
    description: 'Tags for filtering/search',
    type: [String],
  })
  @IsArray({ message: 'Tags must be an array' })
  @IsString({ each: true, message: 'Each tag must be a string' })
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.map((v) => String(v));
    return [String(value)];
  })
  tags?: string[];

  @ApiPropertyOptional({
    example: true,
    description: 'Flag to feature product on homepage',
  })
  @IsBoolean()
  @IsOptional()
  featured?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Flag to soft-delete product',
  })
  @IsBoolean()
  @IsOptional()
  isArchived?: boolean;

  @ApiProperty({
    type: () => ProductVariantDto,
    isArray: true,
    description: 'List of product variants',
  })
  @IsArray({ message: 'At least one variant is required' })
  @ArrayMinSize(1, { message: 'At least one variant is required' })
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants: ProductVariantDto[];
}
