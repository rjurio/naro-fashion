import { Module } from '@nestjs/common';
import { ProductSizesController } from './product-sizes.controller';
import { ProductSizesService } from './product-sizes.service';

@Module({
  controllers: [ProductSizesController],
  providers: [ProductSizesService],
  exports: [ProductSizesService],
})
export class ProductSizesModule {}
