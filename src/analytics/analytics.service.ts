import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OrderStatus, Prisma } from 'generated/prisma/client';
import slugify from '@sindresorhus/slugify';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: DatabaseService) {}

  async getDashboardStats() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const successfulStatuses = [
      OrderStatus.PAID,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
    ];

    // Total Revenue (Only fulfilled/paid orders)
    const revenueResult = await this.prisma.order.aggregate({
      _sum: { total: true },
      where: {
        status: {
          in: successfulStatuses,
        },
      },
    });
    const totalRevenue = revenueResult._sum.total || new Prisma.Decimal(0);

    // Client Satisfaction (100% - Refund Rate)
    const totalCompletedOrders = await this.prisma.order.count({
      where: {
        status: {
          in: [...successfulStatuses, OrderStatus.REFUNDED],
        },
      },
    });
    const refundedOrders = await this.prisma.order.count({
      where: { status: OrderStatus.REFUNDED },
    });

    let satisfactionRate = 100;
    if (totalCompletedOrders > 0) {
      satisfactionRate = 100 - (refundedOrders / totalCompletedOrders) * 100;
    }

    // User Metrics
    const newUsersThisMonth = await this.prisma.user.count({
      where: { createdAt: { gte: startOfMonth } },
    });
    const totalUsers = await this.prisma.user.count();

    // Top Selling Products (Grouped by SKU - Excludes Refunds and Cancellations)
    const topProducts = await this.prisma.orderItem.groupBy({
      by: ['productName', 'variantSku'],
      _sum: { quantity: true },
      where: {
        order: {
          status: {
            in: successfulStatuses,
          },
        },
      },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    });

    return {
      revenue: totalRevenue,
      satisfactionRate: Math.round(satisfactionRate * 10) / 10, // Round to 1 decimal
      newUsersThisMonth,
      totalUsers,
      topProducts: topProducts.map((p) => ({
        name: p.productName,
        sku: p.variantSku,
        sold: p._sum.quantity || 0,
        slug: slugify(p.productName),
      })),
    };
  }
}
