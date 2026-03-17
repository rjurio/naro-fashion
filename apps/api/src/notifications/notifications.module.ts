import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { EmailService } from './email.service';
import { SmsService } from './sms.service';

@Global()
@Module({
  providers: [EmailService, SmsService, NotificationsService],
  exports: [NotificationsService, EmailService, SmsService],
})
export class NotificationsModule {}
