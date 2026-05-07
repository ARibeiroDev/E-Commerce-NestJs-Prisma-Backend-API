import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from 'generated/prisma/enums';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RequestUser } from '../decorators/current-user.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) return true; // Public route

    const request = context.switchToHttp().getRequest<{ user: RequestUser }>();

    const user = request.user; // User object from JWT strategy

    if (!user) throw new UnauthorizedException('User is not authenticated');

    const isAuthorized = requiredRoles.some((role) => user.role === role);

    if (!isAuthorized) throw new ForbiddenException('Access denied');

    return isAuthorized;
  }
}
