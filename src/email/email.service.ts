import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailParams, MailerSend, Recipient, Sender } from 'mailersend';

@Injectable()
export class EmailService {
  private mailerSend: MailerSend;

  constructor(private readonly configService: ConfigService) {
    this.mailerSend = new MailerSend({
      apiKey: this.configService.get<string>('MAILSENDER_API_TOKEN')!,
    });
  }

  async sendVerificationEmail(email: string, token: string) {
    const from = new Sender(
      this.configService.get<string>('EMAIL_FROM')!,
      this.configService.get<string>('EMAIL_FROM_NAME'),
    );

    const to = [new Recipient(email)];

    const clientUrl = this.configService.get<string>('CLIENT_URL');

    const params = new EmailParams()
      .setFrom(from)
      .setTo(to)
      .setSubject('ClothingCo. - Verify Your Email')
      .setHtml(
        `<p>Click below to verify your email:</p>
         <a href="${clientUrl}/api/auth/verify-email?token=${token}">
         Verify Email
         </a>`,
      )
      .setText(
        `Verify your email by visiting: ${clientUrl}/api/auth/verify-email?token=${token}`,
      );

    await this.mailerSend.email.send(params);
  }

  async sendPasswordResetEmail(email: string, token: string) {
    const from = new Sender(
      this.configService.get<string>('EMAIL_FROM')!,
      this.configService.get<string>('EMAIL_FROM_NAME'),
    );
    const to = [new Recipient(email)];

    const clientUrl = this.configService.get<string>('CLIENT_URL');

    const params = new EmailParams()
      .setFrom(from)
      .setTo(to)
      .setSubject('Reset Your Password')
      .setHtml(
        `<p>Click below to reset your password:</p>
         <a href="${clientUrl}/api/auth/reset-password?token=${token}">
         Reset Password
         </a>`,
      )
      .setText(
        `Reset your password by visiting: ${clientUrl}/api/auth/reset-password?token=${token}`,
      );

    await this.mailerSend.email.send(params);
  }
}
