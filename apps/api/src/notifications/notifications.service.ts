import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';
import { SmsService } from './sms.service';

/**
 * Email clients need absolute image URLs. Product images are stored as
 * `/uploads/...` paths served by the API; prefix them with env
 * API_PUBLIC_URL (e.g. https://api.narofashion.co.tz). Without it, relative
 * images are dropped rather than rendered broken.
 */
function absoluteImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https:\/\//i.test(url)) return url;
  const base = (process.env.API_PUBLIC_URL || '').replace(/\/+$/, '');
  if (base && url.startsWith('/')) return `${base}${url}`;
  return null;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly smsService: SmsService,
  ) {}

  // Branding (business name / domain) for SMS bodies + email layout is ALWAYS
  // tenant-scoped via EmailService.getBranding(): explicit tenantId → the
  // in-flight request's tenant (AsyncLocalStorage) → the deployment default
  // tenant. Never an unscoped findFirst (that handed tenant B's customers
  // tenant A's name). Cron/background callers iterating rows across tenants
  // MUST pass the row's tenantId in `extra.tenantId`.
  private async getBusinessName(tenantId?: string | null): Promise<string> {
    return (await this.emailService.getBranding(tenantId)).businessName;
  }

  private async getDomain(tenantId?: string | null): Promise<string> {
    return (await this.emailService.getBranding(tenantId)).domain;
  }

  /**
   * Send order confirmation via email + SMS.
   * Non-blocking — errors are caught and logged, never thrown.
   */
  async sendOrderConfirmation(orderId: string, customerEmail: string, extra?: {
    customerName?: string;
    orderNumber?: string;
    customerPhone?: string;
    tenantId?: string;
  }) {
    this.logger.log(
      `[ORDER CONFIRMATION] Order ${orderId} — sending to ${customerEmail}`,
    );

    const customerName = extra?.customerName || 'Valued Customer';
    const orderNumber = extra?.orderNumber || orderId.substring(0, 8).toUpperCase();

    // Send email (non-blocking — fire and forget with error catching)
    this.emailService
      .send({
        to: customerEmail,
        subject: `Order Confirmed — #${orderNumber}`,
        template: 'order-confirmation',
        tenantId: extra?.tenantId,
        context: {
          customerName,
          orderId,
          orderNumber,
          orderDate: new Date().toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }),
        },
      })
      .catch((err) =>
        this.logger.error(`[ORDER CONFIRMATION] Email failed: ${err?.message}`),
      );

    // Send SMS for order confirmations (critical notification)
    if (extra?.customerPhone) {
      const bizName = await this.getBusinessName(extra?.tenantId);
      const domain = await this.getDomain(extra?.tenantId);
      this.smsService
        .send(
          extra.customerPhone,
          `${bizName}: Your order #${orderNumber} has been confirmed! Thank you for shopping with us. Track your order at ${domain}/account/orders`,
        )
        .catch((err) =>
          this.logger.error(`[ORDER CONFIRMATION] SMS failed: ${err?.message}`),
        );
    }

    return { sent: true, channel: 'email+sms', orderId };
  }

  /**
   * Send rental pickup reminder to customer.
   */
  async sendRentalReminder(
    rentalId: string,
    customerEmail: string,
    pickupDate: Date,
    extra?: {
      customerName?: string;
      customerPhone?: string;
      rentalNumber?: string;
      pickupTime?: string;
      productName?: string;
      tenantId?: string;
    },
  ) {
    this.logger.log(
      `[RENTAL REMINDER] Rental ${rentalId} — pickup on ${pickupDate.toISOString()} — reminder to ${customerEmail}`,
    );

    const customerName = extra?.customerName || 'Valued Customer';
    const formattedDate = pickupDate.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    this.emailService
      .send({
        to: customerEmail,
        subject: `Rental Pickup Reminder — ${formattedDate}`,
        template: 'rental-reminder',
        tenantId: extra?.tenantId,
        context: {
          customerName,
          rentalId,
          rentalNumber: extra?.rentalNumber,
          pickupDate: formattedDate,
          pickupTime: extra?.pickupTime,
          productName: extra?.productName,
        },
      })
      .catch((err) =>
        this.logger.error(`[RENTAL REMINDER] Email failed: ${err?.message}`),
      );

    // SMS reminder
    if (extra?.customerPhone) {
      const bizName2 = await this.getBusinessName(extra?.tenantId);
      this.smsService
        .send(
          extra.customerPhone,
          `${bizName2}: Reminder — your rental pickup is on ${formattedDate}. Please bring your National ID. Questions? Call us.`,
        )
        .catch((err) =>
          this.logger.error(`[RENTAL REMINDER] SMS failed: ${err?.message}`),
        );
    }

    return { sent: true, channel: 'email+sms', rentalId };
  }

  /**
   * Send admin preparation reminder for upcoming rental pickup.
   */
  async sendAdminPrepReminder(
    rentalId: string,
    pickupDate: Date,
    customerName: string,
    extra?: {
      rentalNumber?: string;
      productName?: string;
      daysUntilPickup?: number;
      adminEmail?: string;
      tenantId?: string | null;
    },
  ) {
    this.logger.log(
      `[ADMIN PREP REMINDER] Rental ${rentalId} — prepare for ${customerName}, pickup on ${pickupDate.toISOString()}`,
    );

    const formattedDate = pickupDate.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const isUrgent = (extra?.daysUntilPickup ?? 99) <= 1;

    // Send to admin email (if provided, otherwise just log)
    const adminEmail = extra?.adminEmail || '';
    if (adminEmail) {
      this.emailService
        .send({
          to: adminEmail,
          subject: `${isUrgent ? '[URGENT] ' : ''}Rental Prep Reminder — ${customerName} on ${formattedDate}`,
          template: 'admin-prep-reminder',
          tenantId: extra?.tenantId,
          context: {
            rentalId,
            rentalNumber: extra?.rentalNumber,
            customerName,
            pickupDate: formattedDate,
            productName: extra?.productName,
            daysUntilPickup: extra?.daysUntilPickup,
            isUrgent,
          },
        })
        .catch((err) =>
          this.logger.error(`[ADMIN PREP REMINDER] Email failed: ${err?.message}`),
        );
    }

    return { sent: true, channel: 'email', rentalId };
  }

  /**
   * Send overdue rental alert to admin (critical notification — email + SMS).
   */
  async sendOverdueRentalAlert(
    rentalId: string,
    customerName: string,
    returnDate: Date,
    extra?: {
      rentalNumber?: string;
      customerPhone?: string;
      customerEmail?: string;
      productName?: string;
      adminEmail?: string;
      adminPhone?: string;
      tenantId?: string | null;
    },
  ) {
    this.logger.warn(
      `[OVERDUE RENTAL] Rental ${rentalId} — ${customerName} was due ${returnDate.toISOString()}`,
    );

    const formattedDate = returnDate.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const daysOverdue = Math.ceil(
      (Date.now() - returnDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Send email to admin
    const adminEmail = extra?.adminEmail || '';
    if (adminEmail) {
      this.emailService
        .send({
          to: adminEmail,
          subject: `[OVERDUE] Rental ${extra?.rentalNumber || rentalId} — ${customerName} (${daysOverdue} days overdue)`,
          template: 'overdue-rental',
          tenantId: extra?.tenantId,
          context: {
            rentalId,
            rentalNumber: extra?.rentalNumber,
            customerName,
            customerPhone: extra?.customerPhone,
            customerEmail: extra?.customerEmail,
            returnDate: formattedDate,
            daysOverdue,
            productName: extra?.productName,
          },
        })
        .catch((err) =>
          this.logger.error(`[OVERDUE RENTAL] Admin email failed: ${err?.message}`),
        );
    }

    // Send SMS to admin (critical)
    if (extra?.adminPhone) {
      this.smsService
        .send(
          extra.adminPhone,
          `OVERDUE: Rental #${extra?.rentalNumber || rentalId.substring(0, 8)} by ${customerName} is ${daysOverdue} day(s) overdue. Return was due ${formattedDate}. Please follow up.`,
        )
        .catch((err) =>
          this.logger.error(`[OVERDUE RENTAL] Admin SMS failed: ${err?.message}`),
        );
    }

    return { sent: true, channel: 'email+sms', rentalId };
  }

  /**
   * Send ID verification status update to customer.
   */
  async sendIdVerificationUpdate(
    customerEmail: string,
    status: 'APPROVED' | 'REJECTED',
    reason?: string,
    extra?: {
      customerPhone?: string;
      tenantId?: string | null;
    },
  ) {
    this.logger.log(
      `[ID VERIFICATION] Status: ${status} — notification to ${customerEmail}${reason ? ` — Reason: ${reason}` : ''}`,
    );

    const isApproved = status === 'APPROVED';

    const bizName3 = await this.getBusinessName(extra?.tenantId);
    const domain3 = await this.getDomain(extra?.tenantId);

    this.emailService
      .send({
        to: customerEmail,
        subject: `ID Verification ${isApproved ? 'Approved' : 'Update'} — ${bizName3}`,
        template: 'id-verification',
        tenantId: extra?.tenantId,
        context: {
          isApproved,
          reason,
        },
      })
      .catch((err) =>
        this.logger.error(`[ID VERIFICATION] Email failed: ${err?.message}`),
      );

    // SMS for ID verification updates
    if (extra?.customerPhone) {
      const smsMessage = isApproved
        ? `${bizName3}: Your ID has been verified! You can now rent items. Visit ${domain3}`
        : `${bizName3}: Your ID verification was not approved.${reason ? ` Reason: ${reason}` : ''} Please resubmit.`;

      this.smsService
        .send(extra.customerPhone, smsMessage)
        .catch((err) =>
          this.logger.error(`[ID VERIFICATION] SMS failed: ${err?.message}`),
        );
    }

    return { sent: true, channel: 'email+sms', status };
  }

  /**
   * Abandoned-cart reminder (tenant-branded `abandoned-cart` template).
   * Called by the scheduler's abandoned-cart cron, which iterates carts
   * across tenants — `tenantId` is therefore REQUIRED here. Shows up to 5
   * items; the rest are summarised as "…and N more".
   */
  async sendAbandonedCartReminder(params: {
    tenantId: string;
    to: string;
    customerName?: string;
    items: Array<{ name: string; quantity: number; price?: number | string | null; imageUrl?: string | null }>;
    cartUrl: string;
  }) {
    const { tenantId, to, cartUrl } = params;
    const items = (params.items || []).filter((i) => i && i.name);
    if (!tenantId || !to || items.length === 0) {
      return { sent: false, channel: 'skipped' };
    }
    const shown = items.slice(0, 5).map((i) => ({
      name: i.name,
      quantity: i.quantity,
      price:
        i.price === null || i.price === undefined || i.price === ''
          ? null
          : Number(i.price).toLocaleString('en-US', { maximumFractionDigits: 0 }),
      imageUrl: absoluteImageUrl(i.imageUrl),
    }));
    const bizName = await this.getBusinessName(tenantId);

    this.logger.log(`[ABANDONED CART] Reminder to ${to} (${items.length} items, tenant ${tenantId})`);
    const result = await this.emailService.send({
      to,
      subject: `Your bag is waiting — ${bizName}`,
      template: 'abandoned-cart',
      tenantId,
      context: {
        customerName: params.customerName || 'Valued Customer',
        items: shown,
        moreCount: items.length > shown.length ? items.length - shown.length : 0,
        cartUrl,
      },
    });
    return result;
  }

  /**
   * Send password reset email.
   */
  async sendPasswordResetEmail(email: string, resetUrl: string, tenantId?: string | null) {
    this.logger.log(`[PASSWORD RESET] Sending reset link to ${email}`);

    const bizName4 = await this.getBusinessName(tenantId);

    this.emailService
      .send({
        to: email,
        subject: `Password Reset — ${bizName4}`,
        template: 'password-reset',
        tenantId,
        context: { resetUrl },
      })
      .catch((err) =>
        this.logger.error(`[PASSWORD RESET] Email failed: ${err?.message}`),
      );

    return { sent: true, channel: 'email' };
  }
}
