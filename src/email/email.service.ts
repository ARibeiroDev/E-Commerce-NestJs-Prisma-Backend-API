import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { LoggerService } from '../logger/logger.service';

@Injectable()
export class EmailService {
  private resend: Resend;

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not defined');
    }
    this.resend = new Resend(apiKey);
  }
  async sendVerificationEmail(email: string, token: string) {
    const clientUrl = this.configService.get<string>('CLIENT_URL');
    const from = this.configService.get<string>('EMAIL_FROM');
    if (!from) {
      throw new Error('EMAIL_FROM is not defined');
    }

    const verificationLink = `${clientUrl}/verify-email?token=${token}`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to ClothingCo!</h2>
        <p>Please click the button below to verify your email address and activate your account:</p>
        <a href="${verificationLink}" 
           style="display: inline-block; padding: 10px 20px; color: #fff; background-color: #4F46E5; text-decoration: none; border-radius: 5px;">
           Verify Email
        </a>
        <p style="margin-top: 20px; font-size: 12px; color: #666;">
          Or copy and paste this link into your browser:<br>
          ${verificationLink}
        </p>
      </div>
    `;

    try {
      const { data, error } = await this.resend.emails.send({
        from: from,
        to: email,
        subject: 'ClothingCo. - Verify Your Email',
        html: htmlContent,
      });

      if (error) {
        // Resend SDK doesn't always throw an exception, it returns an error object
        this.logger.error(
          `Resend API Error sending to ${email}:`,
          error.message,
        );
        throw new Error(error.message);
      }

      this.logger.log(`Verification email sent to ${email} (ID: ${data?.id})`);
    } catch (error: any) {
      this.logger.error(
        `Failed to send verification email to ${email}`,
        (error as Error).message,
      );
      throw error;
    }
  }

  async sendPasswordResetEmail(email: string, token: string) {
    const clientUrl = this.configService.get<string>('CLIENT_URL');
    const from = this.configService.get<string>('EMAIL_FROM');

    if (!from) {
      throw new Error('EMAIL_FROM is not defined');
    }

    const resetLink = `${clientUrl}/reset-password?token=${token}`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Reset Your Password</h2>
        <p>We received a request to reset your password. Click the button below to create a new one:</p>
        <a href="${resetLink}" 
           style="display: inline-block; padding: 10px 20px; color: #fff; background-color: #4F46E5; text-decoration: none; border-radius: 5px;">
           Reset Password
        </a>
        <p style="margin-top: 20px; font-size: 12px; color: #666;">
          If you did not request a password reset, please ignore this email. This link will expire in 1 hour.<br><br>
          ${resetLink}
        </p>
      </div>
    `;

    try {
      const { data, error } = await this.resend.emails.send({
        from: from,
        to: email,
        subject: 'ClothingCo. - Reset Your Password',
        html: htmlContent,
      });

      if (error) {
        this.logger.error(
          `Resend API Error sending to ${email}:`,
          error.message,
        );
        throw new Error(error.message);
      }

      this.logger.log(
        `Password reset email sent to ${email} (ID: ${data?.id})`,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to send password reset email to ${email}`,
        (error as Error).message,
      );
      throw error;
    }
  }

  async sendContactSupportEmail(
    fullName: string,
    email: string,
    message: string,
  ) {
    const from = this.configService.get<string>('EMAIL_FROM');
    const supportEmail = this.configService.get<string>('SUPPORT_EMAIL');

    if (!from || !supportEmail) {
      throw new Error('EMAIL_FROM or SUPPORT_EMAIL is not defined');
    }

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">New Support Request</h2>
        <p><strong>From:</strong> ${fullName} (${email})</p>
        <hr style="border: 1px solid #eaeaea; margin: 20px 0;" />
        <h3 style="color: #666;">Message:</h3>
        <p style="white-space: pre-wrap; color: #333;">${message}</p>
      </div>`;

    try {
      const { data, error } = await this.resend.emails.send({
        from: from,
        to: supportEmail,
        replyTo: email,
        subject: `ClothingCo. - New Support Request from ${fullName}`,
        html: htmlContent,
      });
      if (error) {
        this.logger.error(
          `Resend API Error sending from ${email}:`,
          error.message,
        );
        throw new Error(error.message);
      }

      this.logger.log(`Support email sent from ${email}, (ID: ${data?.id})`);
    } catch (error: any) {
      this.logger.error(
        `Failed to send support email from ${email}`,
        (error as Error).message,
      );
      throw error;
    }
  }
}
