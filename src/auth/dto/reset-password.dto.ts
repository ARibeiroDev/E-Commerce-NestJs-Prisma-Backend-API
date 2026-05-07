import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    type: String,
    description: 'Reset password token',
    example: 'token',
  })
  @IsString()
  token: string;

  @ApiProperty({
    type: String,
    description: 'User password',
    pattern:
      'Password must contain at least one lowercase letter, one uppercase letter, one number, and can include special characters !@#$%&*_.?',
    minLength: 8,
    example: '',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[A-Za-z\d!@#$%&*_.?]{8,}$/, {
    message:
      'Password must contain at least one lowercase letter, one uppercase letter, one number, and can include only !@#$%&*_.?',
  })
  password: string;
}
