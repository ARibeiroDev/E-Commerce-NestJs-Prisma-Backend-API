import { Role } from 'generated/prisma/enums';

export interface UserResponse {
  id: string;
  username: string;
  email: string;
  role: Role;
  isActive: boolean;
  isVerified: boolean;
  createdAt: Date;
}
