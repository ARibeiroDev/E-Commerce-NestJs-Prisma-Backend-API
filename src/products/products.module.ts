import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { LoggerModule } from 'src/logger/logger.module';

@Module({
  imports: [DatabaseModule, AuthModule, LoggerModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
