import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InstagramService } from '../cms/instagram.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly configService: ConfigService,
    private readonly instagramService: InstagramService,
  ) {}

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

  // --- Instagram sync: every 6 hours ---
  @Cron('0 */6 * * *', { name: 'instagram-sync' })
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
