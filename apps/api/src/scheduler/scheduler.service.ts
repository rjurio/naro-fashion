import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InstagramService } from '../cms/instagram.service';
import {
  UNPAID_HOLD_STATUSES,
} from '../rentals/rental-rules';
import {
  adoptLegacyHold,
  holdExpiryMessage,
  holdExpiryReason,
  HoldExpiryReason,
  INFLIGHT_PAYMENT_GRACE_HOURS,
  pickupCutoff,
  rentalHoldTtlHours,
} from '../rentals/rental-hold';
import { customerIdState, lockCustomerIdState } from '../id-verification/id-approval';

/** Mapping from admin-friendly interval keys to cron expressions */
export const INSTAGRAM_SYNC_INTERVALS: Record<string, string> = {
  OFF: '',
  EVERY_HOUR: '0 * * * *',
  EVERY_3_HOURS: '0 */3 * * *',
  EVERY_6_HOURS: '0 */6 * * *',
  EVERY_12_HOURS: '0 */12 * * *',
  DAILY: '0 0 * * *',
  WEEKLY: '0 0 * * 0',
};

const IG_SYNC_JOB_NAME = 'instagram-sync-dynamic';

/**
 * Abandoned-cart emails (tenant-branded `abandoned-cart` template via
 * NotificationsService.sendAbandonedCartReminder). Opt-in: set env
 * ABANDONED_CART_EMAIL_ENABLED=true. Read at call time so a .env change +
 * restart is all that's needed.
 */
const isAbandonedCartEmailEnabled = () => process.env.ABANDONED_CART_EMAIL_ENABLED === 'true';

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly configService: ConfigService,
    private readonly instagramService: InstagramService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  async onModuleInit() {
    await this.initInstagramSyncCron();
  }

  /** Read the configured interval from SiteSetting and register the dynamic cron job */
  async initInstagramSyncCron() {
    const setting = await this.prisma.siteSetting.findFirst({
      where: { key: 'instagram_sync_interval' },
    });
    const interval = setting?.value || 'EVERY_6_HOURS';
    this.registerInstagramSyncCron(interval);
  }

  /** Register (or re-register) the Instagram sync cron job with the given interval key */
  registerInstagramSyncCron(interval: string) {
    // Remove existing job if present
    try {
      this.schedulerRegistry.deleteCronJob(IG_SYNC_JOB_NAME);
    } catch {
      // Job didn't exist yet — that's fine
    }

    const cronExpr = INSTAGRAM_SYNC_INTERVALS[interval];
    if (!cronExpr) {
      this.logger.log(`Instagram auto-sync is OFF`);
      return;
    }

    const job = new CronJob(cronExpr, () => this.handleInstagramSync());
    this.schedulerRegistry.addCronJob(IG_SYNC_JOB_NAME, job);
    job.start();
    this.logger.log(`Instagram auto-sync registered: ${interval} (${cronExpr})`);
  }

  /**
   * Admin notification contact for a tenant: the tenant's own active
   * SUPER_ADMIN first; the global ADMIN_NOTIFICATION_EMAIL/PHONE env override
   * is ONLY a fallback for a tenant with no admin contact (or a row with no
   * tenant). Previously the env value won unconditionally, so on a
   * multi-tenant platform every tenant's rental/customer details were emailed
   * to one operator address.
   */
  async getAdminContact(tenantId?: string | null): Promise<{ email: string; phone: string }> {
    const envEmail = this.configService.get<string>('ADMIN_NOTIFICATION_EMAIL', '') ?? '';
    const envPhone = this.configService.get<string>('ADMIN_NOTIFICATION_PHONE', '') ?? '';

    if (tenantId) {
      const superAdmin = await this.prisma.adminUser.findFirst({
        where: { role: 'SUPER_ADMIN', tenantId, isActive: true, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { email: true, phone: true },
      });
      if (superAdmin?.email) {
        return { email: superAdmin.email, phone: superAdmin.phone || envPhone };
      }
    }

    return { email: envEmail, phone: envPhone };
  }

  /** tenantId → RentalPolicy (each tenant's own policy, never a global first row). */
  private async loadRentalPolicies() {
    const policies = await this.prisma.rentalPolicy.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    const byTenant = new Map<string, (typeof policies)[number]>();
    for (const p of policies) {
      const key = p.tenantId ?? '__none__';
      if (!byTenant.has(key)) byTenant.set(key, p); // newest wins
    }
    return byTenant;
  }

  /**
   * Every day at 8:00 AM — check for upcoming rental pickups
   * and send daily admin preparation reminders until item is marked ready.
   */
  @Cron('0 8 * * *', { name: 'rental-prep-reminder' })
  async handlePreparationReminders() {
    this.logger.log('Running daily rental preparation reminder check...');

    try {
      // Reminder window is PER TENANT (RentalPolicy.advancePreparationReminderDays,
      // default 8). The old unscoped findFirst() applied one arbitrary tenant's
      // policy to every tenant. Query with the widest window, then filter each
      // rental by its own tenant's window.
      const policies = await this.loadRentalPolicies();
      const reminderDaysFor = (tid: string | null) =>
        policies.get(tid ?? '__none__')?.advancePreparationReminderDays ?? 8;
      const maxReminderDays = Math.max(
        8,
        ...[...policies.values()].map((p) => p.advancePreparationReminderDays ?? 8),
      );

      const now = new Date();
      const cutoffDate = new Date(now.getTime() + maxReminderDays * 24 * 60 * 60 * 1000);

      // Find all rentals needing preparation that admin hasn't marked as ready.
      // Lower bound `gte: now` is REQUIRED — without it, an overdue-but-unready
      // rental matches every day forever, daysUntilPickup goes negative, and a
      // fresh reminder row + email is generated daily with no dedup.
      const candidateRentals = await this.prisma.rentalOrder.findMany({
        where: {
          pickupDate: { gte: now, lte: cutoffDate },
          isReadyForPickup: false,
          status: { in: ['DOWN_PAYMENT_PAID', 'FULLY_PAID', 'READY_FOR_PICKUP'] },
        },
        include: {
          user: { select: { firstName: true, lastName: true, email: true, phone: true } },
          product: { select: { name: true } },
          variant: { select: { name: true, size: true, color: true } },
        },
      });

      const upcomingRentals = candidateRentals.filter(
        (r) =>
          r.pickupDate.getTime() <=
          now.getTime() + reminderDaysFor(r.tenantId) * 24 * 60 * 60 * 1000,
      );

      // Resolve the admin recipient per tenant (cached) so cross-tenant rentals
      // don't all notify one global admin.
      const contactCache = new Map<string, { email: string; phone: string }>();
      const contactFor = async (tid: string | null) => {
        const key = tid ?? '__none__';
        if (!contactCache.has(key)) contactCache.set(key, await this.getAdminContact(tid));
        return contactCache.get(key)!;
      };

      for (const rental of upcomingRentals) {
        const adminContact = await contactFor(rental.tenantId);
        const daysUntilPickup = Math.ceil(
          (rental.pickupDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );

        // Create reminder record
        await this.prisma.rentalPreparationReminder.create({
          data: {
            rentalOrderId: rental.id,
            daysUntilPickup,
            sentVia: 'IN_APP',
          },
        });

        const urgency =
          daysUntilPickup <= 1 ? 'URGENT' : daysUntilPickup <= 3 ? 'HIGH' : 'NORMAL';

        this.logger.warn(
          `[${urgency}] Preparation reminder: Rental #${rental.rentalNumber} - ` +
            `${rental.product.name} (${rental.variant?.size}/${rental.variant?.color}) ` +
            `for ${rental.user.firstName} ${rental.user.lastName} - ` +
            `Pickup in ${daysUntilPickup} day(s) on ${rental.pickupDate.toISOString().split('T')[0]}. ` +
            `Item NOT yet marked as ready.`,
        );

        const customerName = `${rental.user.firstName} ${rental.user.lastName}`;

        // Send admin preparation reminder via email/SMS
        this.notifications
          .sendAdminPrepReminder(rental.id, rental.pickupDate, customerName, {
            rentalNumber: rental.rentalNumber,
            productName: `${rental.product.name}${rental.variant ? ` (${rental.variant.size}/${rental.variant.color})` : ''}`,
            daysUntilPickup,
            adminEmail: adminContact.email,
            tenantId: rental.tenantId,
          })
          .catch((err) =>
            this.logger.error(`Admin prep reminder notification failed: ${err?.message}`),
          );

        // Also send rental reminder to the customer (email + SMS)
        if (rental.user.email) {
          this.notifications
            .sendRentalReminder(rental.id, rental.user.email, rental.pickupDate, {
              customerName,
              customerPhone: rental.user.phone || undefined,
              rentalNumber: rental.rentalNumber,
              productName: rental.product.name,
              tenantId: rental.tenantId ?? undefined,
            })
            .catch((err) =>
              this.logger.error(`Customer rental reminder failed: ${err?.message}`),
            );
        }
      }

      this.logger.log(`Sent ${upcomingRentals.length} preparation reminders.`);
    } catch (error) {
      this.logger.error('Error in rental prep reminder cron:', error);
    }
  }

  /**
   * Every day at 9:00 AM — check for overdue rentals
   * (return date has passed but status is still ACTIVE).
   */
  @Cron('0 9 * * *', { name: 'overdue-rental-check' })
  async handleOverdueRentals() {
    this.logger.log('Running overdue rental check...');

    try {
      const now = new Date();

      const overdueRentals = await this.prisma.rentalOrder.findMany({
        where: {
          returnDate: { lt: now },
          status: 'ACTIVE',
        },
        include: {
          user: { select: { firstName: true, lastName: true, email: true, phone: true } },
          product: { select: { name: true } },
        },
      });

      this.logger.log(`Found ${overdueRentals.length} overdue rentals`);

      // Per-tenant admin recipient (cached) — see handlePreparationReminders.
      const contactCache = new Map<string, { email: string; phone: string }>();
      const contactFor = async (tid: string | null) => {
        const key = tid ?? '__none__';
        if (!contactCache.has(key)) contactCache.set(key, await this.getAdminContact(tid));
        return contactCache.get(key)!;
      };

      for (const rental of overdueRentals) {
        const adminContact = await contactFor(rental.tenantId);
        const customerName = `${rental.user.firstName} ${rental.user.lastName}`;

        this.logger.warn(
          `[OVERDUE] Rental #${rental.rentalNumber} - ${rental.product.name} ` +
            `by ${customerName} (${rental.user.phone || rental.user.email}) - ` +
            `overdue since ${rental.returnDate.toISOString().split('T')[0]}`,
        );

        this.notifications
          .sendOverdueRentalAlert(rental.id, customerName, rental.returnDate, {
            rentalNumber: rental.rentalNumber,
            customerPhone: rental.user.phone || undefined,
            customerEmail: rental.user.email || undefined,
            productName: rental.product.name,
            adminEmail: adminContact.email,
            adminPhone: adminContact.phone,
            tenantId: rental.tenantId,
          })
          .catch((err) =>
            this.logger.error(`Overdue rental notification failed: ${err?.message}`),
          );
      }
    } catch (error) {
      this.logger.error('Error in overdue rental check cron:', error);
    }
  }

  /**
   * Every day at 8:30 AM — remind admin of pending returns due within 3 days.
   */
  @Cron('0 30 8 * * *', { name: 'pending-return-reminder' })
  async handlePendingReturnReminders() {
    this.logger.log('Running pending return reminder check...');

    try {
      const now = new Date();
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(now.getDate() + 3);

      const pendingReturns = await this.prisma.rentalOrder.findMany({
        where: {
          returnDate: { gte: now, lte: threeDaysFromNow },
          status: { in: ['ACTIVE', 'ITEM_DISPATCHED'] },
        },
        include: {
          user: { select: { firstName: true, lastName: true, email: true, phone: true } },
          product: { select: { name: true } },
          variant: { select: { name: true, size: true, color: true } },
        },
      });

      for (const rental of pendingReturns) {
        const daysUntilReturn = Math.ceil(
          (rental.returnDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        const customerName = `${rental.user.firstName} ${rental.user.lastName}`;

        const urgency = daysUntilReturn <= 1 ? 'URGENT' : 'REMINDER';

        this.logger.warn(
          `[${urgency}] Pending return: Rental #${rental.rentalNumber} - ${rental.product.name} ` +
            `(${rental.variant?.size}/${rental.variant?.color}) ` +
            `by ${customerName} (${rental.user.phone || rental.user.email}) - ` +
            `Return due in ${daysUntilReturn} day(s) on ${rental.returnDate.toISOString().split('T')[0]}`,
        );

        // Send reminder to customer about upcoming return
        if (rental.user.email) {
          this.notifications
            .sendRentalReminder(rental.id, rental.user.email, rental.returnDate, {
              customerName,
              customerPhone: rental.user.phone || undefined,
              rentalNumber: rental.rentalNumber,
              productName: rental.product.name,
              tenantId: rental.tenantId ?? undefined,
            })
            .catch((err) =>
              this.logger.error(`Pending return reminder failed: ${err?.message}`),
            );
        }
      }

      this.logger.log(`Found ${pendingReturns.length} pending return reminders.`);
    } catch (error) {
      this.logger.error('Error in pending return reminder cron:', error);
    }
  }

  /**
   * Every hour — check for abandoned carts (items added but no checkout).
   * Sends reminders at 1hr, 24hr, and 72hr intervals.
   */
  @Cron('0 * * * *', { name: 'abandoned-cart-recovery' })
  async handleAbandonedCartRecovery() {
    // History (2026-10 review): this cron used to call
    // notifications.sendOrderConfirmation(`abandoned-cart-<userId>`, email) —
    // i.e. it emailed customers an ORDER CONFIRMATION for a fake order id —
    // and wrote AbandonedCartReminder rows with no tenantId. It now uses the
    // dedicated tenant-branded abandoned-cart template, and is opt-in.
    if (!isAbandonedCartEmailEnabled()) {
      this.logger.debug('Abandoned cart recovery disabled (set ABANDONED_CART_EMAIL_ENABLED=true to enable).');
      return;
    }
    this.logger.log('Running abandoned cart recovery check...');

    try {
      const now = new Date();

      // Define reminder windows: [minAge, maxAge, sequence]
      const windows = [
        { minHours: 1, maxHours: 2, sequence: 1 },    // 1 hour after
        { minHours: 24, maxHours: 25, sequence: 2 },   // 24 hours after
        { minHours: 72, maxHours: 73, sequence: 3 },   // 72 hours after
      ];

      for (const window of windows) {
        const minDate = new Date(now.getTime() - window.maxHours * 60 * 60 * 1000);
        const maxDate = new Date(now.getTime() - window.minHours * 60 * 60 * 1000);

        // Find users with cart items in this time window who haven't ordered
        const usersWithCarts = await this.prisma.cartItem.groupBy({
          by: ['userId'],
          where: {
            updatedAt: { gte: minDate, lte: maxDate },
            userId: { not: undefined },
          },
          _count: { _all: true },
        });

        for (const cartGroup of usersWithCarts) {
          if (!cartGroup.userId) continue;

          const itemCount = cartGroup._count?._all ?? 0;

          // Check if we already sent this sequence reminder
          const alreadySent = await this.prisma.abandonedCartReminder.findFirst({
            where: {
              userId: cartGroup.userId,
              sequence: window.sequence,
              sentAt: { gte: minDate },
            },
          });
          if (alreadySent) continue;

          // Check if user completed an order recently
          const recentOrder = await this.prisma.order.findFirst({
            where: {
              userId: cartGroup.userId,
              createdAt: { gte: minDate },
            },
          });
          if (recentOrder) continue;

          // Get user info
          const user = await this.prisma.user.findUnique({
            where: { id: cartGroup.userId },
            select: { email: true, firstName: true, phone: true, tenantId: true },
          });
          if (!user?.email || !user.tenantId) continue;

          // Cart contents for the email (same tenant as the user).
          const cartItems = await this.prisma.cartItem.findMany({
            where: { userId: cartGroup.userId, product: { tenantId: user.tenantId, deletedAt: null } },
            select: {
              quantity: true,
              variant: { select: { price: true } },
              product: {
                select: {
                  name: true,
                  basePrice: true,
                  images: { select: { url: true }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }], take: 1 },
                },
              },
            },
            take: 20,
          });
          if (cartItems.length === 0) continue;

          // Record the reminder — tenant-scoped like every other row.
          await this.prisma.abandonedCartReminder.create({
            data: {
              tenantId: user.tenantId,
              userId: cartGroup.userId,
              itemCount,
              sequence: window.sequence,
              channel: 'EMAIL',
            },
          });

          this.logger.log(
            `[ABANDONED CART] Sequence ${window.sequence} reminder for user ${cartGroup.userId} (${itemCount} items)`,
          );

          // Tenant storefront: custom domain when set, else the first
          // STOREFRONT_URL origin. NEVER reuse sendOrderConfirmation here.
          const tenant = await this.prisma.tenant.findUnique({
            where: { id: user.tenantId },
            select: { domain: true },
          });
          const storefront = tenant?.domain
            ? `https://${tenant.domain}`
            : (process.env.STOREFRONT_URL || 'http://localhost:3000').split(',')[0].trim();
          await this.notifications
            .sendAbandonedCartReminder({
              tenantId: user.tenantId,
              to: user.email,
              customerName: user.firstName || undefined,
              cartUrl: `${storefront.replace(/\/+$/, '')}/cart`,
              items: cartItems.map((ci) => ({
                name: ci.product.name,
                quantity: ci.quantity,
                price: (ci.variant?.price ?? ci.product.basePrice)?.toString() ?? null,
                imageUrl: ci.product.images[0]?.url ?? null,
              })),
            })
            .catch((err) => this.logger.error(`[ABANDONED CART] Email failed: ${err?.message}`));
        }
      }
    } catch (error) {
      this.logger.error('Error in abandoned cart recovery cron:', error);
    }
  }

  // ============================================================
  // RENTAL HOLD EXPIRY
  // ============================================================

  /**
   * Every 30 minutes — release unconfirmed rental bookings whose hold has
   * expired (owner rules 2026-11-12, rentals/rental-hold.ts):
   *  - the booking's explicit deadline (`holdExpiresAt`) has passed: no ID
   *    submitted within 48 h of booking, no new ID within 48 h of a
   *    rejection, or no down payment within 48 h of the ID approval. While
   *    an ID waits for staff review the deadline is null (paused); a 0 %
   *    down-payment booking has none either;
   *  - or its pickup day (EAT) has ended before it was confirmed — this
   *    bounds paused and 0 % bookings too.
   *
   * Never cancelled here: a booking with any COMPLETED payment (money
   * received: staff decide), and a booking with an in-flight PENDING /
   * PROCESSING payment younger than INFLIGHT_PAYMENT_GRACE_HOURS (a Mobile
   * Money payment started before the deadline is not cancelled under the
   * customer; the next run decides once it resolves).
   *
   * Race-safe and idempotent: each booking is re-read and cancelled inside a
   * transaction holding the SAME advisory locks as booking/rescheduling
   * (per product), ID submission/review (per customer) and payment
   * initiation (per rental), and the update is a CAS on the observed state
   * plus "no COMPLETED payment". A second run, or one racing an approval,
   * payment or reschedule, changes nothing.
   *
   * Bookings created before these rules (holdState NULL) are first
   * classified ("adopted") from the customer's documents; their deadline is
   * never earlier than the old rule's (created + 48 h).
   *
   * Lives here (not in RentalsService) because RentalsService depends on the
   * request-scoped TenantContext, and @Cron can't run on request-scoped
   * providers. Cross-tenant by design (cron).
   */
  @Cron('0 */30 * * * *', { name: 'rental-hold-expiry' })
  async handleExpiredRentalHolds(now: Date = new Date()): Promise<number> {
    try {
      const ttlHours = rentalHoldTtlHours(this.configService.get<string>('RENTAL_HOLD_TTL_HOURS'));
      await this.adoptLegacyHolds(now, ttlHours);

      const cutoff = pickupCutoff(now);
      const candidates = await this.prisma.rentalOrder.findMany({
        where: {
          status: { in: UNPAID_HOLD_STATUSES },
          payments: { none: { status: 'COMPLETED' } },
          OR: [{ holdExpiresAt: { lte: now } }, { pickupDate: { lt: cutoff } }],
        },
        select: {
          id: true,
          tenantId: true,
          userId: true,
          productId: true,
          rentalNumber: true,
          user: { select: { email: true, firstName: true } },
          product: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 500,
      });

      let cancelled = 0;
      for (const r of candidates) {
        // One booking's failure (lock timeout, DB blip) must not stop the run;
        // it is retried on the next one.
        let outcome: Awaited<ReturnType<SchedulerService['expireRentalHold']>>;
        try {
          outcome = await this.expireRentalHold(r, now);
        } catch (err: any) {
          this.logger.error(`[RENTAL_HOLD] ${r.rentalNumber} not processed: ${err?.message}`);
          continue;
        }
        if (outcome.kind === 'skipped') {
          this.logger.log(`[RENTAL_HOLD] ${r.rentalNumber} expired but kept: ${outcome.why}`);
          continue;
        }
        if (outcome.kind !== 'cancelled') continue;
        cancelled++;
        this.logger.warn(
          `[RENTAL_HOLD] ${r.rentalNumber} auto-cancelled (${outcome.reason}; holdState ${outcome.holdState ?? '-'}; deadline ${outcome.holdExpiresAt?.toISOString() ?? 'none'})`,
        );
        if (r.user?.email) {
          try {
            await this.notifications.sendRentalHoldExpired({
              customerEmail: r.user.email,
              customerName: r.user.firstName ?? undefined,
              rentalNumber: r.rentalNumber,
              productName: r.product?.name,
              message: outcome.message,
              tenantId: r.tenantId,
            });
          } catch (err: any) {
            this.logger.error(`[RENTAL_HOLD] notification failed for ${r.rentalNumber}: ${err?.message}`);
          }
        }
      }
      if (cancelled > 0) this.logger.log(`Rental hold expiry: ${cancelled} cancelled.`);
      return cancelled;
    } catch (error) {
      this.logger.error('Error in rental hold expiry cron:', error);
      return 0;
    }
  }

  /** Re-check and cancel ONE expired booking under the shared locks. */
  private async expireRentalHold(
    r: { id: string; tenantId: string | null; userId: string; productId: string },
    now: Date,
  ): Promise<
    | { kind: 'cancelled'; reason: HoldExpiryReason; holdState: string | null; holdExpiresAt: Date | null; message: string }
    | { kind: 'skipped'; why: string }
    | { kind: 'none' }
  > {
    return this.prisma.$transaction(async (tx) => {
      // Same lock order as RentalsService.create(): product, then customer.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${r.productId}))`;
      if (r.tenantId) await lockCustomerIdState(tx, r.tenantId, r.userId);
      const paymentLock = `payment:rental:${r.id}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${paymentLock}))`;

      const cur = await tx.rentalOrder.findFirst({
        where: { id: r.id, tenantId: r.tenantId },
        select: { status: true, holdState: true, holdExpiresAt: true, pickupDate: true, notes: true },
      });
      if (!cur || !UNPAID_HOLD_STATUSES.includes(cur.status)) return { kind: 'none' as const };
      const reason = holdExpiryReason(cur, now);
      if (!reason) return { kind: 'none' as const };

      const graceStart = new Date(now.getTime() - INFLIGHT_PAYMENT_GRACE_HOURS * 60 * 60 * 1000);
      const inflight = await tx.payment.count({
        where: {
          rentalOrderId: r.id,
          tenantId: r.tenantId,
          status: { in: ['PENDING', 'PROCESSING'] },
          createdAt: { gt: graceStart },
        },
      });
      if (inflight > 0) return { kind: 'skipped' as const, why: `${inflight} payment(s) in progress` };

      const message = holdExpiryMessage(reason, cur.holdState);
      const note = `[Auto-cancelled ${now.toISOString()}] ${message} (${reason}${
        cur.holdExpiresAt ? `, deadline ${cur.holdExpiresAt.toISOString()}` : ''
      })`;
      const res = await tx.rentalOrder.updateMany({
        where: {
          id: r.id,
          tenantId: r.tenantId,
          status: cur.status,
          holdState: cur.holdState,
          holdExpiresAt: cur.holdExpiresAt,
          pickupDate: cur.pickupDate,
          payments: { none: { status: 'COMPLETED' } },
        },
        data: { status: 'CANCELLED', notes: cur.notes ? `${cur.notes}\n${note}` : note },
      });
      if (res.count === 0) return { kind: 'none' as const };
      return {
        kind: 'cancelled' as const,
        reason,
        holdState: cur.holdState,
        holdExpiresAt: cur.holdExpiresAt,
        message,
      };
    });
  }

  /** Classify unconfirmed bookings created before the hold rules (holdState NULL). */
  private async adoptLegacyHolds(now: Date, ttlHours: number): Promise<number> {
    const legacy = await this.prisma.rentalOrder.findMany({
      where: { status: { in: UNPAID_HOLD_STATUSES }, holdState: null },
      select: { id: true, tenantId: true, userId: true, status: true, createdAt: true, downPaymentAmount: true, rentalNumber: true },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    let adopted = 0;
    for (const r of legacy) {
      let decision: { holdState: string; holdExpiresAt: Date | null } | null = null;
      try {
        decision = await this.prisma.$transaction(async (tx) => {
          if (r.tenantId) await lockCustomerIdState(tx, r.tenantId, r.userId);
          const id = r.tenantId
            ? await customerIdState(tx, r.tenantId, r.userId)
            : { state: 'NONE' as const, approvedAt: null, rejectedAt: null };
          const hold = adoptLegacyHold({
            status: r.status,
            createdAt: r.createdAt,
            downPaymentAmount: Number(r.downPaymentAmount),
            idState: id.state,
            approvedAt: id.approvedAt,
            rejectedAt: id.rejectedAt,
            ttlHours,
          });
          const res = await tx.rentalOrder.updateMany({
            where: { id: r.id, tenantId: r.tenantId, status: r.status, holdState: null },
            data: hold,
          });
          return res.count > 0 ? hold : null;
        });
      } catch (err: any) {
        // Not adopted this run (retried next run); expiry of the others continues.
        this.logger.error(`[RENTAL_HOLD] ${r.rentalNumber} not adopted: ${err?.message}`);
        continue;
      }
      if (decision) {
        adopted++;
        this.logger.log(
          `[RENTAL_HOLD] ${r.rentalNumber} adopted: ${decision.holdState}, deadline ${decision.holdExpiresAt?.toISOString() ?? 'none'}`,
        );
      }
    }
    if (adopted > 0) this.logger.log(`[RENTAL_HOLD] ${adopted} existing booking(s) given an explicit hold deadline (${now.toISOString()}).`);
    return adopted;
  }

  // ============================================================
  // SUBSCRIPTION LIFECYCLE
  // ============================================================

  /**
   * Daily at 6:00 AM — Check expiring subscriptions and send reminders.
   * Also transitions EXPIRED → GRACE → SUSPENDED.
   */
  @Cron('0 6 * * *', { name: 'subscription-lifecycle' })
  async handleSubscriptionLifecycle() {
    this.logger.log('Running subscription lifecycle check...');

    try {
      const now = new Date();
      const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const threeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

      // 1. Send reminders for subscriptions expiring within 7 days
      const expiringSoon = await this.prisma.tenantSubscription.findMany({
        where: {
          status: 'ACTIVE',
          endDate: { lte: sevenDays, gt: now },
        },
        include: {
          tenant: {
            include: {
              adminUsers: { where: { role: 'SUPER_ADMIN' }, take: 1, select: { email: true } },
            },
          },
          plan: { select: { name: true } },
        },
      });

      for (const sub of expiringSoon) {
        const daysLeft = Math.ceil((sub.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const adminEmail = sub.tenant.adminUsers[0]?.email;
        if (adminEmail && (daysLeft === 7 || daysLeft === 3 || daysLeft === 1)) {
          this.logger.warn(
            `[SUBSCRIPTION] ${sub.tenant.name} (${sub.plan.name}) expires in ${daysLeft} days. Admin: ${adminEmail}`,
          );
          // TODO: Send email reminder via notifications service
        }
      }

      // 2. Transition ACTIVE → GRACE for expired subscriptions
      const expiredActive = await this.prisma.tenantSubscription.findMany({
        where: { status: 'ACTIVE', endDate: { lt: now } },
        include: { tenant: true },
      });

      for (const sub of expiredActive) {
        const graceEndDate = new Date(sub.endDate.getTime() + 7 * 24 * 60 * 60 * 1000);
        await this.prisma.tenantSubscription.update({
          where: { id: sub.id },
          data: { status: 'GRACE', graceEndDate },
        });
        this.logger.warn(`[SUBSCRIPTION] ${sub.tenant.name} entered grace period until ${graceEndDate.toISOString()}`);
      }

      // 3. Transition GRACE → EXPIRED and suspend tenant
      const expiredGrace = await this.prisma.tenantSubscription.findMany({
        where: {
          status: 'GRACE',
          graceEndDate: { lt: now },
        },
        include: { tenant: true },
      });

      for (const sub of expiredGrace) {
        await this.prisma.tenantSubscription.update({
          where: { id: sub.id },
          data: { status: 'EXPIRED' },
        });
        await this.prisma.tenant.update({
          where: { id: sub.tenantId },
          data: { status: 'SUSPENDED' },
        });
        this.logger.warn(`[SUBSCRIPTION] ${sub.tenant.name} SUSPENDED — grace period ended`);
      }

      // 4. Handle trial expirations
      const expiredTrials = await this.prisma.tenant.findMany({
        where: {
          status: 'TRIAL',
          trialEndsAt: { lt: now },
        },
      });

      for (const tenant of expiredTrials) {
        await this.prisma.tenant.update({
          where: { id: tenant.id },
          data: { status: 'SUSPENDED' },
        });
        this.logger.warn(`[TRIAL] ${tenant.name} trial expired — SUSPENDED`);
      }

      this.logger.log(
        `Subscription lifecycle: ${expiringSoon.length} expiring soon, ${expiredActive.length} → grace, ${expiredGrace.length} → suspended, ${expiredTrials.length} trials expired`,
      );
    } catch (error) {
      this.logger.error('Error in subscription lifecycle cron:', error);
    }
  }

  // --- Instagram sync (dynamic interval, configured via SiteSetting) ---
  async handleInstagramSync() {
    this.logger.log('Running Instagram post sync...');
    try {
      const result = await this.instagramService.syncFromInstagram();
      this.logger.log(`Instagram sync done: ${result.synced} synced, ${result.errors} errors`);
    } catch (error) {
      this.logger.error(`Error in Instagram sync cron: ${error instanceof Error ? error.message : error}`);
    }
  }

  // --- Instagram token health check: daily at 03:00 ---
  // Was a 1st/15th fb_exchange_token "refresh", which never extended a
  // long-lived USER token (the feed died 60 days after the July bootstrap).
  // Tenants now hold a non-expiring PAGE token (Admin → CMS → Instagram →
  // Connect); this job verifies each token via debug_token, skips the
  // exchange for PAGE tokens, and raises INSTAGRAM_TOKEN_EXPIRING (once per
  // day — the job runs daily) for user tokens that are invalid or < 14 days
  // from expiry. Stays on this singleton (crons never run on request-scoped
  // providers).
  @Cron('0 3 * * *', { name: 'instagram-token-refresh' })
  async handleInstagramTokenRefresh() {
    this.logger.log('Checking Instagram access tokens...');
    try {
      const results = await this.instagramService.checkAllTenantTokens();
      for (const r of results) {
        if (r.tokenType === 'PAGE' || r.expiresAt === 'never') {
          if (!r.valid && !r.error?.startsWith('debug_token failed')) {
            this.logger.error(
              `INSTAGRAM_TOKEN_INVALID tenant ${r.tenantId}: Page token rejected by Facebook (${r.error ?? 'invalid'}) — ` +
                're-connect Instagram in Admin → CMS → Instagram.',
            );
          } else if (r.error) {
            this.logger.warn(`Instagram token check for tenant ${r.tenantId}: ${r.error}`);
          }
          continue;
        }
        if (r.expiringSoon) {
          const contact = await this.getAdminContact(r.tenantId).catch(() => ({ email: '', phone: '' }));
          // No generic admin-alert email template exists yet; the ERROR line
          // is the alert (grep pm2 logs for INSTAGRAM_TOKEN_EXPIRING).
          this.logger.error(
            `INSTAGRAM_TOKEN_EXPIRING tenant ${r.tenantId}: ${r.tokenType ?? 'USER'} token ` +
              `${r.valid ? `expires ${r.expiresAt}` : `is invalid (${r.error ?? 'unknown'})`} — ` +
              're-connect Instagram in Admin → CMS → Instagram to switch to a non-expiring Page token' +
              (contact.email ? ` (tenant admin: ${contact.email})` : ''),
          );
        } else if (r.error) {
          this.logger.warn(`Instagram token check for tenant ${r.tenantId}: ${r.error}`);
        }
      }
      this.logger.log(`Instagram token check done for ${results.length} tenant(s)`);
    } catch (error) {
      // Message only — an axios error object carries the token in its config.
      this.logger.error(`Error in Instagram token check cron: ${error instanceof Error ? error.message : error}`);
    }
  }
}
