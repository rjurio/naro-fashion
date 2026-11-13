import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { AuditService } from '../audit/audit.service';
import { assertSameTenant } from '../products/util/tenant-ownership';

@Injectable()
export class RentalChecklistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
  ) {}

  /** R3 scope: a product OR a category (not both), each from this shop. */
  private async checkScope(productId?: string | null, categoryId?: string | null) {
    if (productId && categoryId) throw new BadRequestException('A checklist applies to a product OR a category, not both.');
    const tenantId = this.tenantContext.requireId;
    await assertSameTenant(this.prisma.product as any, productId, tenantId, 'Product');
    await assertSameTenant(this.prisma.category as any, categoryId, tenantId, 'Category');
  }

  async getTemplates() {
    return this.prisma.rentalChecklistTemplate.findMany({
      where: { deletedAt: null, tenantId: this.tenantContext.requireId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTemplate(id: string) {
    const template = await this.prisma.rentalChecklistTemplate.findFirst({
      where: { id, tenantId: this.tenantContext.requireId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!template) {
      throw new NotFoundException('Checklist template not found');
    }
    return template;
  }

  async createTemplate(dto: CreateTemplateDto) {
    await this.checkScope(dto.productId, dto.categoryId);
    const created = await this.prisma.rentalChecklistTemplate.create({
      data: {
        tenantId: this.tenantContext.requireId,
        name: dto.name,
        description: dto.description,
        isDefault: dto.isDefault ?? false,
        productId: dto.productId || null,
        categoryId: dto.categoryId || null,
        items: {
          create: dto.items.map((item, index) => ({
            label: item.label,
            labelSwahili: item.labelSwahili,
            itemType: item.itemType,
            sortOrder: item.sortOrder ?? index,
            quantity: item.quantity ?? 1,
            isMandatory: item.isMandatory ?? true,
            requiresCondition: item.requiresCondition ?? true,
            instructions: item.instructions ?? null,
          })),
        },
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.audit.log('CHECKLIST_TEMPLATE_CREATED', 'RentalChecklistTemplate', created.id, {
      productId: created.productId, categoryId: created.categoryId, items: created.items.length,
    });
    return created;
  }

  async updateTemplate(id: string, dto: UpdateTemplateDto) {
    const template = await this.prisma.rentalChecklistTemplate.findFirst({
      where: { id, tenantId: this.tenantContext.requireId },
    });
    if (!template) {
      throw new NotFoundException('Checklist template not found');
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.productId !== undefined || dto.categoryId !== undefined) {
      const productId = dto.productId !== undefined ? dto.productId || null : template.productId;
      const categoryId = dto.categoryId !== undefined ? dto.categoryId || null : template.categoryId;
      await this.checkScope(productId, categoryId);
      data.productId = productId;
      data.categoryId = categoryId;
    }

    // R3: bookings keep the snapshot frozen at their confirmation, so editing
    // a template (items replaced, version bumped) only affects bookings
    // confirmed afterwards.
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.items !== undefined) {
        await tx.rentalChecklistTemplateItem.deleteMany({ where: { templateId: id } });
        data.items = {
          create: dto.items.map((item, index) => ({
            label: item.label,
            labelSwahili: item.labelSwahili,
            itemType: item.itemType,
            sortOrder: item.sortOrder ?? index,
            quantity: item.quantity ?? 1,
            isMandatory: item.isMandatory ?? true,
            requiresCondition: item.requiresCondition ?? true,
            instructions: item.instructions ?? null,
          })),
        };
      }
      data.version = { increment: 1 };
      return tx.rentalChecklistTemplate.update({
        where: { id },
        data,
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
    });
    await this.audit.log('CHECKLIST_TEMPLATE_UPDATED', 'RentalChecklistTemplate', id, {
      version: updated.version, productId: updated.productId, categoryId: updated.categoryId, items: updated.items.length,
    });
    return updated;
  }

  async deleteTemplate(id: string) {
    const template = await this.prisma.rentalChecklistTemplate.findFirst({
      where: { id, tenantId: this.tenantContext.requireId },
    });
    if (!template) {
      throw new NotFoundException('Checklist template not found');
    }

    await this.prisma.rentalChecklistTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { message: 'Checklist template moved to recycle bin' };
  }

  async restoreTemplate(id: string) {
    const template = await this.prisma.rentalChecklistTemplate.findFirst({
      where: { id, tenantId: this.tenantContext.requireId },
    });
    if (!template || !template.deletedAt) {
      throw new NotFoundException('Deleted template not found');
    }

    return this.prisma.rentalChecklistTemplate.update({
      where: { id },
      data: { deletedAt: null },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async findDeletedTemplates() {
    return this.prisma.rentalChecklistTemplate.findMany({
      where: { deletedAt: { not: null }, tenantId: this.tenantContext.requireId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async toggleActive(id: string) {
    const template = await this.prisma.rentalChecklistTemplate.findFirst({
      where: { id, tenantId: this.tenantContext.requireId },
    });
    if (!template) {
      throw new NotFoundException('Checklist template not found');
    }

    return this.prisma.rentalChecklistTemplate.update({
      where: { id },
      data: { isActive: !template.isActive },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async getActiveTemplates() {
    return this.prisma.rentalChecklistTemplate.findMany({
      where: { isActive: true, deletedAt: null, tenantId: this.tenantContext.requireId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async assignToRental(rentalOrderId: string, templateId: string) {
    const tenantId = this.tenantContext.requireId;
    const rental = await this.prisma.rentalOrder.findFirst({
      where: { id: rentalOrderId, tenantId },
    });
    if (!rental) {
      throw new NotFoundException('Rental order not found');
    }

    const template = await this.prisma.rentalChecklistTemplate.findFirst({
      where: { id: templateId, tenantId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!template) {
      throw new NotFoundException('Checklist template not found');
    }

    if (!template.isActive) {
      throw new BadRequestException('Cannot assign an inactive template');
    }

    if (template.items.length === 0) {
      throw new BadRequestException('Template has no checklist items');
    }

    // Create checklist entries from template items
    const entries = await this.prisma.rentalChecklistEntry.createMany({
      data: template.items.map((item) => ({
        rentalOrderId,
        label: item.label,
        itemType: item.itemType,
        sortOrder: item.sortOrder,
      })),
    });

    return this.prisma.rentalChecklistEntry.findMany({
      where: { rentalOrderId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getRentalChecklist(rentalOrderId: string) {
    const tenantId = this.tenantContext.requireId;
    const rental = await this.prisma.rentalOrder.findFirst({
      where: { id: rentalOrderId, tenantId },
    });
    if (!rental) {
      throw new NotFoundException('Rental order not found');
    }

    return this.prisma.rentalChecklistEntry.findMany({
      where: { rentalOrderId },
      orderBy: { sortOrder: 'asc' },
      include: {
        checkedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async checkItem(entryId: string, adminUserId: string, notes?: string) {
    // RentalChecklistEntry has no tenantId of its own — scope via the parent
    // RentalOrder so a tenant admin can't check/uncheck another tenant's
    // checklist entries by id (and mis-attribute the check to themselves).
    const entry = await this.prisma.rentalChecklistEntry.findFirst({
      where: { id: entryId, rentalOrder: { tenantId: this.tenantContext.requireId } },
    });
    if (!entry) {
      throw new NotFoundException('Checklist entry not found');
    }

    return this.prisma.rentalChecklistEntry.update({
      where: { id: entryId },
      data: {
        isChecked: true,
        checkedById: adminUserId,
        checkedAt: new Date(),
        notes,
      },
      include: {
        checkedBy: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
    });
  }

  async uncheckItem(entryId: string) {
    // Scope via parent RentalOrder tenant (see checkItem).
    const entry = await this.prisma.rentalChecklistEntry.findFirst({
      where: { id: entryId, rentalOrder: { tenantId: this.tenantContext.requireId } },
    });
    if (!entry) {
      throw new NotFoundException('Checklist entry not found');
    }

    return this.prisma.rentalChecklistEntry.update({
      where: { id: entryId },
      data: {
        isChecked: false,
        checkedById: null,
        checkedAt: null,
        notes: null,
      },
    });
  }
}
