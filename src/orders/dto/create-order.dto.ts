import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateOrderDto {
  @ApiProperty({
    type: String,
    description: 'Shipping name',
    example: 'John Doe',
  })
  @IsString()
  @IsNotEmpty()
  shippingName: string;

  @ApiProperty({
    type: String,
    description: 'Shipping phone',
    example: '1234567890',
  })
  @IsString()
  @IsNotEmpty()
  shippingPhone: string;

  @ApiProperty({
    type: String,
    description: 'Shipping address',
    example: '123 Main St',
  })
  @IsString()
  @IsNotEmpty()
  shippingAddress: string;

  @ApiProperty({
    type: String,
    description: 'Shipping city',
    example: 'New York',
  })
  @IsString()
  @IsNotEmpty()
  shippingCity: string;

  @ApiProperty({
    type: String,
    description: 'Shipping postal code',
    example: '12345',
  })
  @IsString()
  @IsNotEmpty()
  shippingPostalCode: string;

  @ApiProperty({
    type: String,
    description: 'Shipping country',
    example: 'United States',
  })
  @IsString()
  @IsNotEmpty()
  shippingCountry: string;
}
