import {
  Controller,
  Get,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type RequestUser,
} from '../common/decorators/current-user.decorator';
import { UpdateUserDto } from './dto/update-user.dto';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Role } from 'generated/prisma/enums';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { PaginationQueryDto } from 'src/common/dtos/pagination-query.dto';
import { PaginatedResponse } from 'src/common/interfaces/paginated-response.interface';
import { UserResponse } from './interfaces/user-response.interface';
import { AdminUpdateUserDto } from './dto/admin-update.dto';
import { ApiBearerAuth } from '@nestjs/swagger';

@Controller('users')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  //Logged in user routes
  @Get('me')
  getMe(@CurrentUser() user: RequestUser) {
    return this.usersService.getMe(user.id);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: RequestUser,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.usersService.updateMe(user.id, updateUserDto);
  }

  // Admin only routes
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @UseGuards(RolesGuard)
  @Get()
  getAllUsers(
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResponse<UserResponse>> {
    return this.usersService.getAllUsers(query);
  }

  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @UseGuards(RolesGuard)
  @Patch(':id')
  adminUpdateUser(
    @CurrentUser() admin: RequestUser,
    @Param('id') targetUserId: string,
    @Body() adminUpdateUserDto: AdminUpdateUserDto,
  ) {
    return this.usersService.adminUpdateUser(
      admin.id,
      targetUserId,
      adminUpdateUserDto,
    );
  }

  @Delete(':id')
  deleteUser(
    @CurrentUser() user: RequestUser,
    @Param('id') targetUserId: string,
  ) {
    return this.usersService.deleteUser(user.id, targetUserId, user.role);
  }
}
