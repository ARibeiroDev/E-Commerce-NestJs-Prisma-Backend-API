import { SetMetadata } from '@nestjs/common';
import { Role } from 'generated/prisma/enums';

export const ROLES_KEY = 'roles';

// Attaches metadata to the handler or controller
// RolesGuard can read the metadata and check if the user has the required role
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
