import {
  Injectable,
  NotFoundException,
  ConflictException,
  OnModuleInit,
} from '@nestjs/common';
import { IsString, IsOptional, IsBoolean, IsInt, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { AuditService } from '../audit/audit.service';

export class CreateProductSizeDto {
  @IsString() @MaxLength(20) name: string;
  @IsOptional() @IsString() @MaxLength(100) description?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsInt() @Min(0) @Type(() => Number) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateProductSizeDto {
  @IsOptional() @IsString() @MaxLength(20) name?: string;
  @IsOptional() @IsString() @MaxLength(100) description?: string;
  @IsOptional() @IsString() @MaxLength(40) category?: string;
  @IsOptional() @IsInt() @Min(0) @Type(() => Number) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Injectable()
export class ProductSizesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly auditService: AuditService,
  ) {}

  // Seed common defaults for any tenant on first boot if their list is empty.
  async onModuleInit() {
    try {
      const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
      for (const t of tenants) {
        const count = await this.prisma.productSize.count({
          where: { tenantId: t.id, deletedAt: null },
        });
        if (count > 0) continue;
        const defaults = [
          { name: 'XS', description: 'Extra Small', category: 'clothing', sortOrder: 10 },
          { name: 'S', description: 'Small', category: 'clothing', sortOrder: 20 },
          { name: 'M', description: 'Medium', category: 'clothing', sortOrder: 30 },
          { name: 'L', description: 'Large', category: 'clothing', sortOrder: 40 },
          { name: 'XL', description: 'Extra Large', category: 'clothing', sortOrder: 50 },
          { name: 'XXL', description: 'Double Extra Large', category: 'clothing', sortOrder: 60 },
          { name: 'XXXL', description: 'Triple Extra Large', category: 'clothing', sortOrder: 70 },
          { name: '36', category: 'clothing', sortOrder: 100 },
          { name: '38', category: 'clothing', sortOrder: 110 },
          { name: '40', category: 'clothing', sortOrder: 120 },
          { name: '42', category: 'clothing', sortOrder: 130 },
          { name: '44', category: 'clothing', sortOrder: 140 },
          { name: '46', category: 'clothing', sortOrder: 150 },
          { name: 'One Size', description: 'Free size / one size fits all', category: 'clothing', sortOrder: 200 },
        ];
        await this.prisma.productSize.createMany({
          data: defaults.map((d) => ({ ...d, tenantId: t.id })),
          skipDuplicates: true,
        });
      }
    } catch {
      // Seeding failure should never break boot
    }
  }

  findAll() {
    return this.prisma.productSize.findMany({
      where: { tenantId: this.tenantContext.requireId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  findActive() {
    return this.prisma.productSize.findMany({
      where: { tenantId: this.tenantContext.requireId, deletedAt: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  findDeleted() {
    return this.prisma.productSize.findMany({
      where: { tenantId: this.tenantContext.requireId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async create(dto: CreateProductSizeDto) {
    const tenantId = this.tenantContext.requireId;
    try {
      const created = await this.prisma.productSize.create({
        data: { ...dto, tenantId },
      });
      await this.auditService.log('CREATE', 'ProductSize', created.id, { name: dto.name });
      return created;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException(`Size "${dto.name}" already exists`);
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateProductSizeDto) {
    const tenantId = this.tenantContext.requireId;
    const existing = await this.prisma.productSize.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Size not found');
    try {
      const updated = await this.prisma.productSize.update({
        where: { id },
        data: dto,
      });
      await this.auditService.log('UPDATE', 'ProductSize', id, dto);
      return updated;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException(`Size "${dto.name}" already exists`);
      }
      throw err;
    }
  }

  async toggleActive(id: string) {
    const tenantId = this.tenantContext.requireId;
    const existing = await this.prisma.productSize.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Size not found');
    const updated = await this.prisma.productSize.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });
    await this.auditService.log('TOGGLE_ACTIVE', 'ProductSize', id, { isActive: updated.isActive });
    return updated;
  }

  async remove(id: string) {
    const tenantId = this.tenantContext.requireId;
    const existing = await this.prisma.productSize.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Size not found');
    const deleted = await this.prisma.productSize.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.auditService.log('DELETE', 'ProductSize', id, { name: existing.name });
    return deleted;
  }

  async restore(id: string) {
    const tenantId = this.tenantContext.requireId;
    const existing = await this.prisma.productSize.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Size not found');
    const restored = await this.prisma.productSize.update({
      where: { id },
      data: { deletedAt: null },
    });
    await this.auditService.log('RESTORE', 'ProductSize', id);
    return restored;
  }
}
