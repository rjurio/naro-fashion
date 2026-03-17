import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private client: any;
  private sms: any;
  private senderId: string;
  private isConfigured = false;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('AT_API_KEY', '');
    const username = this.configService.get<string>('AT_USERNAME', 'sandbox');
    this.senderId = this.configService.get<string>('AT_SENDER_ID', 'NAROFASH');

    if (apiKey && username) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const AfricasTalking = require('africastalking');
        this.client = AfricasTalking({ apiKey, username });
        this.sms = this.client.SMS;
        this.isConfigured = true;
        this.logger.log(
          `SMS service configured with Africa's Talking (username: ${username})`,
        );
      } catch (error) {
        this.logger.warn(
          `Failed to initialize Africa's Talking SDK: ${error instanceof Error ? error.message : error}`,
        );
      }
    } else {
      this.logger.warn(
        'SMS service not configured — AT_API_KEY or AT_USERNAME missing. SMS will be logged only.',
      );
    }
  }

  /**
   * Send an SMS message. Never throws — failures are logged.
   * @param to - Phone number in international format (e.g., +255712345678)
   * @param message - SMS text content (max ~160 chars for single SMS)
   */
  async send(to: string, message: string): Promise<{ sent: boolean; channel: string }> {
    // Normalize Tanzanian numbers: 0712... -> +255712...
    const normalizedTo = this.normalizePhone(to);

    if (!normalizedTo) {
      this.logger.warn(`[SMS] Invalid phone number: ${to}`);
      return { sent: false, channel: 'none' };
    }

    this.logger.log(`[SMS] Sending to ${normalizedTo}: ${message.substring(0, 50)}...`);

    if (!this.isConfigured || !this.sms) {
      this.logger.warn(`[SMS] Not configured — message logged only`);
      return { sent: false, channel: 'log' };
    }

    try {
      const result = await this.sms.send({
        to: [normalizedTo],
        message,
        from: this.senderId,
      });

      this.logger.log(
        `[SMS] Sent successfully to ${normalizedTo}: ${JSON.stringify(result)}`,
      );
      return { sent: true, channel: 'africastalking' };
    } catch (error) {
      this.logger.error(
        `[SMS] Failed to send to ${normalizedTo}: ${error instanceof Error ? error.message : error}`,
      );
      return { sent: false, channel: 'error' };
    }
  }

  /**
   * Normalize a Tanzanian phone number to international format.
   * Accepts: 0712345678, +255712345678, 255712345678, 712345678
   */
  private normalizePhone(phone: string): string | null {
    if (!phone) return null;

    // Remove spaces, dashes, parentheses
    let cleaned = phone.replace(/[\s\-()]/g, '');

    // Handle various Tanzanian formats
    if (cleaned.startsWith('+255')) {
      return cleaned;
    }
    if (cleaned.startsWith('255') && cleaned.length >= 12) {
      return `+${cleaned}`;
    }
    if (cleaned.startsWith('0') && cleaned.length === 10) {
      return `+255${cleaned.substring(1)}`;
    }
    if (cleaned.startsWith('7') && cleaned.length === 9) {
      return `+255${cleaned}`;
    }

    // If it already has a + prefix for another country, pass through
    if (cleaned.startsWith('+') && cleaned.length >= 10) {
      return cleaned;
    }

    return null;
  }
}
