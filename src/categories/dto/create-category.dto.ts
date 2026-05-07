import { IsString, MinLength, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({
    example: 'Shoes',
    description: 'Category name',
    type: String,
    minLength: 1,
    maxLength: 100,
  })
  @IsString({ message: 'Name must be a string' })
  @MinLength(1, { message: 'Name must be at least 1 character long' })
  @MaxLength(100, { message: 'Name cannot exceed 100 characters' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as string),
  )
  name: string;
}
