/* eslint-disable */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from '../auth.service';
import { ConfigService } from '@nestjs/config';
import { User, Role } from 'generated/prisma/client';

interface JwtPayload {
  sub: string; // User ID
  role: Role;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {
    super({
      // Extract access token from Authorization header
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('ACCESS_SECRET')!,
    });
  }

  // Called after JWT is verified
  async validate(payload: JwtPayload): Promise<Partial<User>> {
    const user = await this.authService.getUserById(payload.sub);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid token or user is inactive');
    }

    // Attach role from payload to user object
    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }
}
