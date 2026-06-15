import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { DatabaseService } from '../database/database.service';
import { PaginatedResponse } from '../common/interfaces/paginated-response.interface';
import { Prisma, Product, ProductVariant } from 'generated/prisma/client';
import slugify from '@sindresorhus/slugify';
import crypto from 'crypto';
import { ProductVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { ProductQueryDto } from './dto/product-query.dto';
import { LoggerService } from '../logger/logger.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogEvent } from '../audit-log/events/audit-log.event';
import { PrismaClientKnownRequestError } from 'generated/prisma/internal/prismaNamespace';

@Injectable()
export class ProductsService {
  private readonly LIST_CACHE_VERSION_KEY = 'LIST_CACHE_VERSION';

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly logger: LoggerService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findAll(
    query: ProductQueryDto,
    filters?: {
      categoryId?: string;
      tags?: string[];
      featured?: boolean;
      title?: string;
      isArchived?: boolean;
    },
  ): Promise<PaginatedResponse<Product>> {
    const cacheKey = await this.generateProductsListCacheKey(query, filters);

    const getCachedData =
      await this.cacheManager.get<PaginatedResponse<Product>>(cacheKey);

    if (getCachedData) {
      this.logger.log(`Cache HIT: ${cacheKey}`, 'CACHE');
      return getCachedData;
    }

    this.logger.log(`Cache MISS: ${cacheKey}`, 'CACHE');

    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {};

    if (filters?.categoryId) where.categoryId = filters.categoryId;
    if (filters?.featured !== undefined) where.featured = filters.featured;
    if (filters?.title)
      where.title = { contains: filters.title, mode: 'insensitive' };
    if (filters?.tags?.length) where.tags = { hasSome: filters.tags };

    where.isArchived = filters?.isArchived ?? false;

    const sortBy = query.sortBy || 'createdAt';
    const orderBy = query.orderBy || 'desc';

    const [totalItems, data] = await this.databaseService.$transaction([
      this.databaseService.product.count({ where }),
      this.databaseService.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: orderBy },
        include: { variants: true, category: true },
      }),
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    const responseResult = {
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

    await this.cacheManager.set(cacheKey, responseResult, 30000);

    return responseResult;
  }

  async findOneBySlug(slug: string): Promise<Product> {
    const cacheKey = `product_${slug}`;
    const cachedProduct = await this.cacheManager.get<Product>(cacheKey);

    if (cachedProduct) {
      this.logger.log(`Cache HIT ${cacheKey}`, 'CACHE');
      return cachedProduct;
    }
    this.logger.log(`Cache MISS ${cacheKey}`, 'CACHE');

    const product = await this.databaseService.product.findUnique({
      where: { slug },
      include: { variants: true },
    });

    if (!product) throw new NotFoundException('Product not found');

    // Caching specific items for longer periods is now safe due to explicit invalidation
    await this.cacheManager.set(cacheKey, product, 30000);

    return product;
  }

  // ADMIN ROUTES
  async create(createProductDto: CreateProductDto, actorId: string) {
    const slug = this.generateSlug(createProductDto.title);

    const category = await this.databaseService.category.findUnique({
      where: { id: createProductDto.categoryId },
      select: { name: true },
    });

    if (!category) throw new NotFoundException('Category not found');

    const variants = createProductDto.variants.map((variant) => {
      const color = variant.color.trim();
      const size = variant.size.trim();
      const discountPercentage = variant.discountPercentage ?? 0;
      const finalPrice = this.calculateFinalPrice(
        createProductDto.basePrice,
        discountPercentage,
      );

      return {
        ...variant,
        color,
        size,
        sku: this.generateSku(category.name, color, size),
        discountPercentage: variant.discountPercentage ?? 0,
        finalPrice,
      };
    });

    const colorSizeSet = new Set();
    variants?.forEach((variant) => {
      const key = `${variant.color.toLowerCase()}-${variant.size.toLowerCase()}`;

      if (colorSizeSet.has(key)) {
        throw new ForbiddenException(
          `Duplicate color and size combination: ${key}`,
        );
      }

      colorSizeSet.add(key);
    });

    const sanitizedTags = (createProductDto.tags ?? [])
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    const sanitizedImages = (createProductDto.images ?? [])
      .map((url) => url.trim())
      .filter(Boolean);

    const product = await this.databaseService.product.create({
      data: {
        ...createProductDto,
        tags: sanitizedTags,
        images: sanitizedImages,
        slug,
        variants: {
          create: variants,
        },
      },
      include: {
        variants: true,
      },
    });

    const { variants: createdVariants, ...cleanProductData } = product;

    this.eventEmitter.emit(
      'audit.log',
      new AuditLogEvent({
        action: 'PRODUCT_CREATED',
        actorId,
        targetId: product.id,
        targetType: 'PRODUCT',
        newValues: cleanProductData,
      }),
    );

    if (createdVariants && createdVariants.length > 0) {
      createdVariants.forEach((variant) => {
        this.eventEmitter.emit(
          'audit.log',
          new AuditLogEvent({
            action: 'VARIANT_CREATED',
            actorId,
            targetId: variant.id,
            targetType: 'PRODUCT_VARIANT',
            newValues: variant,
          }),
        );
      });
    }

    await this.invalidateListCache();

    return product;
  }

  async update(
    slug: string,
    updateProductDto: UpdateProductDto,
    actorId: string,
  ): Promise<Product> {
    const product = await this.databaseService.product.findUnique({
      where: { slug },
    });

    if (!product) throw new NotFoundException('Product not found');

    let newSlug = product.slug;

    if (updateProductDto.title && updateProductDto.title !== product.title) {
      newSlug = this.generateSlug(updateProductDto.title);
    }

    //eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { variants, ...productData } = updateProductDto;

    const updatedProduct = await this.databaseService.product.update({
      where: { slug },
      data: {
        ...productData,
        slug: newSlug,
      },
      include: { variants: true },
    });

    await this.cacheManager.del(`product_${slug}`);
    if (newSlug !== slug) {
      await this.cacheManager.del(`product_${newSlug}`);
    }
    await this.invalidateListCache();

    //eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { variants: updatedVariants, ...cleanUpdatedProductData } =
      updatedProduct;

    if (this.hasChanged(product, cleanUpdatedProductData)) {
      this.eventEmitter.emit(
        'audit.log',
        new AuditLogEvent({
          action: 'PRODUCT_UPDATED',
          actorId,
          targetId: updatedProduct.id,
          targetType: 'PRODUCT',
          oldValues: product,
          newValues: cleanUpdatedProductData,
        }),
      );
    }

    return updatedProduct;
  }

  async remove(slug: string, actorId: string): Promise<Product> {
    const product = await this.databaseService.product.findUnique({
      where: { slug },
      include: { variants: true },
    });
    if (!product || product.isArchived)
      throw new NotFoundException('Product not found or already archived');

    const deletedProduct = await this.databaseService.product.update({
      where: { slug },
      data: { isArchived: true },
    });

    await this.cacheManager.del(`product_${slug}`);

    // Invalidate all child variants so they immediately show as archived/unavailable
    if (product.variants && product.variants.length > 0) {
      for (const variant of product.variants) {
        await this.cacheManager.del(`variant_${variant.sku}`);
      }
    }

    await this.invalidateListCache();

    const { variants: deletedVariants, ...cleanDeletedProductData } = product;

    this.eventEmitter.emit(
      'audit.log',
      new AuditLogEvent({
        action: 'PRODUCT_DELETED',
        actorId,
        targetId: deletedProduct.id,
        targetType: 'PRODUCT',
        oldValues: cleanDeletedProductData,
      }),
    );

    if (deletedVariants && deletedVariants.length > 0) {
      deletedVariants.forEach((variant) => {
        this.eventEmitter.emit(
          'audit.log',
          new AuditLogEvent({
            action: 'VARIANT_DELETED',
            actorId,
            targetId: variant.id,
            targetType: 'PRODUCT_VARIANT',
            oldValues: variant,
          }),
        );
      });
    }

    return deletedProduct;
  }

  async findVariant(sku: string): Promise<ProductVariant> {
    const cacheKey = `variant_${sku}`;
    const cachedVariant = await this.cacheManager.get<ProductVariant>(cacheKey);

    if (cachedVariant) {
      this.logger.log(`Cache HIT ${cacheKey}`, 'CACHE');
      return cachedVariant;
    }
    this.logger.log(`Cache MISS ${cacheKey}`, 'CACHE');

    const variant = await this.databaseService.productVariant.findUnique({
      where: { sku },
      include: {
        product: true,
      },
    });
    if (!variant) throw new NotFoundException('Variant not found');

    await this.cacheManager.set(cacheKey, variant, 30000);

    return variant;
  }

  async addVariant(
    slug: string,
    productVariantDto: ProductVariantDto,
    actorId: string,
  ): Promise<ProductVariant> {
    const product = await this.databaseService.product.findUnique({
      where: { slug, isArchived: false },
      include: { variants: true, category: true },
    });

    if (!product) throw new NotFoundException('Product not found');

    const color = productVariantDto.color.trim();
    const size = productVariantDto.size.trim();
    const discountPercentage = productVariantDto.discountPercentage ?? 0;
    const basePrice = Number(product.basePrice);
    const finalPrice = this.calculateFinalPrice(basePrice, discountPercentage);

    const exists = product.variants.some(
      (variant) =>
        variant.color.toLowerCase() === color.toLowerCase() &&
        variant.size.toLowerCase() === size.toLowerCase(),
    );

    if (exists) throw new ForbiddenException('Variant already exists');

    const sku = this.generateSku(product.category.name, color, size);

    const newVariant = await this.databaseService.productVariant.create({
      data: {
        ...productVariantDto,
        color,
        size,
        discountPercentage,
        finalPrice,
        sku,
        productId: product.id,
      },
    });

    // Invalidate the parent product so the new variant shows up instantly on the product page
    await this.cacheManager.del(`product_${slug}`);
    await this.invalidateListCache();

    this.eventEmitter.emit(
      'audit.log',
      new AuditLogEvent({
        action: 'VARIANT_CREATED',
        actorId,
        targetId: newVariant.id,
        targetType: 'PRODUCT_VARIANT',
        newValues: newVariant,
      }),
    );

    return newVariant;
  }

  async updateVariant(
    slug: string,
    sku: string,
    updateVariantDto: UpdateVariantDto,
    actorId: string,
  ): Promise<ProductVariant> {
    const product = await this.databaseService.product.findUnique({
      where: { slug },
      include: { variants: true, category: true },
    });

    if (!product) throw new NotFoundException('Product not found');

    const variant = product.variants.find((v) => v.sku === sku);

    if (!variant) throw new NotFoundException('Variant not found');

    const color = updateVariantDto.color?.trim() ?? variant.color;
    const size = updateVariantDto.size?.trim() ?? variant.size;

    const duplicate = product.variants.some(
      (variant) =>
        variant.sku !== sku &&
        variant.color.toLowerCase() === color.toLowerCase() &&
        variant.size.toLowerCase() === size.toLowerCase(),
    );

    if (duplicate) throw new ForbiddenException('Variant already exists');

    const discountPercentage =
      updateVariantDto.discountPercentage ?? variant.discountPercentage ?? 0;
    const basePrice = Number(product.basePrice);
    const finalPrice = this.calculateFinalPrice(basePrice, discountPercentage);

    const newSku =
      updateVariantDto.color || updateVariantDto.size
        ? this.generateSku(product.category.name, color, size)
        : variant.sku;

    const updatedVariant = await this.databaseService.productVariant.update({
      where: { sku },
      data: {
        ...updateVariantDto,
        color,
        size,
        discountPercentage,
        finalPrice,
        sku: newSku,
      },
    });

    await this.cacheManager.del(`product_${slug}`); // Clear parent product
    await this.cacheManager.del(`variant_${sku}`); // Clear old variant
    if (newSku !== sku) {
      await this.cacheManager.del(`variant_${newSku}`); // Clear new variant if sku changed
    }
    await this.invalidateListCache();

    if (this.hasChanged(variant, updatedVariant)) {
      this.eventEmitter.emit(
        'audit.log',
        new AuditLogEvent({
          action: 'VARIANT_UPDATED',
          actorId,
          targetId: updatedVariant.id,
          targetType: 'PRODUCT_VARIANT',
          oldValues: variant,
          newValues: updatedVariant,
        }),
      );
    }

    return updatedVariant;
  }

  async deleteVariant(
    slug: string,
    sku: string,
    actorId: string,
  ): Promise<ProductVariant> {
    const product = await this.databaseService.product.findUnique({
      where: { slug },
      include: { variants: true },
    });

    if (!product) throw new NotFoundException('Product not found');

    const variant = await this.databaseService.productVariant.findUnique({
      where: { sku },
    });

    if (!variant || variant.productId !== product.id)
      throw new NotFoundException('Variant not found');

    if (product.variants.length <= 1) {
      throw new ForbiddenException(
        'Cannot delete the last variant of a product',
      );
    }

    try {
      const deletedVariant = await this.databaseService.productVariant.delete({
        where: { sku },
      });

      await this.cacheManager.del(`product_${slug}`); // Parent must be refreshed
      await this.cacheManager.del(`variant_${sku}`);
      await this.invalidateListCache();

      this.eventEmitter.emit(
        'audit.log',
        new AuditLogEvent({
          action: 'VARIANT_DELETED',
          actorId,
          targetId: deletedVariant.id,
          targetType: 'PRODUCT_VARIANT',
          oldValues: deletedVariant,
        }),
      );

      return deletedVariant;
    } catch (error) {
      if ((error as PrismaClientKnownRequestError).code === 'P2003') {
        throw new ConflictException(
          'Cannot delete this variant because it is attached to existing orders. You must archive the parent product instead.',
        );
      }
      throw error;
    }
  }

  private calculateFinalPrice(basePrice: number, discount: number): number {
    return discount > 0 ? basePrice - (basePrice * discount) / 100 : basePrice;
  }

  private generateSlug(name: string): string {
    return slugify(name, {
      lowercase: true,
      separator: '-',
    });
  }

  private generateSku(category: string, color: string, size: string): string {
    const clean = (str: string) =>
      str
        .replace(/[^a-zA-Z0-9]/g, '')
        .substring(0, 4)
        .toUpperCase();
    const shortHash = crypto.randomBytes(4).toString('hex').toUpperCase();

    return `${clean(category)}-${clean(color)}-${clean(size)}-${shortHash}`;
  }

  private async generateProductsListCacheKey(
    query: ProductQueryDto,
    filters?: {
      categoryId?: string;
      tags?: string[];
      featured?: boolean;
      isArchived?: boolean;
    },
  ): Promise<string> {
    const version = await this.getListCacheVersion();
    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      orderBy = 'desc',
      title,
    } = query;

    // Generate cache key
    return `products_list_v${version}_page:${page}_limit:${limit}_sort:${sortBy}_${orderBy}_category:${
      filters?.categoryId || 'all'
    }_tags:${filters?.tags?.join(',') || 'none'}_featured:${
      filters?.featured ?? 'all'
    }_archived:${filters?.isArchived ?? false}_title:${title || 'all'}`;
  }

  private async getListCacheVersion(): Promise<number> {
    const version = await this.cacheManager.get<number>(
      this.LIST_CACHE_VERSION_KEY,
    );
    if (!version) {
      const initial = Date.now();
      // Set without TTL so it persists as long as the store allows
      await this.cacheManager.set(this.LIST_CACHE_VERSION_KEY, initial, 0);
      return initial;
    }

    return version;
  }

  private async invalidateListCache(): Promise<void> {
    await this.cacheManager.set(this.LIST_CACHE_VERSION_KEY, Date.now(), 0);
    this.logger.log('Products list cache invalidated', 'CACHE');
  }

  private hasChanged(
    oldValues: Record<string, any>,
    newValues: Record<string, any>,
  ): boolean {
    if (!oldValues || !newValues) return true;

    const keys = new Set([
      ...Object.keys(oldValues),
      ...Object.keys(newValues),
    ]);

    keys.delete('updatedAt');
    keys.delete('createdAt');

    for (const key of keys) {
      let oldValue = oldValues[key];
      let newValue = newValues[key];

      if (oldValue === null && newValue === undefined) continue;
      if (oldValue === undefined && newValue === null) continue;

      if (oldValue && typeof oldValue.toNumber === 'function')
        oldValue = oldValue.toNumber();
      if (newValue && typeof newValue.toNumber === 'function')
        newValue = newValue.toNumber();

      if (oldValue instanceof Date) oldValue = oldValue.getTime();
      if (newValue instanceof Date) newValue = newValue.getTime();

      if (Array.isArray(oldValue) && Array.isArray(newValue)) {
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) return true;
        continue;
      }

      if (oldValue !== newValue) {
        return true;
      }
    }
    return false;
  }
}
