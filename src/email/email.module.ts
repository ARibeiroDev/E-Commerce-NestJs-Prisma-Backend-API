import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { LoggerModule } from '../logger/logger.module';

@Module({
  imports: [LoggerModule],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
