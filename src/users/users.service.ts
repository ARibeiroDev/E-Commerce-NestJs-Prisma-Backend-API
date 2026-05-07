import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UpdateUserDto } from './dto/update-user.dto';
import bcrypt from 'bcrypt';
import { PaginationQueryDto } from '../common/dtos/pagination-query.dto';
import { AdminUpdateUserDto } from './dto/admin-update.dto';
import { Role } from 'generated/prisma/enums';

@Injectable()
export class UsersService {
  constructor(private readonly databaseService: DatabaseService) {}

  async getMe(userId: string) {
    const user = await this.databaseService.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
      },
    });

    if (!user) throw new NotFoundException('User not found');

    return user;
  }

  async updateMe(userId: string, updateUserDto: UpdateUserDto) {
    const { username, password } = updateUserDto;

    const updateData: Partial<UpdateUserDto> = {};

    if (username) updateData.username = username;
    if (password) updateData.password = await bcrypt.hash(password, 10);

    const updatedUser = await this.databaseService.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
      },
    });

    return updatedUser;
  }

  async getAllUsers(query: PaginationQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const [totalItems, data] = await this.databaseService.$transaction([
      this.databaseService.user.count(),
      this.databaseService.user.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          isActive: true,
          isVerified: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      data,
      meta: {
        totalItems,
        itemsPerPage: limit,
        totalPages: Math.ceil(totalItems / limit),
        currentPage: page,
        hasPreviousPage: page > 1,
        hasNextPage: page * limit < totalItems,
      },
    };
  }

  async adminUpdateUser(
    adminId: string,
    targetUserId: string,
    adminUpdateUserDto: AdminUpdateUserDto,
  ) {
    if (adminId === targetUserId && adminUpdateUserDto.role === Role.USER) {
      throw new BadRequestException('You cannot demote yourself');
    }

    const user = await this.databaseService.user.update({
      where: { id: targetUserId },
      data: adminUpdateUserDto,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
      },
    });

    return user;
  }

  async deleteUser(
    requesterId: string,
    targetUserId: string,
    requesterRole: Role,
  ) {
    const isOwner = requesterId === targetUserId;
    const isAdmin = requesterRole === Role.ADMIN;

    if (!isAdmin && !isOwner)
      throw new ForbiddenException(
        "You don't have permission to delete this account",
      );

    const user = await this.databaseService.user.update({
      where: { id: targetUserId },
      data: { isActive: false },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        isVerified: true,
        createdAt: true,
      },
    });

    return user;
  }
}
