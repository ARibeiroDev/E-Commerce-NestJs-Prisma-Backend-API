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

export class CreateUserDto extends EmailDto {
  @ApiProperty({
    type: String,
    description: 'User username',
    example: 'John_Doe23',
    minLength: 3,
    maxLength: 20,
  })
  @IsNotEmpty({ message: 'Username is required' })
  @IsString({ message: 'Username must be a string' })
  @MinLength(3, { message: 'Username must be at least 3 characters long' })
  @MaxLength(20, { message: 'Username cannot exceed 20 characters' })
  @Matches(/^[a-zA-Z0-9_]*$/, {
    message: 'Username must contain only letters, numbers, and underscores',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as string),
  )
  username: string;

  @ApiProperty({
    type: String,
    description: 'User password',
    pattern:
      'Password must contain at least one lowercase letter, one uppercase letter, one number, and can include special characters !@#$%&*_.?',
    minLength: 8,
    example: '',
  })
  @IsString({ message: 'Password must be a string' })
  @IsNotEmpty()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d!@#$%&*_.?]{8,}$/, {
    message:
      'Password must contain at least one lowercase letter, one uppercase letter, one number, and can include special characters !@#$%&*_.?',
  })
  password: string;
}
