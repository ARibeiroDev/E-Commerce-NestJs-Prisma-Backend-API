import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request, Response } from 'express';
import { Prisma } from 'generated/prisma/client';
import { LoggerService } from '../../logger/logger.service';

@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  constructor(private readonly logger: LoggerService) {
    super();
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR; // 500
    let message: string | object = 'Internal Server Error';

    // NestJS HTTP exceptions
    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      message = exception.getResponse();

      if (statusCode >= 500) {
        this.logger.error(
          `[${request.method}] ${request.url} - ${statusCode}`,
          exception.stack,
          'Exception',
        );
      } else {
        this.logger.warn(
          `[${request.method}] ${request.url} - ${statusCode}`,
          'Exception',
        );
      }
    }

    // Prisma DB errors
    else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      this.logger.error(
        `[DB ERROR] ${exception.code}`,
        exception.stack,
        'Prisma',
      );

      switch (exception.code) {
        case 'P2002': // Unique constraint
          statusCode = HttpStatus.CONFLICT;
          message = 'Resource already exists';
          break;

        case 'P2025': // Record not found
          statusCode = HttpStatus.NOT_FOUND;
          message = 'Resource not found';
          break;

        default: // Unkown error
          statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
          message = 'Database Error';
      }
    }

    // Prisma validation errors
    else if (exception instanceof Prisma.PrismaClientValidationError) {
      this.logger.error('[DB VALIDATION ERROR]', exception.stack, 'Prisma');

      statusCode = HttpStatus.UNPROCESSABLE_ENTITY; // 422
      message = 'Invalid data provided';
    } else {
      // Only for unexpected errors
      this.logger.error(
        `[${request.method}] ${request.url} - ${statusCode}`,
        exception instanceof Error
          ? exception.stack
          : JSON.stringify(exception),
        'Exception',
      );
    }

    response.status(statusCode).json({
      statusCode,
      timestamp: new Date().toISOString(),
      path: request.url,
      message,
    });
  }
}
