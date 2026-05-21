import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Prisma } from 'generated/prisma/client';

// Strong types for cart items with stock info
type CartItemWithStock = Prisma.CartItemGetPayload<{
  include: {
    productVariant: {
      include: {
        product: true;
      };
    };
  };
}> & {
  availableStock: number;
  isAvailable: boolean;
  maxAllowedQuantity: number;
};

@Injectable()
export class CartService {
  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Get or create user's cart
   * - Includes items and product info
   * - Computes available stock for each item
   */
  async getUserCart(userId: string) {
    const cart = await this.databaseService.cart.upsert({
      where: { userId },
      update: {},
      create: { userId },
      include: {
        items: {
          include: { productVariant: { include: { product: true } } },
        },
      },
    });

    // Compute stock availability for each item
    const validatedItems: CartItemWithStock[] = cart.items.map((item) => {
      const available = this.availableStock(
        item.productVariant.stock,
        item.productVariant.reservedStock,
      );

      return {
        ...item,
        availableStock: available,
        isAvailable: available >= item.quantity,
        maxAllowedQuantity: available,
      };
    });

    return {
      ...cart,
      items: validatedItems,
    };
  }

  /**
   * Add item to cart
   * - Handles stock validation
   * - Uses transaction to prevent race conditions
   */
  async addItemToCart(userId: string, sku: string, quantity: number) {
    if (quantity < 1) {
      throw new BadRequestException('Quantity must be at least 1');
    }

    await this.databaseService.$transaction(async (tx) => {
      // Fetch variant
      const variant = await tx.productVariant.findUnique({
        where: { sku },
        select: { id: true, stock: true, reservedStock: true },
      });

      if (!variant) {
        throw new NotFoundException('Product variant not found');
      }

      // Fetch user's cart (within transaction)
      const cart = await tx.cart.upsert({
        where: { userId },
        update: {},
        create: { userId },
      });

      const existingItem = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
      });

      const newQuantity = existingItem
        ? existingItem.quantity + quantity
        : quantity;

      // Validate stock
      this.validateStockFromVariant(variant, newQuantity);

      // Upsert cart item atomically
      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
        update: { quantity: newQuantity },
        create: { cartId: cart.id, variantId: variant.id, quantity },
        include: { productVariant: { include: { product: true } } },
      });
    });

    // Return full cart instead of CartItem
    return this.getUserCart(userId);
  }

  /**
   * Update quantity of an existing cart item
   * - Ensures quantity >= 1 and stock availability
   */
  async updateItemQuantity(userId: string, sku: string, quantity: number) {
    if (quantity < 1) {
      throw new BadRequestException('Quantity must be at least 1');
    }

    const variant = await this.databaseService.productVariant.findUnique({
      where: { sku },
      select: { id: true, stock: true, reservedStock: true },
    });

    if (!variant) {
      throw new NotFoundException('Product variant not found');
    }

    const cart = await this.getUserCart(userId);

    const item = await this.databaseService.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
    });

    if (!item) {
      throw new NotFoundException('Item not found in cart');
    }

    this.validateStockFromVariant(variant, quantity);

    await this.databaseService.cartItem.update({
      where: { id: item.id },
      data: { quantity },
      include: { productVariant: { include: { product: true } } },
    });

    return this.getUserCart(userId);
  }

  //Remove item from cart
  async removeItemFromCart(userId: string, sku: string) {
    const variant = await this.databaseService.productVariant.findUnique({
      where: { sku },
      select: { id: true },
    });

    if (!variant) {
      throw new NotFoundException('Product variant not found');
    }

    const cart = await this.getUserCart(userId);

    const item = await this.databaseService.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
    });

    if (!item) {
      throw new NotFoundException('Item not found in cart');
    }

    await this.databaseService.cartItem.delete({ where: { id: item.id } });

    // Return full cart instead of message
    return this.getUserCart(userId);
  }

  /**
   * Merge guest cart into user's cart
   * - Uses transaction to prevent race conditions
   * - Skips unavailable items, logs them for monitoring
   */
  async mergeGuestCart(
    userId: string,
    guestItems: { sku: string; quantity: number }[],
  ) {
    if (!guestItems?.length) {
      return this.getUserCart(userId);
    }

    await this.databaseService.$transaction(async (tx) => {
      const cart = await tx.cart.upsert({
        where: { userId },
        update: {},
        create: { userId },
      });

      const skus = guestItems.map((i) => i.sku);

      const variants = await tx.productVariant.findMany({
        where: { sku: { in: skus } },
        select: { id: true, sku: true, stock: true, reservedStock: true },
      });

      const variantMap = new Map(variants.map((v) => [v.sku, v]));

      for (const item of guestItems) {
        const variant = variantMap.get(item.sku);
        if (!variant) continue;

        const existingItem = await tx.cartItem.findUnique({
          where: {
            cartId_variantId: { cartId: cart.id, variantId: variant.id },
          },
        });

        const newQty = existingItem
          ? existingItem.quantity + item.quantity
          : item.quantity;

        try {
          this.validateStockFromVariant(variant, newQty);

          await tx.cartItem.upsert({
            where: {
              cartId_variantId: { cartId: cart.id, variantId: variant.id },
            },
            update: { quantity: newQty },
            create: {
              cartId: cart.id,
              variantId: variant.id,
              quantity: item.quantity,
            },
          });
        } catch {
          // Log skipped items for monitoring
          console.warn(`Skipped SKU ${item.sku} — not enough stock`);
          continue;
        }
      }
    });
    return this.getUserCart(userId);
  }

  // Clear entire cart
  async clearCart(userId: string) {
    const cart = await this.getUserCart(userId);

    await this.databaseService.cartItem.deleteMany({
      where: { cartId: cart.id },
    });

    return this.getUserCart(userId);
  }

  // Compute available stock (single source of truth)
  private availableStock(stock: number, reservedStock: number) {
    return Math.max(stock - reservedStock, 0);
  }

  /**
   * Soft stock validation using already fetched variant
   * - Avoids unnecessary DB queries
   */
  private validateStockFromVariant(
    variant: { stock: number; reservedStock: number },
    requestedQty: number,
  ) {
    const available = this.availableStock(variant.stock, variant.reservedStock);

    if (available < requestedQty) {
      throw new BadRequestException(`Only ${available} items left in stock`);
    }
  }
}
