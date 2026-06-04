import {
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

@Injectable()
export class ProductsService {
  // Cache version, upon update, older versions won't be used
  private cacheVersion = 1;

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
    },
  ): Promise<PaginatedResponse<Product>> {
    const cacheKey = this.generateProductsListCacheKey(query, filters);

    const getCachedData =
      await this.cacheManager.get<PaginatedResponse<Product>>(cacheKey);

    if (getCachedData) {
      this.logger.log(`Cache HIT: ${cacheKey}`, 'CACHE'); // Cache hit, returns cached data
      return getCachedData;
    }

    this.logger.log(`Cache MISS: ${cacheKey}`, 'CACHE'); // Cache miss, returns fresh data from database

    const page = query.page || 1;
    const limit = query.limit || 10;
    const skip = (page - 1) * limit;

    // Prisma translates this into a SQL WHERE clause
    const where: Prisma.ProductWhereInput = {};

    if (filters?.categoryId) where.categoryId = filters.categoryId;
    if (filters?.featured !== undefined) where.featured = filters.featured;
    if (filters?.title)
      where.title = { contains: filters.title, mode: 'insensitive' };
    if (filters?.tags?.length) where.tags = { hasSome: filters.tags }; // Prisma Array filter

    const sortBy = query.sortBy || 'createdAt';
    const orderBy = query.orderBy || 'desc';

    const [totalItems, data] = await this.databaseService.$transaction([
      this.databaseService.product.count({ where }),
      this.databaseService.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: orderBy },
        include: { variants: true, category: true }, // Fetch related variants for each product, under the hood Prisma performs a JOIN
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

    // Set cache
    await this.cacheManager.set(cacheKey, responseResult, 30000);

    return responseResult;
  }

  async findOneBySlug(slug: string): Promise<Product> {
    const cacheKey = `product_v${this.cacheVersion}_${slug}`;
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

    this.updateCacheVersion();

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

    // Strip out the variants from the response
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

    // Emit independent logs for cascading variants
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

    // Default slug
    let newSlug = product.slug;

    // Generate new slug if name changes
    if (updateProductDto.title && updateProductDto.title !== product.title) {
      newSlug = this.generateSlug(updateProductDto.title);
    }

    //eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { variants, ...productData } = updateProductDto;

    this.updateCacheVersion();

    const updatedProduct = await this.databaseService.product.update({
      where: { slug },
      data: {
        ...productData,
        slug: newSlug,
      },
      include: { variants: true },
    });

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
          oldValues: product, // Was pulled without includes, already clean
          newValues: cleanUpdatedProductData,
        }),
      );
    }

    return updatedProduct;
  }

  async remove(slug: string, actorId: string): Promise<Product> {
    const product = await this.databaseService.product.findUnique({
      where: { slug },
      include: { variants: true }, // Included variants to safely snapshot them before cascade delete
    });
    if (!product) throw new NotFoundException('Product not found');

    this.updateCacheVersion();

    const deletedProduct = await this.databaseService.product.delete({
      where: { slug },
    });

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
    const cacheKey = `variant_v${this.cacheVersion}_${sku}`;
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
      where: { slug },
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

    this.updateCacheVersion();

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

    this.updateCacheVersion();

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

    this.updateCacheVersion();

    const deletedVariant = await this.databaseService.productVariant.delete({
      where: { sku },
    });

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

  private updateCacheVersion(): void {
    this.cacheVersion++;
    this.logger.log(`Cache version updated to v${this.cacheVersion}`, 'CACHE');
  }

  private generateProductsListCacheKey(
    query: ProductQueryDto,
    filters?: {
      categoryId?: string;
      tags?: string[];
      featured?: boolean;
    },
  ): string {
    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      orderBy = 'desc',
      title,
    } = query;

    return `products_v${this.cacheVersion}_page:${page}_limit:${limit}_sort:${sortBy}_${orderBy}_category:${
      filters?.categoryId || 'all'
    }_tags:${filters?.tags?.join(',') || 'none'}_featured:${
      filters?.featured ?? 'all'
    }_title:${title || 'all'}`;
  }

  private hasChanged(
    oldValues: Record<string, any>,
    newValues: Record<string, any>,
  ): boolean {
    if (!oldValues || !newValues) return true;

    // Gather all unique keys from both
    const keys = new Set([
      ...Object.keys(oldValues),
      ...Object.keys(newValues),
    ]);

    // Delete auto-updated timestamps
    keys.delete('updatedAt');
    keys.delete('createdAt');

    for (const key of keys) {
      let oldValue = oldValues[key];
      let newValue = newValues[key];

      // Treat null and undefined as equl for backend payloads
      if (oldValue === null && newValue === undefined) continue;
      if (oldValue === undefined && newValue === null) continue;

      // Normalize Prisma Decimals to numbers
      if (oldValue && typeof oldValue.toNumber === 'function')
        oldValue = oldValue.toNumber();
      if (newValue && typeof newValue.toNumber === 'function')
        newValue = newValue.toNumber();

      // Normalize JavaScript Date objects to timestamps
      if (oldValue instanceof Date) oldValue = oldValue.getTime();
      if (newValue instanceof Date) newValue = newValue.getTime();

      // Handle Array comparison (e.g., tags, images)
      if (Array.isArray(oldValue) && Array.isArray(newValue)) {
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) return true;
        continue;
      }

      // If any remaining value differs, it's a genuine update
      if (oldValue !== newValue) {
        return true;
      }
    }
    return false;
  }
}
