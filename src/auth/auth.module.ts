import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenCleanupService } from './token-cleanup.service';
import { LoggerModule } from '../logger/logger.module';

@Module({
  imports: [
    DatabaseModule,
    PassportModule,
    JwtModule.register({}),
    EmailModule,
    LoggerModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, TokenCleanupService],
  exports: [AuthService],
})
export class AuthModule {}
