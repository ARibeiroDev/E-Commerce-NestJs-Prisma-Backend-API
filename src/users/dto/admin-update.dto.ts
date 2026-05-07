import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { Role } from 'generated/prisma/enums';

export class AdminUpdateUserDto {
  @ApiPropertyOptional({
    type: String,
    enum: Role,
    description: 'User role',
    example: Role.USER,
  })
  @IsOptional()
  role?: Role;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'User status',
    example: true,
  })
  @IsOptional()
  isActive?: boolean;
}
