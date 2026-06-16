import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { IsEmail, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../notifications/email.service';
import { TenantContext } from '../tenant/tenant.context';

export class SubscribeDto {
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  source?: string;
}

export class CreateNewsletterDto {
  @IsString()
  subject: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsOptional()
  @IsString()
  templateType?: string; // NEW_ARRIVALS, NEW_DEALS, TIPS, CUSTOM
}

export class UpdateNewsletterDto {
  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  bodyHtml?: string;

  @IsOptional()
  @IsString()
  templateType?: string;
}

@Injectable()
export class NewsletterService {
  private readonly logger = new Logger(NewsletterService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly tenantContext: TenantContext,
  ) {}

  // --- Subscribers ---

  async subscribe(dto: SubscribeDto) {
    const tenantId = this.tenantContext.requireId;
    const existing = await this.prisma.newsletterSubscriber.findFirst({
      where: { email: dto.email.toLowerCase().trim(), tenantId },
    });

    if (existing) {
      if (existing.isActive) {
        return { message: 'Already subscribed' };
      }
      // Reactivate
      await this.prisma.newsletterSubscriber.update({
        where: { id: existing.id },
        data: { isActive: true, unsubscribedAt: null, subscribedAt: new Date() },
      });
      return { message: 'Successfully resubscribed' };
    }

    await this.prisma.newsletterSubscriber.create({
      data: {
        tenantId,
        email: dto.email.toLowerCase().trim(),
        name: dto.name || null,
        source: dto.source || 'STOREFRONT',
      },
    });
    return { message: 'Successfully subscribed' };
  }

  // Unsubscribe is intentionally NOT tenant-scoped: the unsubscribeToken is
  // globally unique (NewsletterSubscriber.unsubscribeToken @unique) and serves
  // as the auth itself. The email link a recipient clicks won't carry a
  // tenant cookie, so requiring TenantContext here would break unsubscribe.
  async unsubscribe(token: string) {
    const subscriber = await this.prisma.newsletterSubscriber.findFirst({
      where: { unsubscribeToken: token },
    });
    if (!subscriber) throw new NotFoundException('Invalid unsubscribe link');

    if (!subscriber.isActive) {
      return { message: 'Already unsubscribed' };
    }

    await this.prisma.newsletterSubscriber.update({
      where: { id: subscriber.id },
      data: { isActive: false, unsubscribedAt: new Date() },
    });
    return { message: 'Successfully unsubscribed' };
  }

  async getSubscribers(page = 1, limit = 20, search?: string) {
    const tenantId = this.tenantContext.requireId;
    const skip = (page - 1) * limit;
    const where: any = { tenantId };
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.newsletterSubscriber.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.newsletterSubscriber.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getSubscriberStats() {
    const tenantId = this.tenantContext.requireId;
    const [total, active, unsubscribed] = await Promise.all([
      this.prisma.newsletterSubscriber.count({ where: { tenantId } }),
      this.prisma.newsletterSubscriber.count({ where: { tenantId, isActive: true } }),
      this.prisma.newsletterSubscriber.count({ where: { tenantId, isActive: false } }),
    ]);
    return { total, active, unsubscribed };
  }

  // --- Newsletters ---

  async createNewsletter(dto: CreateNewsletterDto, adminId?: string) {
    const tenantId = this.tenantContext.requireId;
    return this.prisma.newsletter.create({
      data: {
        tenantId,
        subject: dto.subject,
        bodyHtml: dto.bodyHtml || '',
        templateType: dto.templateType || 'CUSTOM',
        createdById: adminId || null,
      },
    });
  }

  async getNewsletters(page = 1, limit = 20) {
    const tenantId = this.tenantContext.requireId;
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.newsletter.findMany({
        where: { tenantId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { deliveries: true, products: true } },
        },
      }),
      this.prisma.newsletter.count({ where: { tenantId } }),
    ]);

    // Enrich with delivery stats
    const enriched = await Promise.all(
      data.map(async (nl) => {
        if (nl.status === 'DRAFT') return { ...nl, deliveryStats: null };
        const stats = await this.getDeliveryStats(nl.id);
        return { ...nl, deliveryStats: stats };
      }),
    );

    return { data: enriched, total, page, limit };
  }

  async getNewsletter(id: string) {
    const tenantId = this.tenantContext.requireId;
    const newsletter = await this.prisma.newsletter.findFirst({
      where: { id, tenantId },
      include: {
        _count: { select: { deliveries: true, products: true } },
        products: true,
      },
    });
    if (!newsletter) throw new NotFoundException('Newsletter not found');

    const deliveryStats = newsletter.status !== 'DRAFT'
      ? await this.getDeliveryStats(id)
      : null;

    return { ...newsletter, deliveryStats };
  }

  async updateNewsletter(id: string, dto: UpdateNewsletterDto) {
    const tenantId = this.tenantContext.requireId;
    const newsletter = await this.prisma.newsletter.findFirst({
      where: { id, tenantId },
    });
    if (!newsletter) throw new NotFoundException('Newsletter not found');
    if (newsletter.status !== 'DRAFT') {
      throw new BadRequestException('Only draft newsletters can be edited');
    }
    return this.prisma.newsletter.update({ where: { id }, data: dto });
  }

  async deleteNewsletter(id: string) {
    const tenantId = this.tenantContext.requireId;
    const newsletter = await this.prisma.newsletter.findFirst({
      where: { id, tenantId },
    });
    if (!newsletter) throw new NotFoundException('Newsletter not found');
    if (newsletter.status !== 'DRAFT') {
      throw new BadRequestException('Only draft newsletters can be deleted');
    }
    await this.prisma.newsletter.delete({ where: { id } });
    return { message: 'Newsletter deleted' };
  }

  // --- Sending ---

  async sendNewsletter(id: string) {
    const tenantId = this.tenantContext.requireId;
    const newsletter = await this.prisma.newsletter.findFirst({
      where: { id, tenantId },
    });
    if (!newsletter) throw new NotFoundException('Newsletter not found');
    if (newsletter.status !== 'DRAFT') {
      throw new BadRequestException('Newsletter has already been sent or is sending');
    }

    // Set status to SENDING
    await this.prisma.newsletter.update({
      where: { id },
      data: { status: 'SENDING' },
    });

    // Only this tenant's active subscribers
    const subscribers = await this.prisma.newsletterSubscriber.findMany({
      where: { tenantId, isActive: true },
    });

    if (subscribers.length === 0) {
      await this.prisma.newsletter.update({
        where: { id },
        data: { status: 'SENT', sentAt: new Date() },
      });
      return { message: 'No active subscribers to send to', total: 0 };
    }

    // Create delivery records
    await this.prisma.newsletterDelivery.createMany({
      data: subscribers.map((sub) => ({
        newsletterId: id,
        subscriberId: sub.id,
        status: 'PENDING',
      })),
      skipDuplicates: true,
    });

    // Fire async delivery processing
    this.processDeliveries(id, newsletter).catch((err) =>
      this.logger.error(`[NEWSLETTER] processDeliveries failed: ${err}`),
    );

    return { message: 'Newsletter sending started', total: subscribers.length };
  }

  // processDeliveries operates by newsletterId; the parent newsletter is
  // already tenant-scoped at the entry points (sendNewsletter / resendFailed),
  // so deliveries created here cannot cross tenants.
  private async processDeliveries(newsletterId: string, newsletter: any) {
    const deliveries = await this.prisma.newsletterDelivery.findMany({
      where: { newsletterId, status: 'PENDING' },
      include: { subscriber: true },
    });

    let sent = 0;
    let failed = 0;
    const templateName = newsletter.templateType === 'NEW_ARRIVALS'
      ? 'newsletter-new-arrivals'
      : 'newsletter';

    for (const delivery of deliveries) {
      try {
        const result = await this.emailService.send({
          to: delivery.subscriber.email,
          subject: newsletter.subject,
          template: templateName,
          context: {
            bodyHtml: newsletter.bodyHtml,
            unsubscribeToken: delivery.subscriber.unsubscribeToken,
            subscriberName: delivery.subscriber.name || '',
          },
        });

        await this.prisma.newsletterDelivery.update({
          where: { id: delivery.id },
          data: {
            status: result.sent ? 'SENT' : 'FAILED',
            sentAt: result.sent ? new Date() : null,
            failureReason: result.sent ? null : (result.error || 'Email not sent'),
          },
        });

        if (result.sent) sent++;
        else failed++;
      } catch (err) {
        await this.prisma.newsletterDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'FAILED',
            failureReason: err instanceof Error ? err.message : String(err),
          },
        });
        failed++;
      }

      // Rate limit: 200ms between emails
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Update newsletter status
    const finalStatus = sent > 0 ? 'SENT' : (failed > 0 ? 'FAILED' : 'SENT');
    await this.prisma.newsletter.update({
      where: { id: newsletterId },
      data: { status: finalStatus, sentAt: new Date() },
    });

    this.logger.log(`[NEWSLETTER] "${newsletter.subject}" completed: ${sent} sent, ${failed} failed`);
  }

  // --- Delivery Tracking ---

  async getDeliveryStats(newsletterId: string) {
    // Verify the newsletter belongs to the current tenant before exposing
    // delivery counts. Without this, any admin could pass any newsletterId
    // and read the SENT/FAILED breakdown for another tenant's campaign.
    const tenantId = this.tenantContext.requireId;
    const owned = await this.prisma.newsletter.findFirst({
      where: { id: newsletterId, tenantId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Newsletter not found');

    const [total, sent, failed, pending] = await Promise.all([
      this.prisma.newsletterDelivery.count({ where: { newsletterId } }),
      this.prisma.newsletterDelivery.count({ where: { newsletterId, status: 'SENT' } }),
      this.prisma.newsletterDelivery.count({ where: { newsletterId, status: 'FAILED' } }),
      this.prisma.newsletterDelivery.count({ where: { newsletterId, status: 'PENDING' } }),
    ]);
    return { total, sent, failed, pending };
  }

  async getFailedDeliveries(newsletterId: string) {
    const tenantId = this.tenantContext.requireId;
    const owned = await this.prisma.newsletter.findFirst({
      where: { id: newsletterId, tenantId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Newsletter not found');

    return this.prisma.newsletterDelivery.findMany({
      where: { newsletterId, status: 'FAILED' },
      include: { subscriber: { select: { email: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async resendFailed(newsletterId: string) {
    const tenantId = this.tenantContext.requireId;
    const newsletter = await this.prisma.newsletter.findFirst({
      where: { id: newsletterId, tenantId },
    });
    if (!newsletter) throw new NotFoundException('Newsletter not found');

    // Reset failed deliveries to PENDING
    const { count } = await this.prisma.newsletterDelivery.updateMany({
      where: { newsletterId, status: 'FAILED' },
      data: { status: 'PENDING', failureReason: null },
    });

    if (count === 0) {
      return { message: 'No failed deliveries to resend', total: 0 };
    }

    // Update newsletter status
    await this.prisma.newsletter.update({
      where: { id: newsletterId },
      data: { status: 'SENDING' },
    });

    // Fire async
    this.processDeliveries(newsletterId, newsletter).catch((err) =>
      this.logger.error(`[NEWSLETTER] resend failed: ${err}`),
    );

    return { message: 'Resending failed emails', total: count };
  }

  // --- Dashboard ---

  async getDashboardStats() {
    const tenantId = this.tenantContext.requireId;
    const subscriberStats = await this.getSubscriberStats();
    const [totalNewsletters, draftCount, sentCount] = await Promise.all([
      this.prisma.newsletter.count({ where: { tenantId } }),
      this.prisma.newsletter.count({ where: { tenantId, status: 'DRAFT' } }),
      this.prisma.newsletter.count({ where: { tenantId, status: 'SENT' } }),
    ]);

    // Delivery counts must filter via the parent newsletter's tenantId.
    // NewsletterDelivery has no tenantId column itself (it's a child of Newsletter).
    const deliveryWhere = { newsletter: { tenantId } } as const;
    const [totalDeliveries, deliveredCount, failedCount] = await Promise.all([
      this.prisma.newsletterDelivery.count({ where: deliveryWhere }),
      this.prisma.newsletterDelivery.count({ where: { ...deliveryWhere, status: 'SENT' } }),
      this.prisma.newsletterDelivery.count({ where: { ...deliveryWhere, status: 'FAILED' } }),
    ]);

    return {
      subscribers: subscriberStats,
      newsletters: { total: totalNewsletters, draft: draftCount, sent: sentCount },
      deliveries: {
        total: totalDeliveries,
        delivered: deliveredCount,
        failed: failedCount,
        deliveryRate: totalDeliveries > 0
          ? Math.round((deliveredCount / totalDeliveries) * 100)
          : 0,
      },
    };
  }

  // --- New Arrivals Product Preview ---

  async getNewArrivalsProducts() {
    const tenantId = this.tenantContext.requireId;
    // Find this tenant's last sent NEW_ARRIVALS newsletter
    const lastNewArrivals = await this.prisma.newsletter.findFirst({
      where: { tenantId, templateType: 'NEW_ARRIVALS', status: 'SENT' },
      orderBy: { sentAt: 'desc' },
    });

    // Get product IDs already included in any of THIS tenant's newsletters.
    // NewsletterProduct has no tenantId; scope via parent newsletter relation.
    const usedProductIds = await this.prisma.newsletterProduct.findMany({
      where: { newsletter: { tenantId } },
      select: { productId: true },
    });
    const usedIds = usedProductIds.map((p) => p.productId);

    // Find new products since last newsletter (this tenant only)
    const where: any = {
      tenantId,
      isActive: true,
      deletedAt: null,
    };
    if (usedIds.length > 0) {
      where.id = { notIn: usedIds };
    }
    if (lastNewArrivals?.sentAt) {
      where.createdAt = { gt: lastNewArrivals.sentAt };
    }

    const products = await this.prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        images: { where: { isPrimary: true }, take: 1 },
      },
    });

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      basePrice: p.basePrice,
      imageUrl: p.images[0]?.url || null,
    }));
  }

  /**
   * Link products to a newsletter (for tracking which products were included).
   * Tenant scope is enforced at the parent via createNewsletter / getNewsletter
   * before this is ever called.
   */
  async linkProducts(newsletterId: string, productIds: string[]) {
    if (productIds.length === 0) return;
    await this.prisma.newsletterProduct.createMany({
      data: productIds.map((productId) => ({ newsletterId, productId })),
      skipDuplicates: true,
    });
  }
}
