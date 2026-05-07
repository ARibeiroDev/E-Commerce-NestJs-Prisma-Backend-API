import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    type: String,
    description: 'User email or username',
    example: 'John_Doe23',
  })
  @IsNotEmpty({ message: 'Email or username required' })
  @IsString({ message: 'Email or username must be a string' })
  identifier: string;

  @ApiProperty({
    type: String,
    description: 'User password',
    pattern:
      'Password must contain at least one lowercase letter, one uppercase letter, one number, and can include special characters !@#$%&*_.?',
    minLength: 8,
    example: '',
  })
  @IsNotEmpty({ message: 'Password required' })
  @IsString({ message: 'Password must be a string' })
  password: string;
}
