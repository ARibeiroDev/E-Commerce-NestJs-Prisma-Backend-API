import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { CartService } from './cart.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type RequestUser,
} from '../common/decorators/current-user.decorator';
import { ApiBearerAuth } from '@nestjs/swagger';

@Controller('cart')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  async getUserCart(@CurrentUser() user: RequestUser) {
    return this.cartService.getUserCart(user.id);
  }

  @Post('add')
  async addItemToCart(
    @CurrentUser() user: RequestUser,
    @Body() body: { sku: string; quantity: number },
  ) {
    const { sku, quantity } = body;
    return this.cartService.addItemToCart(user.id, sku, quantity);
  }

  @Patch('update')
  async updateItem(
    @CurrentUser() user: RequestUser,
    @Body() body: { sku: string; quantity: number },
  ) {
    const { sku, quantity } = body;
    return this.cartService.updateItemQuantity(user.id, sku, quantity);
  }

  @Delete('remove/:sku')
  async removeItem(
    @CurrentUser() user: RequestUser,
    @Param('sku') sku: string,
  ) {
    return this.cartService.removeItemFromCart(user.id, sku);
  }

  @Post('merge')
  async mergeGuestCart(
    @CurrentUser() user: RequestUser,
    @Body()
    body: {
      items: { sku: string; quantity: number }[];
    },
  ) {
    return this.cartService.mergeGuestCart(user.id, body.items);
  }

  @Delete('clear')
  async clearCart(@CurrentUser() user: RequestUser) {
    return this.cartService.clearCart(user.id);
  }
}
