import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductVariantDto } from './dto/create-variant.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { PaginatedResponse } from '../common/interfaces/paginated-response.interface';
import { Product, ProductVariant, Role } from 'generated/prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async findAll(
    @Query() query: ProductQueryDto,
  ): Promise<PaginatedResponse<Product>> {
    const { page, limit, categoryId, tags, featured, title, sortBy, orderBy } =
      query;

    const filters = { categoryId, tags, featured, title };
    return this.productsService.findAll(
      { page, limit, sortBy, orderBy, title },
      filters,
    );
  }

  @Get(':slug')
  async findOneBySlug(@Param('slug') slug: string): Promise<Product> {
    return this.productsService.findOneBySlug(slug);
  }

  @Get('variants/:sku')
  async findVariantBySku(@Param('sku') sku: string): Promise<ProductVariant> {
    return this.productsService.findVariant(sku);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createProductDto: CreateProductDto): Promise<Product> {
    return this.productsService.create(createProductDto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Patch(':slug')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('slug') slug: string,
    @Body() updateProductDto: UpdateProductDto,
  ): Promise<Product> {
    return this.productsService.update(slug, updateProductDto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Delete(':slug')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('slug') slug: string): Promise<void> {
    await this.productsService.remove(slug);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post(':slug/variants')
  @HttpCode(HttpStatus.CREATED)
  async addVariant(
    @Param('slug') slug: string,
    @Body() productVariantDto: ProductVariantDto,
  ): Promise<ProductVariant> {
    return this.productsService.addVariant(slug, productVariantDto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Patch(':slug/variants/:sku')
  @HttpCode(HttpStatus.OK)
  async updateVariant(
    @Param('slug') slug: string,
    @Param('sku') sku: string,
    @Body() updateVariantDto: UpdateVariantDto,
  ): Promise<ProductVariant> {
    return this.productsService.updateVariant(slug, sku, updateVariantDto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Delete(':slug/variants/:sku')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteVariant(
    @Param('slug') slug: string,
    @Param('sku') sku: string,
  ): Promise<void> {
    await this.productsService.deleteVariant(slug, sku);
  }
}
