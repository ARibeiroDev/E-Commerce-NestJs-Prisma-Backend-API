import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Prisma, OrderStatus, Order } from 'generated/prisma/client';
import { CreateOrderDto } from './dto/create-order.dto';
import { PaginationQueryDto } from '../common/dtos/pagination-query.dto';
import { PaginatedResponse } from '../common/interfaces/paginated-response.interface';
import { Cron } from '@nestjs/schedule';
import { LoggerService } from '../logger/logger.service';

//Extract reservation TTL to constant
const RESERVATION_TTL_MS = 15 * 60 * 1000;

// Strong typing for cart with relations
type CartWithItems = Prisma.CartGetPayload<{
  include: {
    items: {
      include: {
        productVariant: {
          include: {
            product: true;
          };
        };
      };
    };
  };
}>;

type CartItemWithRelations = CartWithItems['items'][number];

@Injectable()
export class OrdersService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly logger: LoggerService,
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

      for (const item of cart.items) {
        total = total.plus(item.productVariant.finalPrice.mul(item.quantity));
      }

      // Reserve stock safely
      await this.reserveStockWithRetry(tx, cart.items);

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

  /**
   * Retry with fresh DB state each attempt
   * - Prevents stale reservedStock usage
   * - Makes retry actually meaningful
   */
  private async reserveStockWithRetry(
    tx: Prisma.TransactionClient,
    items: CartItemWithRelations[],
    retries = 2,
  ) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        for (const item of items) {
          // Fetch fresh state every attempt
          const freshVariant = await tx.productVariant.findUnique({
            where: { id: item.variantId },
            select: {
              reservedStock: true,
              sku: true,
            },
          });

          if (!freshVariant) {
            throw new Error('Variant not found');
          }

          const result = await tx.productVariant.updateMany({
            where: {
              id: item.variantId,
              stock: {
                gte: freshVariant.reservedStock + item.quantity,
              },
            },
            data: {
              reservedStock: {
                increment: item.quantity,
              },
            },
          });

          if (result.count === 0) {
            throw new Error(`Stock conflict for SKU ${freshVariant.sku}`);
          }
        }

        return; // Success
      } catch (error: unknown) {
        // Logging for observability
        console.warn('Stock reservation retry', {
          attempt,
          error,
        });

        if (attempt === retries) {
          throw new BadRequestException(
            'Some items are no longer available, please refresh your cart',
          );
        }
      }
    }
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

  // TODO: Add filters, search by status, date, total amount
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

  async getOrderById(orderId: string) {
    const order = await this.databaseService.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) throw new NotFoundException('Order not found');

    return order;
  }

  // TODO: Add filters, search by status, date, total amount
  async getAllOrders(
    query: PaginationQueryDto & {
      sortBy?: 'createdAt' | 'status';
      orderBy?: 'asc' | 'desc';
    },
  ): Promise<PaginatedResponse<Order>> {
    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const sortBy = query.sortBy || 'createdAt';
    const orderBy = query.orderBy || 'desc';

    const [totalItems, data] = await this.databaseService.$transaction([
      this.databaseService.order.count(),
      this.databaseService.order.findMany({
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
}
