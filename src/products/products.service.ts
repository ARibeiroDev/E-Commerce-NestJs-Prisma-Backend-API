import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { DatabaseService } from '../database/database.service';
import { PaginationQueryDto } from '../common/dtos/pagination-query.dto';
import { PaginatedResponse } from '../common/interfaces/paginated-response.interface';
import { Prisma, Product, ProductVariant } from 'generated/prisma/client';
import slugify from '@sindresorhus/slugify';
import crypto from 'crypto';
import { ProductVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { CACHE_MANAGER, Cache } from '@nestjs/cache-manager';
import { ProductQueryDto } from './dto/product-query.dto';
import { LoggerService } from 'src/logger/logger.service';

@Injectable()
export class ProductsService {
  // Cache version, upon update, older versions won't be used
  private cacheVersion = 1;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly logger: LoggerService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async findAll(
    query: PaginationQueryDto & {
      sortBy?: 'createdAt' | 'price' | 'title';
      orderBy?: 'asc' | 'desc';
    },
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
        include: { variants: true }, // Fetch related variants for each product, under the hood Prisma performs a JOIN
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
  async create(createProductDto: CreateProductDto) {
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

    return this.databaseService.product.create({
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
  }

  async update(
    slug: string,
    updateProductDto: UpdateProductDto,
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

    return this.databaseService.product.update({
      where: { slug },
      data: {
        ...productData,
        slug: newSlug,
      },
      include: { variants: true },
    });
  }

  async remove(slug: string): Promise<Product> {
    this.updateCacheVersion();
    return this.databaseService.product.delete({ where: { slug } });
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

    return this.databaseService.productVariant.create({
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
  }

  async updateVariant(
    slug: string,
    sku: string,
    updateVariantDto: UpdateVariantDto,
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

    return this.databaseService.productVariant.update({
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
  }

  async deleteVariant(slug: string, sku: string): Promise<ProductVariant> {
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

    return this.databaseService.productVariant.delete({ where: { sku } });
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
}
