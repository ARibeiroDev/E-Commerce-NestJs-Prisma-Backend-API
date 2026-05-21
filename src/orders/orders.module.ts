import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { DatabaseModule } from 'src/database/database.module';
import { AuthModule } from 'src/auth/auth.module';
import { LoggerModule } from 'src/logger/logger.module';

@Module({
  imports: [DatabaseModule, AuthModule, LoggerModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
