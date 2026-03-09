import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Injectable()
export class RentalChecklistsService {
  constructor(private readonly prisma: PrismaService) {}

  async getTemplates() {
    return this.prisma.rentalChecklistTemplate.findMany({
      include: { items: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getTemplate(id: string) {
    const template = await this.prisma.rentalChecklistTemplate.findUnique({
      where: { id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!template) {
      throw new NotFoundException('Checklist template not found');
    }
    return template;
  }

  async createTemplate(dto: CreateTemplateDto) {
    return this.prisma.rentalChecklistTemplate.create({
      data: {
        name: dto.name,
        description: dto.description,
        isDefault: dto.isDefault ?? false,
        items: {
          create: dto.items.map((item, index) => ({
            label: item.label,
            labelSwahili: item.labelSwahili,
            itemType: item.itemType,
            sortOrder: item.sortOrder ?? index,
          })),
        },
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async updateTemplate(id: string, dto: UpdateTemplateDto) {
    const template = await this.prisma.rentalChecklistTemplate.findUnique({
      where: { id },
    });
    if (!template) {
      throw new NotFoundException('Checklist template not found');
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;

    if (dto.items !== undefined) {
      // Delete existing items and recreate
      await this.prisma.rentalChecklistTemplateItem.deleteMany({
        where: { templateId: id },
      });
      data.items = {
        create: dto.items.map((item, index) => ({
          label: item.label,
          labelSwahili: item.labelSwahili,
          itemType: item.itemType,
          sortOrder: item.sortOrder ?? index,
        })),
      };
    }

    return this.prisma.rentalChecklistTemplate.update({
      where: { id },
      data,
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async deleteTemplate(id: string) {
    const template = await this.prisma.rentalChecklistTemplate.findUnique({
      where: { id },
    });
    if (!template) {
      throw new NotFoundException('Checklist template not found');
    }

    await this.prisma.rentalChecklistTemplate.delete({ where: { id } });
    return { message: 'Checklist template deleted' };
  }

  async assignToRental(rentalOrderId: string, templateId: string) {
    const rental = await this.prisma.rentalOrder.findUnique({
      where: { id: rentalOrderId },
    });
    if (!rental) {
      throw new NotFoundException('Rental order not found');
    }

    const template = await this.prisma.rentalChecklistTemplate.findUnique({
      where: { id: templateId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!template) {
      throw new NotFoundException('Checklist template not found');
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
    const rental = await this.prisma.rentalOrder.findUnique({
      where: { id: rentalOrderId },
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
    const entry = await this.prisma.rentalChecklistEntry.findUnique({
      where: { id: entryId },
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
    const entry = await this.prisma.rentalChecklistEntry.findUnique({
      where: { id: entryId },
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
