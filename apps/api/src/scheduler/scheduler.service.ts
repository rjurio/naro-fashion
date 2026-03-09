import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

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

        // TODO: Send email/SMS notification to admin
        // await this.notifications.sendAdminPreparationReminder(rental, daysUntilPickup);
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
          user: { select: { firstName: true, lastName: true, email: true } },
          product: { select: { name: true } },
        },
      });

      this.logger.log(`Found ${overdueRentals.length} overdue rentals`);

      for (const rental of overdueRentals) {
        const customerName = `${rental.user.firstName} ${rental.user.lastName}`;
        await this.notifications.sendOverdueRentalAlert(
          rental.id,
          customerName,
          rental.returnDate,
        );
      }
    } catch (error) {
      this.logger.error('Error in overdue rental check cron:', error);
    }
  }
}
