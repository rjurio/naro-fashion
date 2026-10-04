import { Module } from '@nestjs/common';
import { ExpenseCategoriesController } from './expense-categories.controller';
import { ExpenseCategoriesService } from './expense-categories.service';
import { ExpenseCategoriesSeeder } from './expense-categories.seeder';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ExpenseCategoriesController],
  providers: [ExpenseCategoriesService, ExpenseCategoriesSeeder],
  exports: [ExpenseCategoriesService],
})
export class ExpenseCategoriesModule {}
