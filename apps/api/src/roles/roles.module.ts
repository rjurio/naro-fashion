import { Module } from '@nestjs/common';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { SystemRolesSeeder } from './system-roles.seeder';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RolesController],
  providers: [RolesService, SystemRolesSeeder],
  exports: [RolesService],
})
export class RolesModule {}
