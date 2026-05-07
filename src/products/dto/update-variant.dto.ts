import { PartialType } from '@nestjs/mapped-types';
import { ProductVariantDto } from './create-variant.dto';

export class UpdateVariantDto extends PartialType(ProductVariantDto) {}
