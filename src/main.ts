import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import cookieParser from 'cookie-parser';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { LoggerService } from './logger/logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    logger: ['log', 'error', 'warn'],
  });

  const configService = app.get(ConfigService);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('ClothingCo NestJS API')
    .setDescription('ClothingCo API description')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();

  const documentFactory = () =>
    SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('api', app, documentFactory);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // remove all fields that are not in the DTO
      forbidNonWhitelisted: true, // throw error if field is not in the DTO
      transform: true, // enables class-transformer decorators
    }),
  );

  app.enableCors({
    origin: configService.get<string>('CLIENT_URL'),
    credentials: true,
  });
  app.use(cookieParser());
  app.useGlobalFilters(app.get(AllExceptionsFilter));
  app.useLogger(app.get(LoggerService));

  await app.listen(configService.get<number>('PORT') ?? 3500);
}
// eslint-disable-next-line @typescript-eslint/no-floating-promises
bootstrap();
