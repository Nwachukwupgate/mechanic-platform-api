import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter;

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST'),
      port: this.configService.get<number>('SMTP_PORT'),
      secure: false,
      auth: {
        user: this.configService.get<string>('SMTP_USER'),
        pass: this.configService.get<string>('SMTP_PASS'),
      },
    });
  }

  async sendVerificationEmail(email: string, token: string, role: string) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    const verificationUrl = `${frontendUrl}/verify-email?token=${token}&role=${role}`;

    const mailOptions = {
      from: this.configService.get<string>('EMAIL_FROM'),
      to: email,
      subject: 'Verify Your Email - Mechanic Platform',
      html: `
        <h2>Welcome to Mechanic Platform!</h2>
        <p>Please verify your email address by clicking the link below:</p>
        <a href="${verificationUrl}">Verify Email</a>
        <p>Or copy and paste this URL into your browser:</p>
        <p>${verificationUrl}</p>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log('Verification email sent to:', email);
      console.log('Verification URL:', verificationUrl);
    } catch (error) {
      console.error('Error sending email:', error);
      // In development, log the verification URL even if email fails
      console.log('Verification URL:', verificationUrl);
      throw error;
    }
  }

  async sendPasswordResetOtp(email: string, code: string, role: string) {
    const roleLabel = role === 'MECHANIC' ? 'mechanic' : 'user';
    const mailOptions = {
      from: this.configService.get<string>('EMAIL_FROM'),
      to: email,
      subject: 'Your password reset code — Denicksen Auto',
      html: `
        <h2>Password reset</h2>
        <p>You requested to reset your password (${roleLabel} account). Use this code in the app:</p>
        <p style="font-size: 28px; font-weight: bold; letter-spacing: 6px; font-family: monospace;">${code}</p>
        <p>This code expires in <strong>15 minutes</strong>. If you did not request this, you can ignore this email.</p>
        <p>— Denicksen Auto</p>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log('Password reset OTP sent to:', email);
    } catch (error) {
      console.error('Error sending password reset email:', error);
      throw error;
    }
  }
}
