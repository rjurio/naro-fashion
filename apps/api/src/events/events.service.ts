import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant.context';

export class CreateEventDto {
  @IsString() title: string;
  @IsOptional() @IsString() titleSwahili?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() descriptionSwahili?: string;
  @IsDateString() eventDate: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() customerName?: string;
  @IsOptional() @IsObject() socialLinks?: Record<string, string>;
  @IsOptional() @IsString() coverImageUrl?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
}

export class UpdateEventDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() titleSwahili?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() descriptionSwahili?: string;
  @IsOptional() @IsDateString() eventDate?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() customerName?: string;
  @IsOptional() @IsObject() socialLinks?: Record<string, string>;
  @IsOptional() @IsString() coverImageUrl?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsString() status?: string;
}

export class CustomerSubmitEventDto {
  @IsString() title: string;
  @IsOptional() @IsString() description?: string;
  @IsDateString() eventDate: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsObject() socialLinks?: Record<string, string>;
  @IsString() productId: string;
}

export class AddMediaDto {
  @IsString() url: string;
  @IsOptional() @IsString() thumbnailUrl?: string;
  @IsOptional() @IsString() mediaType?: string;
  @IsOptional() @IsString() altText?: string;
  @IsOptional() @IsInt() @Min(0) @Type(() => Number) sortOrder?: number;
}

export class ReorderMediaDto {
  @IsArray() @IsString({ each: true }) mediaIds: string[];
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  private generateSlug(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  private async ensureUniqueSlug(baseSlug: string): Promise<string> {
    let slug = baseSlug;
    let counter = 1;
    while (await this.prisma.customerEvent.findFirst({ where: { slug, tenantId: this.tenantContext.requireId } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    return slug;
  }

  // --- Public ---

  async findAllPublic(page = 1, limit = 9) {
    const skip = (page - 1) * limit;
    const tenantId = this.tenantContext.requireId;
    const [data, total] = await Promise.all([
      this.prisma.customerEvent.findMany({
        where: { tenantId, status: 'APPROVED', deletedAt: null },
        include: {
          media: { orderBy: { sortOrder: 'asc' }, take: 4 },
          product: { select: { id: true, name: true, slug: true } },
          user: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { eventDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.customerEvent.count({
        where: { tenantId, status: 'APPROVED', deletedAt: null },
      }),
    ]);
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findBySlug(slug: string) {
    const event = await this.prisma.customerEvent.findFirst({
      where: { slug, tenantId: this.tenantContext.requireId },
      include: {
        media: { orderBy: { sortOrder: 'asc' } },
        product: { select: { id: true, name: true, slug: true, images: { take: 1 } } },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!event || event.deletedAt || event.status !== 'APPROVED') {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  // --- Admin ---

  async findAllAdmin(params?: { status?: string; search?: string }) {
    const where: any = { tenantId: this.tenantContext.requireId, deletedAt: null };
    if (params?.status) where.status = params.status;
    if (params?.search) {
      where.OR = [
        { title: { contains: params.search, mode: 'insensitive' } },
        { customerName: { contains: params.search, mode: 'insensitive' } },
        { location: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.customerEvent.findMany({
      where,
      include: {
        media: { orderBy: { sortOrder: 'asc' }, take: 1 },
        product: { select: { id: true, name: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPending() {
    return this.prisma.customerEvent.findMany({
      where: { tenantId: this.tenantContext.requireId, status: 'PENDING_APPROVAL', deletedAt: null },
      include: {
        media: { orderBy: { sortOrder: 'asc' } },
        product: { select: { id: true, name: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findDeleted() {
    return this.prisma.customerEvent.findMany({
      where: { tenantId: this.tenantContext.requireId, deletedAt: { not: null } },
      include: {
        media: { orderBy: { sortOrder: 'asc' }, take: 1 },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async findOneAdmin(id: string) {
    const event = await this.prisma.customerEvent.findUnique({
      where: { id, tenantId: this.tenantContext.requireId },
      include: {
        media: { orderBy: { sortOrder: 'asc' } },
        product: { select: { id: true, name: true, slug: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async createByAdmin(dto: CreateEventDto, adminId: string) {
    const slug = await this.ensureUniqueSlug(this.generateSlug(dto.title));
    return this.prisma.customerEvent.create({
      data: {
        tenantId: this.tenantContext.requireId,
        title: dto.title,
        titleSwahili: dto.titleSwahili,
        slug,
        description: dto.description,
        descriptionSwahili: dto.descriptionSwahili,
        eventDate: new Date(dto.eventDate),
        location: dto.location,
        customerName: dto.customerName,
        socialLinks: dto.socialLinks || undefined,
        coverImageUrl: dto.coverImageUrl,
        productId: dto.productId || undefined,
        createdByAdminId: adminId,
        isFeatured: dto.isFeatured ?? false,
        status: 'APPROVED',
      },
      include: { media: true },
    });
  }

  async createByCustomer(dto: CustomerSubmitEventDto, userId: string) {
    const tenantId = this.tenantContext.requireId;
    // Check if customer already has an event
    const existing = await this.prisma.customerEvent.findFirst({
      where: { userId, tenantId, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('You have already submitted an event. Only one event per customer is allowed.');
    }

    // Verify product exists and user has ordered/rented it
    const product = await this.prisma.product.findUnique({ where: { id: dto.productId } });
    if (!product) throw new BadRequestException('Product not found');

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    const slug = await this.ensureUniqueSlug(this.generateSlug(dto.title));
    return this.prisma.customerEvent.create({
      data: {
        tenantId,
        title: dto.title,
        slug,
        description: dto.description,
        eventDate: new Date(dto.eventDate),
        location: dto.location,
        socialLinks: dto.socialLinks || undefined,
        coverImageUrl: undefined,
        userId,
        productId: dto.productId,
        customerName: user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : undefined,
        status: 'PENDING_APPROVAL',
      },
      include: { media: true },
    });
  }

  async update(id: string, dto: UpdateEventDto) {
    const event = await this.prisma.customerEvent.findUnique({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!event || event.deletedAt) throw new NotFoundException('Event not found');

    const data: any = { ...dto };
    if (dto.eventDate) data.eventDate = new Date(dto.eventDate);
    if (dto.socialLinks) data.socialLinks = dto.socialLinks;

    // If title changed, regenerate slug
    if (dto.title && dto.title !== event.title) {
      data.slug = await this.ensureUniqueSlug(this.generateSlug(dto.title));
    }

    return this.prisma.customerEvent.update({
      where: { id },
      data,
      include: { media: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  async approve(id: string, adminId: string) {
    const event = await this.prisma.customerEvent.findUnique({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!event || event.deletedAt) throw new NotFoundException('Event not found');
    return this.prisma.customerEvent.update({
      where: { id },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedById: adminId },
    });
  }

  async reject(id: string, reason: string) {
    const event = await this.prisma.customerEvent.findUnique({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!event || event.deletedAt) throw new NotFoundException('Event not found');
    return this.prisma.customerEvent.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: reason },
    });
  }

  async softDelete(id: string) {
    const event = await this.prisma.customerEvent.findUnique({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!event) throw new NotFoundException('Event not found');
    await this.prisma.customerEvent.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { message: 'Event moved to recycle bin' };
  }

  async restore(id: string) {
    const event = await this.prisma.customerEvent.findUnique({ where: { id, tenantId: this.tenantContext.requireId } });
    if (!event || !event.deletedAt) throw new NotFoundException('Deleted event not found');
    return this.prisma.customerEvent.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  // --- Media ---

  async addMedia(eventId: string, dto: AddMediaDto) {
    const event = await this.prisma.customerEvent.findUnique({ where: { id: eventId, tenantId: this.tenantContext.requireId } });
    if (!event || event.deletedAt) throw new NotFoundException('Event not found');

    const mediaCount = await this.prisma.eventMedia.count({ where: { eventId } });

    return this.prisma.eventMedia.create({
      data: {
        eventId,
        url: dto.url,
        thumbnailUrl: dto.thumbnailUrl,
        mediaType: dto.mediaType || 'IMAGE',
        altText: dto.altText,
        sortOrder: dto.sortOrder ?? mediaCount,
      },
    });
  }

  async removeMedia(eventId: string, mediaId: string) {
    // Verify the parent event belongs to the current tenant before mutating
    // child rows. Without this, any admin who knew an event id from another
    // tenant could delete its media via this route.
    const event = await this.prisma.customerEvent.findUnique({
      where: { id: eventId, tenantId: this.tenantContext.requireId },
    });
    if (!event) throw new NotFoundException('Event not found');

    const media = await this.prisma.eventMedia.findUnique({ where: { id: mediaId } });
    if (!media || media.eventId !== eventId) throw new NotFoundException('Media not found');
    await this.prisma.eventMedia.delete({ where: { id: mediaId } });
    return { message: 'Media removed' };
  }

  async reorderMedia(eventId: string, dto: ReorderMediaDto) {
    // Tenant check on the parent event (see removeMedia comment).
    const event = await this.prisma.customerEvent.findUnique({
      where: { id: eventId, tenantId: this.tenantContext.requireId },
    });
    if (!event) throw new NotFoundException('Event not found');

    // Ensure every mediaId in the payload actually belongs to this event so
    // a tenant admin can't reorder another event's media by id-stuffing.
    const existing = await this.prisma.eventMedia.findMany({
      where: { id: { in: dto.mediaIds }, eventId },
      select: { id: true },
    });
    if (existing.length !== dto.mediaIds.length) {
      throw new NotFoundException('One or more media items not found for this event');
    }

    const updates = dto.mediaIds.map((id, index) =>
      this.prisma.eventMedia.update({
        where: { id },
        data: { sortOrder: index },
      }),
    );
    await this.prisma.$transaction(updates);
    return { message: 'Media reordered' };
  }

  // --- Customer: get own event ---

  async findMyEvent(userId: string) {
    return this.prisma.customerEvent.findFirst({
      where: { userId, tenantId: this.tenantContext.requireId, deletedAt: null },
      include: {
        media: { orderBy: { sortOrder: 'asc' } },
        product: { select: { id: true, name: true, slug: true } },
      },
    });
  }
}
