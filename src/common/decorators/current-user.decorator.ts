import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from 'generated/prisma/enums';

export interface RequestUser {
  id: string;
  email: string;
  role: Role;
}

// Decorator to get the user from the request
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): RequestUser | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: RequestUser }>();

    return request.user;
  },
);
