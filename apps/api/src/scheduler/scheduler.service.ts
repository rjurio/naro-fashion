import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InstagramService } from '../cms/instagram.service';

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

  /** Helper to get the admin notification email from env or first super-admin. */
  private async getAdminContact(): Promise<{ email: string; phone: string }> {
    const envEmail = this.configService.get<string>('ADMIN_NOTIFICATION_EMAIL', '');
    const envPhone = this.configService.get<string>('ADMIN_NOTIFICATION_PHONE', '');

    if (envEmail) {
      return { email: envEmail, phone: envPhone };
    }

    // Fallback: find first SUPER_ADMIN
    const superAdmin = await this.prisma.adminUser.findFirst({
      where: { role: 'SUPER_ADMIN' },
      select: { email: true, phone: true },
    });

    return {
      email: superAdmin?.email || '',
      phone: superAdmin?.phone || '',
    };
  }

  /**
   * Every day at 8:00 AM — check for upcoming rental pickups
   * and send daily admin preparation reminders until item is marked ready.
   */
  @Cron('0 8 * * *', { name: 'rental-prep-reminder' })
  async handlePreparationReminders() {
    this.logger.log('Running daily rental preparation reminder check...');

    try {
      // Get the reminder window from policy (default 8 days)
      const policy = await this.prisma.rentalPolicy.findFirst();
      const reminderDays = policy?.advancePreparationReminderDays ?? 8;

      const now = new Date();
      const cutoffDate = new Date();
      cutoffDate.setDate(now.getDate() + reminderDays);

      // Find all rentals needing preparation that admin hasn't marked as ready
      const upcomingRentals = await this.prisma.rentalOrder.findMany({
        where: {
          pickupDate: { lte: cutoffDate },
          isReadyForPickup: false,
          status: { in: ['DOWN_PAYMENT_PAID', 'FULLY_PAID', 'READY_FOR_PICKUP'] },
        },
        include: {
          user: { select: { firstName: true, lastName: true, email: true, phone: true } },
          product: { select: { name: true } },
          variant: { select: { name: true, size: true, color: true } },
        },
      });

      const adminContact = await this.getAdminContact();

      for (const rental of upcomingRentals) {
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

      const adminContact = await this.getAdminContact();

      for (const rental of overdueRentals) {
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
            select: { email: true, firstName: true, phone: true },
          });
          if (!user?.email) continue;

          // Record the reminder
          await this.prisma.abandonedCartReminder.create({
            data: {
              userId: cartGroup.userId,
              itemCount,
              sequence: window.sequence,
              channel: 'EMAIL',
            },
          });

          this.logger.log(
            `[ABANDONED CART] Sequence ${window.sequence} reminder for ${user.email} (${itemCount} items)`,
          );

          // Send notification (the notification service handles this)
          this.notifications
            .sendOrderConfirmation(
              `abandoned-cart-${cartGroup.userId}`,
              user.email,
            )
            .catch((err) =>
              this.logger.error(`Abandoned cart notification failed: ${err?.message}`),
            );
        }
      }
    } catch (error) {
      this.logger.error('Error in abandoned cart recovery cron:', error);
    }
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
      this.logger.error('Error in Instagram sync cron:', error);
    }
  }

  // --- Instagram token refresh: 1st and 15th of each month ---
  @Cron('0 0 1,15 * *', { name: 'instagram-token-refresh' })
  async handleInstagramTokenRefresh() {
    this.logger.log('Refreshing Instagram access token...');
    try {
      const success = await this.instagramService.refreshAccessToken();
      this.logger.log(`Instagram token refresh: ${success ? 'success' : 'failed'}`);
    } catch (error) {
      this.logger.error('Error in Instagram token refresh cron:', error);
    }
  }
}
