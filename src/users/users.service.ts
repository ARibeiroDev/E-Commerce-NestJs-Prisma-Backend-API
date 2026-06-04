import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UpdateUserDto } from './dto/update-user.dto';
import bcrypt from 'bcrypt';
import { AdminUpdateUserDto } from './dto/admin-update.dto';
import { Role } from 'generated/prisma/enums';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogEvent } from '../audit-log/events/audit-log.event';
import { GetUsersQueryDto } from './dto/users-query.dto';
import { Prisma } from 'generated/prisma/client';

@Injectable()
export class UsersService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

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

  async getAllUsers(query: GetUsersQueryDto) {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;
    const { search, isActive, isVerified } = query;

    const where: Prisma.UserWhereInput = {};

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (isVerified !== undefined) {
      where.isVerified = isVerified;
    }

    if (search) {
      where.OR = [
        {
          id: { contains: search, mode: 'insensitive' },
        },
        {
          username: { contains: search, mode: 'insensitive' },
        },
        {
          email: { contains: search, mode: 'insensitive' },
        },
      ];
    }

    const [totalItems, data] = await this.databaseService.$transaction([
      this.databaseService.user.count({ where }),
      this.databaseService.user.findMany({
        where,
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
    requesterRole: Role,
  ) {
    // Fetch target state (For audit logs, this is 'oldValues')
    const targetUser = await this.databaseService.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) throw new NotFoundException('User not found');

    // Check Admin permissions
    if (requesterRole === Role.ADMIN && targetUser.role === Role.SUPERADMIN)
      throw new ForbiddenException('ADMINs cannot demote SUPERADMINs accounts');

    const isRoleChanging =
      adminUpdateUserDto.role && adminUpdateUserDto.role !== targetUser.role;
    // Deactivation behaves similarly to deletion
    const isDeactivating =
      adminUpdateUserDto.isActive === false && targetUser.isActive === true;

    if (isRoleChanging) {
      if (requesterRole !== Role.SUPERADMIN) {
        throw new ForbiddenException(
          'Only SUPERADMIN can promote or demote roles',
        );
      }

      // If SUPERADMIN is demoting themselves or another SUPERADMIN
      if (targetUser.role === Role.SUPERADMIN && targetUser.isActive) {
        const superAdminCount = await this.databaseService.user.count({
          where: { role: Role.SUPERADMIN, isActive: true },
        });
        if (superAdminCount <= 1) {
          throw new ForbiddenException(
            'You cannot demote the last active SUPERADMIN',
          );
        }
      }

      // If SUPERADMIN is demoting an ADMIN to USER
      if (targetUser.role === Role.ADMIN && targetUser.isActive) {
        const adminCount = await this.databaseService.user.count({
          where: { role: Role.ADMIN, isActive: true },
        });
        if (adminCount <= 1) {
          throw new ForbiddenException(
            'You cannot demote the last active ADMIN',
          );
        }
      }
    }

    if (isDeactivating) {
      if (targetUser.role === Role.SUPERADMIN) {
        const superAdminCount = await this.databaseService.user.count({
          where: { role: Role.SUPERADMIN, isActive: true },
        });
        if (superAdminCount <= 1)
          throw new ForbiddenException(
            'You cannot deactivate the last active SUPERADMIN',
          );
      }

      if (targetUser.role === Role.ADMIN) {
        const adminCount = await this.databaseService.user.count({
          where: { role: Role.ADMIN, isActive: true },
        });
        if (adminCount <= 1)
          throw new ForbiddenException(
            'You cannot deactivate the last active ADMIN',
          );
      }
    }

    // Execute update
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

    this.eventEmitter.emit(
      'audit.log',
      new AuditLogEvent({
        action: 'USER_UPDATED_BY_ADMIN',
        actorId: adminId,
        targetId: targetUserId,
        targetType: 'USER',
        oldValues: targetUser as unknown as Record<string, unknown>,
        newValues: user as unknown as Record<string, unknown>,
      }),
    );

    return user;
  }

  async deleteUser(
    requesterId: string,
    targetUserId: string,
    requesterRole: Role,
  ) {
    const targetUser = await this.databaseService.user.findUnique({
      where: { id: targetUserId },
    });

    if (!targetUser) throw new NotFoundException('User not found');

    const isOwner = requesterId === targetUserId;
    const isAdminOrSuperAdmin =
      requesterRole === Role.ADMIN || requesterRole === Role.SUPERADMIN;

    // Base authorization
    if (!isAdminOrSuperAdmin && !isOwner)
      throw new ForbiddenException(
        "You don't have permission to delete this account",
      );

    // Hierarchical authorization
    if (requesterRole === Role.ADMIN && targetUser.role === Role.SUPERADMIN)
      throw new ForbiddenException('ADMINs cannot delete SUPERADMINs accounts');

    // System state protection
    if (targetUser.isActive) {
      if (targetUser.role === Role.SUPERADMIN) {
        const superAdminCount = await this.databaseService.user.count({
          where: { role: Role.SUPERADMIN, isActive: true },
        });
        if (superAdminCount <= 1)
          throw new ForbiddenException('Cannot delete the last SUPERADMIN');
      }

      if (targetUser.role === Role.ADMIN) {
        const adminCount = await this.databaseService.user.count({
          where: { role: Role.ADMIN, isActive: true },
        });
        if (adminCount <= 1)
          throw new ForbiddenException('Cannot delete the last ADMIN');
      }
    }

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

    this.eventEmitter.emit(
      'audit.log',
      new AuditLogEvent({
        action: 'USER_DEACTIVATED',
        actorId: requesterId,
        targetId: targetUserId,
        targetType: 'USER',
        oldValues: targetUser as unknown as Record<string, unknown>,
        newValues: user as unknown as Record<string, unknown>,
      }),
    );

    return user;
  }
}
