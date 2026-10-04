import {
  Injectable,
  NotFoundException,
  ConflictException,
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
export class ProductSizesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly auditService: AuditService,
  ) {}

  // Default sizes are seeded by ProductSizesSeeder (singleton) — lifecycle
  // hooks never run on this request-scoped service.

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
