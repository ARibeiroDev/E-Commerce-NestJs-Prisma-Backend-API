import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { EmailDto } from '../../common/dtos/email.dto';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ContactDto extends EmailDto {
  @ApiProperty({
    type: String,
    description: 'Full Name',
    example: 'John Doe',
    minLength: 2,
    maxLength: 50,
  })
  @IsNotEmpty({ message: 'Full Name is required' })
  @IsString({ message: 'Full Name must be a string' })
  @MinLength(2, { message: 'Full Name must be at least 2 characters long' })
  @MaxLength(50, { message: 'Full Name cannot exceed 50 characters' })
  @Matches(/^[a-zA-Z\s\-']+$/, {
    message:
      'Full Name must contain only letters, spaces, hyphens, and apostrophes',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as string),
  )
  fullName: string;

  @ApiProperty({
    type: String,
    description: 'Message',
    minLength: 8,
    maxLength: 1000,
    example: 'Hello, I need assistance with my account.',
  })
  @IsString({ message: 'Message must be a string' })
  @IsNotEmpty()
  @MinLength(8, { message: 'Message must be at least 8 characters long' })
  @MaxLength(1000, { message: 'Message cannot exceed 1000 characters' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as string),
  )
  message: string;
}
