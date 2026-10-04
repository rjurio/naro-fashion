import { Module } from '@nestjs/common';
import { ProductSizesController } from './product-sizes.controller';
import { ProductSizesService } from './product-sizes.service';
import { ProductSizesSeeder } from './product-sizes.seeder';

@Module({
  controllers: [ProductSizesController],
  providers: [ProductSizesService, ProductSizesSeeder],
  exports: [ProductSizesService],
})
export class ProductSizesModule {}
