import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { AuditService } from '../audit/audit.service';
import { assertSameTenant } from '../products/util/tenant-ownership';
import { templateContentHash } from '../rentals/checklist/checklist-core';
import { ApproveTemplateDto, WithdrawTemplateDto } from './dto/approve-template.dto';

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

  /** Round 25F D: every template read carries the hash of its CURRENT content (what an approval must name). */
  private withHash<T extends { items?: any[] }>(t: T) {
    return { ...t, contentHash: templateContentHash(t as any) };
  }

  async getTemplates() {
    const rows = await this.prisma.rentalChecklistTemplate.findMany({
      where: { deletedAt: null, tenantId: this.tenantContext.requireId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((t) => this.withHash(t));
  }

  async getTemplate(id: string) {
    const template = await this.prisma.rentalChecklistTemplate.findFirst({
      where: { id, tenantId: this.tenantContext.requireId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!template) {
      throw new NotFoundException('Checklist template not found');
    }
    return this.withHash(template);
  }

  async createTemplate(dto: CreateTemplateDto, actorId?: string) {
    await this.checkScope(dto.productId, dto.categoryId);
    const created = await this.prisma.rentalChecklistTemplate.create({
      data: {
        tenantId: this.tenantContext.requireId,
        name: dto.name,
        description: dto.description,
        isDefault: dto.isDefault ?? false,
        productId: dto.productId || null,
        categoryId: dto.categoryId || null,
        // Round 25F D: a new template is a DRAFT until a different person approves it.
        approvalStatus: 'DRAFT',
        draftAuthorIds: actorId ? [actorId] : [],
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
    const hash = templateContentHash(created as any);
    await this.audit.log('CHECKLIST_TEMPLATE_CREATED', 'RentalChecklistTemplate', created.id, {
      productId: created.productId, categoryId: created.categoryId, items: created.items.length,
    });
    await this.audit.log('TEMPLATE_SUBMITTED', 'RentalChecklistTemplate', created.id, { version: created.version, hash, status: 'DRAFT' });
    return this.withHash(created);
  }

  async updateTemplate(id: string, dto: UpdateTemplateDto, actorId?: string) {
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
      // Round 25F D: any edit is a new, unapproved version ("correction" of
      // an approved list). Authors of this version may not approve it.
      data.approvalStatus = 'DRAFT';
      data.withdrawnAt = null; data.withdrawnById = null; data.withdrawalReason = null;
      const authors = template.approvalStatus === 'DRAFT' ? [...(template.draftAuthorIds ?? [])] : [];
      if (actorId && !authors.includes(actorId)) authors.push(actorId);
      data.draftAuthorIds = authors;
      return tx.rentalChecklistTemplate.update({
        where: { id },
        data,
        include: { items: { orderBy: { sortOrder: 'asc' } } },
      });
    });
    await this.audit.log('CHECKLIST_TEMPLATE_UPDATED', 'RentalChecklistTemplate', id, {
      version: updated.version, productId: updated.productId, categoryId: updated.categoryId, items: updated.items.length,
    });
    const hash = templateContentHash(updated as any);
    if (template.approvalStatus === 'APPROVED') {
      await this.audit.log('TEMPLATE_CORRECTED', 'RentalChecklistTemplate', id, {
        fromApprovedVersion: template.approvedVersion, fromApprovedHash: template.approvedHash, version: updated.version, hash, status: 'DRAFT',
      });
    } else {
      await this.audit.log('TEMPLATE_SUBMITTED', 'RentalChecklistTemplate', id, { version: updated.version, hash, status: 'DRAFT' });
    }
    return this.withHash(updated);
  }

  /**
   * Round 25F D — two-person activation. The approver names the EXACT
   * version + content hash they reviewed, the scope, and EVERY item with its
   * quantity (the physical verification). They must not have prepared this
   * version; no role bypasses that (SUPER_ADMIN included). The database
   * re-checks the same rules (naro_r3_template_approval_guard).
   */
  async approveTemplate(id: string, dto: ApproveTemplateDto, actor: { id: string }) {
    const tenantId = this.tenantContext.requireId;
    const t = await this.prisma.rentalChecklistTemplate.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!t) throw new NotFoundException('Checklist template not found');
    const hash = templateContentHash(t as any);
    const deny = async (reason: string, extra: any = {}) =>
      this.audit.log('TEMPLATE_APPROVAL_DENIED', 'RentalChecklistTemplate', id, { reason, version: t.version, hash, ...extra });
    if (t.approvalStatus === 'APPROVED' && t.approvedVersion === t.version) {
      throw new ConflictException({ statusCode: 409, code: 'ALREADY_APPROVED', message: `Version ${t.version} is already approved.` });
    }
    if ((t.draftAuthorIds ?? []).includes(actor.id)) {
      await deny('SELF_APPROVAL');
      throw new ForbiddenException({ statusCode: 403, code: 'SELF_APPROVAL', message: 'A checklist must be approved by someone who did not prepare or edit this version.' });
    }
    if (dto.version !== t.version || dto.hash !== hash) {
      await deny('TEMPLATE_CHANGED', { reviewedVersion: dto.version, reviewedHash: dto.hash });
      throw new ConflictException({
        statusCode: 409, code: 'TEMPLATE_CHANGED', version: t.version, hash,
        message: 'The checklist changed since you reviewed it. Reload and verify it again.',
      });
    }
    if (t.items.length === 0) {
      await deny('EMPTY');
      throw new BadRequestException({ statusCode: 400, code: 'EMPTY_TEMPLATE', message: 'An empty checklist cannot be approved.' });
    }
    const scopeOk = (dto.scope?.productId ?? null) === (t.productId ?? null) && (dto.scope?.categoryId ?? null) === (t.categoryId ?? null);
    const confirmed = new Map((dto.confirmedItems ?? []).map((c) => [c.itemId, c.quantity]));
    const problems = [
      ...(scopeOk ? [] : ['the product / category the list applies to']),
      ...t.items.filter((i: any) => confirmed.get(i.id) !== i.quantity).map((i: any) => `${i.label} × ${i.quantity}`),
      ...[...confirmed.keys()].filter((k) => !t.items.some((i: any) => i.id === k)).map((k) => `unknown item ${k}`),
    ];
    if (problems.length) {
      await deny('NOT_CONFIRMED', { problems });
      throw new BadRequestException({
        statusCode: 400, code: 'ITEMS_NOT_CONFIRMED', problems,
        message: `Confirm every item with its exact quantity, and the scope, before approving: ${problems.join('; ')}.`,
      });
    }
    const res = await this.prisma.rentalChecklistTemplate.updateMany({
      where: { id, tenantId, version: t.version, approvalStatus: t.approvalStatus, deletedAt: null },
      data: {
        approvalStatus: 'APPROVED', approvedVersion: t.version, approvedHash: hash, approvedById: actor.id, approvedAt: new Date(),
        withdrawnAt: null, withdrawnById: null, withdrawalReason: null,
      },
    });
    if (res.count === 0) throw new ConflictException({ statusCode: 409, code: 'TEMPLATE_CHANGED', message: 'The checklist changed while you approved it. Reload.' });
    await this.audit.log('TEMPLATE_APPROVED', 'RentalChecklistTemplate', id, {
      version: t.version, hash, items: t.items.map((i: any) => ({ id: i.id, label: i.label, quantity: i.quantity })),
      productId: t.productId, categoryId: t.categoryId, preparedBy: t.draftAuthorIds,
    });
    return this.getTemplate(id);
  }

  /** Round 25F D: stop a template from being used for new bookings (existing snapshots are untouched). */
  async withdrawTemplate(id: string, dto: WithdrawTemplateDto, actor: { id: string }) {
    const tenantId = this.tenantContext.requireId;
    const t = await this.prisma.rentalChecklistTemplate.findFirst({ where: { id, tenantId, deletedAt: null }, include: { items: true } });
    if (!t) throw new NotFoundException('Checklist template not found');
    if (t.approvalStatus === 'WITHDRAWN') throw new ConflictException({ statusCode: 409, code: 'ALREADY_WITHDRAWN', message: 'This checklist is already withdrawn.' });
    const previousStatus = t.approvalStatus;
    const hash = templateContentHash(t as any);
    await this.prisma.rentalChecklistTemplate.updateMany({
      where: { id, tenantId },
      data: { approvalStatus: 'WITHDRAWN', withdrawnById: actor.id, withdrawnAt: new Date(), withdrawalReason: dto.reason.trim() },
    });
    await this.audit.log('TEMPLATE_WITHDRAWN', 'RentalChecklistTemplate', id, {
      version: t.version, hash, previousStatus, reason: dto.reason.trim(),
    });
    return this.getTemplate(id);
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
    await this.audit.log('TEMPLATE_DELETED', 'RentalChecklistTemplate', id, { version: template.version, status: template.approvalStatus });
    return { message: 'Checklist template moved to recycle bin' };
  }

  async restoreTemplate(id: string) {
    const template = await this.prisma.rentalChecklistTemplate.findFirst({
      where: { id, tenantId: this.tenantContext.requireId },
    });
    if (!template || !template.deletedAt) {
      throw new NotFoundException('Deleted template not found');
    }

    // Round 25F D: a restored list is used again only after a new approval.
    const restored = await this.prisma.rentalChecklistTemplate.update({
      where: { id },
      data: { deletedAt: null, approvalStatus: 'DRAFT' },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.audit.log('TEMPLATE_RESTORED', 'RentalChecklistTemplate', id, { version: restored.version, status: 'DRAFT' });
    return this.withHash(restored);
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

    const toggled = await this.prisma.rentalChecklistTemplate.update({
      where: { id },
      data: { isActive: !template.isActive },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    // Switching a template on never approves it (round 25F D): only APPROVED versions are used.
    await this.audit.log(toggled.isActive ? 'TEMPLATE_SWITCHED_ON' : 'TEMPLATE_SWITCHED_OFF', 'RentalChecklistTemplate', id, {
      version: toggled.version, status: toggled.approvalStatus,
    });
    return this.withHash(toggled);
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
