import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  Prisma,
  OrderStatus,
  Order,
  Role,
  ProductVariant,
} from 'generated/prisma/client';
import { CreateOrderDto } from './dto/create-order.dto';
import { PaginationQueryDto } from '../common/dtos/pagination-query.dto';
import { PaginatedResponse } from '../common/interfaces/paginated-response.interface';
import { Cron } from '@nestjs/schedule';
import { LoggerService } from '../logger/logger.service';
import { RequestUser } from 'src/common/decorators/current-user.decorator';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogEvent } from '../audit-log/events/audit-log.event';

//Extract reservation TTL to constant
const RESERVATION_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class OrdersService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly logger: LoggerService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Create order from cart
   * reservedStock = sum of all active (PENDING, non-expired) orders
   */
  async createOrder(userId: string, dto: CreateOrderDto) {
    return this.databaseService.$transaction(async (tx) => {
      // Fetch cart
      const cart = await tx.cart.findUnique({
        where: { userId },
        include: {
          items: {
            include: {
              productVariant: {
                include: { product: true },
              },
            },
          },
        },
      });

      if (!cart || cart.items.length === 0) {
        throw new BadRequestException('Cart is empty');
      }

      // Calculate total
      let total = new Prisma.Decimal(0);

      // Lock rows, calculate available stock and reserve stock
      for (const item of cart.items) {
        total = total.plus(item.productVariant.finalPrice.mul(item.quantity));

        const variants: ProductVariant[] = await tx.$queryRaw`
          SELECT id, stock, "reservedStock", sku 
          FROM "ProductVariant" 
          WHERE id = ${item.variantId} 
          FOR UPDATE;
          `;

        if (!variants || variants.length === 0) {
          throw new NotFoundException(
            `Product variant ${item.variantId} not found.`,
          );
        }

        const lockedVariant = variants[0];

        const availableStock =
          lockedVariant.stock - lockedVariant.reservedStock;

        if (availableStock < item.quantity) {
          // Pass structured error instead of simple string for frontend handling
          throw new BadRequestException({
            code: 'INSUFFICIENT_STOCK',
            message: `Insufficient stock for SKU ${lockedVariant.sku}. Only ${availableStock} units available.`,
            sku: lockedVariant.sku,
            variantId: item.variantId,
            availableStock,
          });
        }

        await tx.productVariant.update({
          where: { id: item.variantId },
          data: {
            reservedStock: {
              increment: item.quantity,
            },
          },
        });
      }

      // Apply shipping fees
      const SHIPPING_THRESHOLD = new Prisma.Decimal(100);
      const SHIPPING_FEE = new Prisma.Decimal(15);

      if (total.lessThan(SHIPPING_THRESHOLD)) {
        total = total.plus(SHIPPING_FEE);
      }

      // Create order
      const order = await tx.order.create({
        data: {
          userId,
          status: OrderStatus.PENDING,
          total,
          expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),

          // Shipping snapshot
          shippingName: dto.shippingName,
          shippingPhone: dto.shippingPhone,
          shippingAddress: dto.shippingAddress,
          shippingCity: dto.shippingCity,
          shippingPostalCode: dto.shippingPostalCode,
          shippingCountry: dto.shippingCountry,

          items: {
            create: cart.items.map((item) => ({
              variantId: item.variantId,
              productName: item.productVariant.product.title,
              variantSku: item.productVariant.sku,
              size: item.productVariant.size,
              color: item.productVariant.color,
              quantity: item.quantity,
              priceAtPurchase: item.productVariant.finalPrice,
            })),
          },
        },
        include: { items: true },
      });

      // Clear cart
      await tx.cartItem.deleteMany({
        where: { cartId: cart.id },
      });

      return order;
    });
  }

  // Confirm order
  async confirmOrder(orderId: string, paymentIntentId: string) {
    return this.databaseService.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      // Idempotency guard
      if (order.paymentIntentId) {
        return order;
      }

      if (order.status !== OrderStatus.PENDING) {
        throw new BadRequestException('Invalid order state');
      }

      // Deduct stock + release reservation
      for (const item of order.items) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: {
            stock: {
              decrement: item.quantity,
            },
            reservedStock: {
              decrement: item.quantity,
            },
          },
        });
      }

      return tx.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.PAID,
          paymentIntentId,
        },
      });
    });
  }

  // Cancel order manually and restores items back to user's cart
  async cancelOrder(userId: string, orderId: string) {
    return this.databaseService.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order) {
        throw new NotFoundException('Order not found');
      }

      if (order.userId !== userId) {
        throw new ForbiddenException(
          'You do not have permission to cancel this order',
        );
      }

      if (order.status !== OrderStatus.PENDING) {
        throw new BadRequestException(
          'Only pending orders within the reservation window can be cancelled',
        );
      }

      // Deduct reserved stock
      for (const item of order.items) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: {
            reservedStock: {
              decrement: item.quantity,
            },
          },
        });
      }

      // Move status to CANCELLED
      await tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
      });

      // Locate or instantiate the user's cart
      let cart = await tx.cart.findUnique({ where: { userId } });
      if (!cart) {
        cart = await tx.cart.create({ data: { userId } });
      }

      // Reconstruct cart items using the snapshot data from the order
      for (const item of order.items) {
        const existingCartItem = await tx.cartItem.findFirst({
          where: {
            cartId: cart.id,
            variantId: item.variantId,
          },
        });

        if (existingCartItem) {
          await tx.cartItem.update({
            where: { id: existingCartItem.id },
            data: { quantity: existingCartItem.quantity + item.quantity },
          });
        } else {
          await tx.cartItem.create({
            data: {
              cartId: cart.id,
              variantId: item.variantId,
              quantity: item.quantity,
            },
          });
        }
      }

      return {
        success: true,
        message: 'Order successfully cancelled and cart items restored.',
      };
    });
  }

  /**
   * User initiated request for return/refund
   */
  async requestRefund(userId: string, orderId: string) {
    const order = await this.databaseService.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.userId !== userId) {
      throw new ForbiddenException(
        'You do not have permission to modify this order.',
      );
    }

    // Explicitly casting checking list to resolve strict TS typing configurations
    const refundableStatuses: OrderStatus[] = [
      OrderStatus.PAID,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
    ];

    if (!refundableStatuses.includes(order.status)) {
      throw new BadRequestException(
        'Refunds can only be requested for paid, shipped, or delivered orders.',
      );
    }

    return this.databaseService.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.REFUND_REQUESTED },
    });
  }

  /**
   * Secure Admin & Superadmin controlled status management switch
   * Handles lifecycle logic, inventory restoration and immutable logging
   */
  async updateOrderStatus(
    orderId: string,
    targetStatus: OrderStatus,
    adminId: string,
  ) {
    return this.databaseService.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });

      if (!order) throw new NotFoundException('Order not found');
      const oldStatus = order.status;
      if (oldStatus === targetStatus) return order;

      // Terminal State Check
      if (
        oldStatus === OrderStatus.CANCELLED ||
        oldStatus === OrderStatus.REFUNDED
      ) {
        throw new BadRequestException(
          `Cannot change status from a terminal ${oldStatus} state.`,
        );
      }

      // Restock processing upon Admin Return Approval
      if (targetStatus === OrderStatus.REFUNDED) {
        const validRefundStatuses: OrderStatus[] = [
          OrderStatus.PAID,
          OrderStatus.SHIPPED,
          OrderStatus.DELIVERED,
          OrderStatus.REFUND_REQUESTED,
        ];

        if (!validRefundStatuses.includes(oldStatus)) {
          throw new BadRequestException(
            'Only fulfilled, processing, or refund requested orders can be marked as refunded.',
          );
        }
        for (const item of order.items) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });
        }
      }

      // Rollback logic for administrative manual cancellation
      if (targetStatus === OrderStatus.CANCELLED) {
        if (oldStatus !== OrderStatus.PENDING) {
          throw new BadRequestException(
            'Only pending orders can be cancelled.',
          );
        }
        for (const item of order.items) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { reservedStock: { decrement: item.quantity } },
          });
        }
      }

      const updatedOrder = await tx.order.update({
        where: { id: orderId },
        data: { status: targetStatus },
        include: { items: true },
      });

      this.eventEmitter.emit(
        'audit.log',
        new AuditLogEvent({
          action: 'ORDER_STATUS_UPDATED',
          actorId: adminId,
          targetId: orderId,
          targetType: 'ORDER',
          oldValues: { status: oldStatus },
          newValues: { status: targetStatus },
        }),
      );

      return updatedOrder;
    });
  }

  // Automated background cleaner for expired orders
  @Cron('*/5 * * * *') // Every 5 minutes
  async handleExpiredOrders() {
    const now = new Date();

    const expiredOrders = await this.databaseService.order.findMany({
      where: {
        status: OrderStatus.PENDING,
        expiresAt: { lt: now },
      },
      include: { items: true },
    });

    if (expiredOrders.length === 0) return;

    for (const order of expiredOrders) {
      try {
        // Process each cancellation in isolated transactions so one bad order doesn't halt the whole loop
        await this.databaseService.$transaction(async (tx) => {
          // Deduct reserved stock
          for (const item of order.items) {
            await tx.productVariant.update({
              where: { id: item.variantId },
              data: {
                reservedStock: {
                  decrement: item.quantity,
                },
              },
            });
          }

          await tx.order.update({
            where: { id: order.id },
            data: { status: OrderStatus.CANCELLED },
          });

          let cart = await tx.cart.findUnique({
            where: { userId: order.userId },
          });
          if (!cart) {
            cart = await tx.cart.create({ data: { userId: order.userId } });
          }

          for (const item of order.items) {
            const existingCartItem = await tx.cartItem.findFirst({
              where: { cartId: cart.id, variantId: item.variantId },
            });

            if (existingCartItem) {
              await tx.cartItem.update({
                where: { id: existingCartItem.id },
                data: { quantity: existingCartItem.quantity + item.quantity },
              });
            } else {
              await tx.cartItem.create({
                data: {
                  cartId: cart.id,
                  variantId: item.variantId,
                  quantity: item.quantity,
                },
              });
            }
          }
        });
        this.logger.log(
          `[Cron] Auto-cancelled expired order: ${order.id}. Items returned to cart.`,
        );
      } catch (error: unknown) {
        this.logger.log(
          `[Cron] Error processing rollback for order ${order.id}:`,
          (error as Error).message,
        );
      }
    }
  }

  async getOrdersByUser(
    query: PaginationQueryDto & {
      sortBy?: 'createdAt' | 'status';
      orderBy?: 'asc' | 'desc';
    },
    userId: string,
  ): Promise<PaginatedResponse<Order>> {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const sortBy = query.sortBy || 'createdAt';
    const orderBy = query.orderBy || 'desc';

    const [totalItems, data] = await this.databaseService.$transaction([
      this.databaseService.order.count({ where: { userId } }),
      this.databaseService.order.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { [sortBy]: orderBy },
        include: { items: true },
      }),
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    return {
      data,
      meta: {
        totalItems,
        itemsPerPage: limit,
        totalPages,
        currentPage: page,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages,
      },
    };
  }

  async getOrderById(orderId: string, user: RequestUser) {
    const order = await this.databaseService.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        user: { select: { username: true, email: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    const isAdmin = user.role === Role.ADMIN || user.role === Role.SUPERADMIN;
    if (order.userId !== user.id && !isAdmin)
      throw new ForbiddenException(
        'You do not have permission to view this order',
      );

    return order;
  }

  async getAllOrders(
    query: PaginationQueryDto & {
      sortBy?: 'createdAt' | 'status';
      orderBy?: 'asc' | 'desc';
      status?: OrderStatus;
      search?: string;
    },
  ): Promise<PaginatedResponse<Order>> {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const sortBy = query.sortBy || 'createdAt';
    const orderBy = query.orderBy || 'desc';

    const where: Prisma.OrderWhereInput = {};

    if (query.status) where.status = query.status;

    if (query.search) {
      where.OR = [
        { id: { contains: query.search, mode: 'insensitive' } },
        { shippingName: { contains: query.search, mode: 'insensitive' } },
        { shippingPhone: { contains: query.search, mode: 'insensitive' } },
        {
          user: {
            OR: [
              { username: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
            ],
          },
        },
      ];
    }

    const [totalItems, data] = await this.databaseService.$transaction([
      this.databaseService.order.count({ where }),
      this.databaseService.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: orderBy },
        include: {
          items: true,
          user: { select: { id: true, username: true, email: true } },
        },
      }),
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    return {
      data,
      meta: {
        totalItems,
        itemsPerPage: limit,
        totalPages,
        currentPage: page,
        hasPreviousPage: page > 1,
        hasNextPage: page < totalPages,
      },
    };
  }
}
