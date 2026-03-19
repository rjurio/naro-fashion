import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';

export class CreateSizeGuideDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  nameSwahili?: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  contentSwahili?: string;

  @IsOptional()
  @IsString()
  pdfUrl?: string;

  @IsOptional()
  @IsString()
  pdfUrlSwahili?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateSizeGuideDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  nameSwahili?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  contentSwahili?: string;

  @IsOptional()
  @IsString()
  pdfUrl?: string;

  @IsOptional()
  @IsString()
  pdfUrlSwahili?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

@Injectable()
export class SizeGuidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  async findAll() {
    return this.prisma.sizeGuide.findMany({
      where: { deletedAt: null, tenantId: this.tenantContext.requireId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
  }

  async findAllPublic() {
    return this.prisma.sizeGuide.findMany({
      where: { isActive: true, deletedAt: null, tenantId: this.tenantContext.requireId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async findBySlug(slug: string) {
    const guide = await this.prisma.sizeGuide.findFirst({ where: { slug, tenantId: this.tenantContext.requireId } });
    if (!guide || guide.deletedAt) throw new NotFoundException('Size guide not found');
    return guide;
  }

  async findById(id: string) {
    const guide = await this.prisma.sizeGuide.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!guide || guide.deletedAt) throw new NotFoundException('Size guide not found');
    return guide;
  }

  async findDefault() {
    const tenantId = this.tenantContext.requireId;
    const guide = await this.prisma.sizeGuide.findFirst({
      where: { isDefault: true, isActive: true, deletedAt: null, tenantId },
    });
    if (!guide) {
      // Fallback to first active guide
      return this.prisma.sizeGuide.findFirst({
        where: { isActive: true, deletedAt: null, tenantId },
        orderBy: { createdAt: 'asc' },
      });
    }
    return guide;
  }

  async create(dto: CreateSizeGuideDto) {
    const tenantId = this.tenantContext.requireId;
    const slug = this.generateSlug(dto.name);
    const existing = await this.prisma.sizeGuide.findFirst({ where: { slug, tenantId } });
    if (existing) throw new ConflictException('A size guide with a similar name already exists');

    // If this is set as default, unset others
    if (dto.isDefault) {
      await this.prisma.sizeGuide.updateMany({
        where: { isDefault: true, tenantId },
        data: { isDefault: false },
      });
    }

    return this.prisma.sizeGuide.create({
      data: {
        tenantId,
        name: dto.name,
        nameSwahili: dto.nameSwahili,
        slug,
        content: dto.content,
        contentSwahili: dto.contentSwahili,
        pdfUrl: dto.pdfUrl,
        pdfUrlSwahili: dto.pdfUrlSwahili,
        isDefault: dto.isDefault ?? false,
      },
    });
  }

  async update(id: string, dto: UpdateSizeGuideDto) {
    const tenantId = this.tenantContext.requireId;
    const guide = await this.prisma.sizeGuide.findFirst({ where: { id, tenantId } });
    if (!guide || guide.deletedAt) throw new NotFoundException('Size guide not found');

    const data: any = { ...dto };

    // Regenerate slug if name changed
    if (dto.name && dto.name !== guide.name) {
      data.slug = this.generateSlug(dto.name);
    }

    // If setting as default, unset others
    if (dto.isDefault === true) {
      await this.prisma.sizeGuide.updateMany({
        where: { isDefault: true, id: { not: id }, tenantId },
        data: { isDefault: false },
      });
    }

    return this.prisma.sizeGuide.update({ where: { id }, data });
  }

  async delete(id: string) {
    const guide = await this.prisma.sizeGuide.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!guide) throw new NotFoundException('Size guide not found');
    await this.prisma.sizeGuide.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { message: 'Size guide moved to recycle bin' };
  }

  async restore(id: string) {
    const guide = await this.prisma.sizeGuide.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!guide || !guide.deletedAt) throw new NotFoundException('Deleted size guide not found');
    return this.prisma.sizeGuide.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
    });
  }

  async findDeleted() {
    return this.prisma.sizeGuide.findMany({
      where: { deletedAt: { not: null }, tenantId: this.tenantContext.requireId },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async toggleActive(id: string) {
    const guide = await this.prisma.sizeGuide.findFirst({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!guide || guide.deletedAt) throw new NotFoundException('Size guide not found');
    return this.prisma.sizeGuide.update({
      where: { id },
      data: { isActive: !guide.isActive },
    });
  }

  async setDefault(id: string) {
    const tenantId = this.tenantContext.requireId;
    const guide = await this.prisma.sizeGuide.findFirst({ where: { id, tenantId } });
    if (!guide || guide.deletedAt) throw new NotFoundException('Size guide not found');

    await this.prisma.sizeGuide.updateMany({
      where: { isDefault: true, tenantId },
      data: { isDefault: false },
    });

    return this.prisma.sizeGuide.update({
      where: { id },
      data: { isDefault: true },
    });
  }
}
