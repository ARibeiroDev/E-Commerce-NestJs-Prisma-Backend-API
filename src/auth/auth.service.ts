import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { CreateUserDto } from './dto/create-user.dto';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { ResendVerificationDto } from './dto/email-resend-verification.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { User } from 'generated/prisma/client';
import { Request, Response } from 'express';
import { LoginDto } from './dto/login.dto';
import { JwtService } from '@nestjs/jwt';

interface RefreshRequest extends Request {
  cookies: { refreshToken?: string };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  async register(createUserDto: CreateUserDto) {
    const { username, email } = createUserDto;

    const hashedPwd = await bcrypt.hash(createUserDto.password, 10);

    // Generate token for user email verification
    const rawToken = crypto.randomBytes(32).toString('hex');
    const verificationToken = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    const user = await this.databaseService.user.create({
      data: {
        username,
        email,
        password: hashedPwd,
        isVerified: false,
        emailVerificationToken: verificationToken,
        emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    try {
      await this.emailService.sendVerificationEmail(email, rawToken);
    } catch (error) {
      console.error(error);
    }

    return { username: user.username, email: user.email, role: user.role };
  }

  async verifyEmail(token: string) {
    if (!token) throw new BadRequestException('Token is required');

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await this.databaseService.user.findFirst({
      where: {
        emailVerificationToken: hashedToken,
        emailVerificationExpires: {
          gt: new Date(),
        },
      },
    });

    if (!user) throw new BadRequestException('Invalid or expired token');

    await this.databaseService.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
      },
    });

    return { message: 'Email verified successfully, you can log in now' };
  }

  async resendVerification(resendVerificationDto: ResendVerificationDto) {
    const { email } = resendVerificationDto;

    const user = await this.databaseService.user.findUnique({
      where: { email },
    });

    if (!user) {
      return {
        message: ' If an account exists, a new verification email was sent.',
      };
    }

    if (user.isVerified) {
      throw new BadRequestException('User is already verified');
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const newVerificationToken = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    await this.databaseService.user.update({
      where: { id: user.id },
      data: {
        emailVerificationToken: newVerificationToken,
        emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await this.emailService.sendVerificationEmail(email, rawToken);

    return {
      message: 'If an account exists, a new verification email was sent.',
    };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const { email } = forgotPasswordDto;

    const user = await this.databaseService.user.findUnique({
      where: { email },
    });

    if (!user || !user.isVerified) {
      return {
        message: 'If an account exists, a new reset email was sent.',
      };
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const resetToken = crypto
      .createHash('sha256')
      .update(rawToken)
      .digest('hex');

    await this.databaseService.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: resetToken,
        passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    await this.emailService.sendPasswordResetEmail(email, rawToken);

    return {
      message: 'If an account exists, a new reset email was sent.',
    };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const { token, password: newPassword } = resetPasswordDto;
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await this.databaseService.user.findFirst({
      where: {
        passwordResetToken: hashedToken,
        passwordResetExpires: {
          gt: new Date(),
        },
      },
    });

    if (!user || !user.passwordResetExpires) {
      throw new BadRequestException('Invalid or expired token');
    }

    const newHashedPwd = await bcrypt.hash(newPassword, 10);

    // Transaction prevents race conditions and inconsistent state if one query fails
    await this.databaseService.$transaction([
      this.databaseService.user.update({
        where: { id: user.id },
        data: {
          password: newHashedPwd,
          passwordResetToken: null,
          passwordResetExpires: null,
        },
      }),

      // Password update, revoke all logged in sessions
      this.databaseService.refreshToken.updateMany({
        where: { userId: user.id, revoked: false },
        data: { revoked: true },
      }),
    ]);

    return {
      message:
        'Password reset successfully, all sessions have been revoked. You can log in now.',
    };
  }

  // TODO: Review later if some fields need to be filtered/selected in here to avoid leaking sensitive information
  async getUserById(userId: string): Promise<Partial<User> | null> {
    return this.databaseService.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        isActive: true,
        isVerified: true,
      },
    });
  }

  async login(loginDto: LoginDto, res: Response) {
    const { identifier, password } = loginDto;

    const user = await this.databaseService.user.findFirst({
      where: {
        OR: [{ username: identifier }, { email: identifier }],
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPwdMatch = await bcrypt.compare(password, user.password);

    if (!isPwdMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isVerified) {
      throw new UnauthorizedException(
        'Email not verified. Please verify your email before login.',
      );
    }

    if (!user.isActive) {
      throw new UnauthorizedException(
        'Account is inactive. Please contact support.',
      );
    }

    // Generate Tokens
    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user);

    // Store refresh token
    await this.storeRefreshToken(user.id, refreshToken);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    };
  }

  async refreshTokens(req: RefreshRequest, res: Response) {
    const token = req.cookies?.refreshToken;

    if (!token) throw new UnauthorizedException('No refresh token found');

    const payload = this.jwtService.verify<{ sub: string; jti: string }>(
      token,
      {
        secret: this.configService.get<string>('REFRESH_SECRET'),
      },
    );

    const userId = payload.sub;
    const tokenId = payload.jti;

    // O(1) lookup instead of loop
    const storedToken = await this.databaseService.refreshToken.findUnique({
      where: { id: tokenId },
    });

    // Token does not exist or already revoked
    if (!storedToken || storedToken.revoked) {
      await this.databaseService.refreshToken.updateMany({
        where: { userId },
        data: { revoked: true },
      });

      throw new UnauthorizedException('Refresh token reuse detected');
    }

    // Revoke current token (rotation)
    await this.databaseService.refreshToken.update({
      where: { id: tokenId },
      data: { revoked: true },
    });

    const user = await this.databaseService.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new UnauthorizedException('User not found');

    const newAccessToken = this.generateAccessToken(user);
    const newRefreshToken = this.generateRefreshToken(user);

    await this.storeRefreshToken(user.id, newRefreshToken);

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return {
      accessToken: newAccessToken,
      user: { id: user.id, username: user.username, role: user.role },
    };
  }

  async logout(req: RefreshRequest, res: Response) {
    const token = req.cookies?.refreshToken;

    // No refresh token
    if (!token) {
      res.clearCookie('refreshToken', { path: '/' });
      return { message: 'Logout successful' };
    }

    let userId: string | null = null;
    let tokenId: string | null = null;

    try {
      const payload = this.jwtService.verify<{ sub: string; jti: string }>(
        token,
        {
          secret: this.configService.get<string>('REFRESH_SECRET'),
        },
      );

      userId = payload.sub;
      tokenId = payload.jti;
    } catch {
      // Invalid token, still treat as logged out
      res.clearCookie('refreshToken', { path: '/' });
      return { message: 'Logout successful' };
    }

    // Revoke only current session (no loop needed)
    if (tokenId) {
      await this.databaseService.refreshToken.updateMany({
        where: { id: tokenId, userId },
        data: { revoked: true },
      });
    }

    res.clearCookie('refreshToken', { path: '/' });

    return { message: 'Logout successful' };
  }

  private generateAccessToken(user: User) {
    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
    };

    const accessSecret = this.configService.get<string>('ACCESS_SECRET');

    if (!accessSecret) {
      throw new Error('ACCESS_SECRET is not defined');
    }

    return this.jwtService.sign(payload, {
      secret: accessSecret,
      expiresIn: '15m',
    });
  }

  private generateRefreshToken(user: User) {
    const payload = {
      sub: user.id,
    };

    const refreshSecret = this.configService.get<string>('REFRESH_SECRET');

    if (!refreshSecret) {
      throw new Error('REFRESH_SECRET is not defined');
    }

    return this.jwtService.sign(payload, {
      secret: refreshSecret,
      expiresIn: '7d',
    });
  }

  private async storeRefreshToken(userId: string, refreshToken: string) {
    const hashedToken = await bcrypt.hash(refreshToken, 10);

    await this.databaseService.refreshToken.create({
      data: {
        token: hashedToken,
        userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  }
}
