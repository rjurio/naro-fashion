import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  async sendOrderConfirmation(orderId: string, customerEmail: string) {
    this.logger.log(
      `[ORDER CONFIRMATION] Order ${orderId} — email would be sent to ${customerEmail}`,
    );
    // TODO: Integrate with email/SMS provider (e.g., SendGrid, Africa's Talking)
    return { sent: true, channel: 'log', orderId };
  }

  async sendRentalReminder(
    rentalId: string,
    customerEmail: string,
    pickupDate: Date,
  ) {
    this.logger.log(
      `[RENTAL REMINDER] Rental ${rentalId} — pickup on ${pickupDate.toISOString()} — reminder to ${customerEmail}`,
    );
    // TODO: Integrate with email/SMS provider
    return { sent: true, channel: 'log', rentalId };
  }

  async sendAdminPrepReminder(
    rentalId: string,
    pickupDate: Date,
    customerName: string,
  ) {
    this.logger.log(
      `[ADMIN PREP REMINDER] Rental ${rentalId} — prepare for ${customerName}, pickup on ${pickupDate.toISOString()}`,
    );
    // TODO: Send to admin dashboard / email
    return { sent: true, channel: 'log', rentalId };
  }

  async sendOverdueRentalAlert(
    rentalId: string,
    customerName: string,
    returnDate: Date,
  ) {
    this.logger.warn(
      `[OVERDUE RENTAL] Rental ${rentalId} — ${customerName} was due ${returnDate.toISOString()}`,
    );
    // TODO: Send urgent notification to admin
    return { sent: true, channel: 'log', rentalId };
  }

  async sendIdVerificationUpdate(
    customerEmail: string,
    status: 'APPROVED' | 'REJECTED',
    reason?: string,
  ) {
    this.logger.log(
      `[ID VERIFICATION] Status: ${status} — notification to ${customerEmail}${reason ? ` — Reason: ${reason}` : ''}`,
    );
    // TODO: Integrate with email/SMS provider
    return { sent: true, channel: 'log', status };
  }
}
