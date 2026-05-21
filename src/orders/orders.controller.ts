import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  UseGuards,
  Query,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type RequestUser,
} from '../common/decorators/current-user.decorator';
import type { PaginatedResponse } from '../common/interfaces/paginated-response.interface';
import { Order, Role } from 'generated/prisma/client';
import { OrderQueryDto } from './dto/order-query.dto';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ApiBearerAuth } from '@nestjs/swagger';

@Controller('orders')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  async createOrder(
    @CurrentUser() user: RequestUser,
    @Body() createOrderDto: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(user.id, createOrderDto);
  }

  @Get('me')
  async getMyOrders(
    @Query() query: OrderQueryDto,
    @CurrentUser() user: RequestUser,
  ): Promise<PaginatedResponse<Order>> {
    const { page, limit, sortBy, orderBy } = query;
    return this.ordersService.getOrdersByUser(
      { page, limit, sortBy, orderBy },
      user.id,
    );
  }

  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @Get()
  async getAllOrders(
    @Query() query: OrderQueryDto,
  ): Promise<PaginatedResponse<Order>> {
    const { page, limit, sortBy, orderBy } = query;
    return this.ordersService.getAllOrders({ page, limit, sortBy, orderBy });
  }

  @Get(':orderId')
  async getOrderById(@Param('orderId') orderId: string) {
    return this.ordersService.getOrderById(orderId);
  }

  @Patch(':orderId/cancel')
  async cancelOrder(
    @CurrentUser() user: RequestUser,
    @Param('orderId') orderId: string,
  ) {
    return this.ordersService.cancelOrder(user.id, orderId);
  }

  @Patch(':orderId/confirm')
  async confirmOrder(
    @Param('orderId') orderId: string,
    @Body('paymentIntentId') paymentIntentId: string,
  ) {
    return this.ordersService.confirmOrder(orderId, paymentIntentId);
  }
}
