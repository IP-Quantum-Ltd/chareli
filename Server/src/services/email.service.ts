import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import * as nodemailer from 'nodemailer';
import sgMail from '@sendgrid/mail';
import config from '../config/config';
import logger from '../utils/logger';
import { invitationEmailTemplate } from '../templates/emails/invitation.template';
import { welcomeEmailTemplate } from '../templates/emails/welcome.template';
import { resetPasswordEmailTemplate } from '../templates/emails/reset.template';
import { otpEmailTemplate } from '../templates/emails/otp.template';
import {
  roleRevokedEmailTemplate,
  roleChangedEmailTemplate,
} from '../templates/emails/role.template';
import { accountDeletionEmailTemplate } from '../templates/emails/account-deletion.template';
import { Resend } from 'resend';

// Provider selection - options: 'ses', 'gmail', 'sendgrid-smtp', 'sendgrid-api', 'resend'
// Default to 'ses' if EMAIL_PROVIDER is not set
const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || 'ses').toLowerCase();

export interface EmailServiceInterface {
  sendInvitationEmail(
    email: string,
    invitationLink: string,
    role: string
  ): Promise<boolean>;
  sendWelcomeEmail(email: string, name: string): Promise<boolean>;
  sendPasswordResetEmail(email: string, resetLink: string): Promise<boolean>;
  sendOtpEmail(email: string, otp: string): Promise<boolean>;
  sendRoleRevokedEmail(email: string, oldRole: string): Promise<boolean>;
  sendRoleChangedEmail(
    email: string,
    oldRole: string,
    newRole: string
  ): Promise<boolean>;
  sendAccountDeletionEmail(
    email: string,
    userName: string,
    isDeactivation?: boolean
  ): Promise<boolean>;
}

interface EmailProvider {
  sendEmail(to: string, subject: string, html: string): Promise<boolean>;
}

class SESProvider implements EmailProvider {
  private sesClient: SESClient;

  constructor() {
    const sesConfig: any = {
      region: config.ses.region,
    };

    if (config.ses.accessKeyId && config.ses.secretAccessKey) {
      sesConfig.credentials = {
        accessKeyId: config.ses.accessKeyId,
        secretAccessKey: config.ses.secretAccessKey,
      };
      logger.info('SES configured with explicit credentials');
    } else {
      logger.info('SES configured to use IAM role credentials');
    }

    this.sesClient = new SESClient(sesConfig);
  }

  async sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    try {
      const emailsToSkip = ['admin@example.com'];

      // In development mode, just log the email instead of sending
      if (emailsToSkip.includes(to)) {
        logger.info(
          `DEVELOPMENT MODE -- Skipping for this email ${to}: Email would be sent to ${to}`
        );
        return true;
      }

      const command = new SendEmailCommand({
        Destination: {
          ToAddresses: [to],
        },
        Message: {
          Body: {
            Html: {
              Charset: 'UTF-8',
              Data: html,
            },
          },
          Subject: {
            Charset: 'UTF-8',
            Data: subject,
          },
        },
        Source: config.ses.fromEmail,
      });

      await this.sesClient.send(command);
      logger.info(`Email sent successfully to ${to} via SES`);
      return true;
    } catch (error) {
      logger.error('Failed to send email via SES:', error);
      return false;
    }
  }
}

class GmailProvider implements EmailProvider {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      service: config.email.service,
      auth: {
        user: config.email.user,
        pass: config.email.password,
      },
    });
  }

  async sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    try {
      console.log(
        config.email.password,
        config.email.service,
        config.email.user
      );

      const emailsToSkip = ['admin@example.com'];

      // In development mode, just log the email instead of sending
      if (emailsToSkip.includes(to)) {
        logger.info(
          `DEVELOPMENT MODE -- Skipping for this email ${to}: Email would be sent to ${to}`
        );
        return true;
      }

      const mailOptions = {
        from: `"Arcades Box Team" <${config.email.user}>`,
        to: to,
        subject: subject,
        html: html,
      };

      await this.transporter.sendMail(mailOptions);
      logger.info(`Email sent successfully to ${to} via Gmail`);
      return true;
    } catch (error) {
      logger.error('Failed to send email via Gmail:', error);
      return false;
    }
  }
}

class SendGridSMTPProvider implements EmailProvider {
  private transporter: nodemailer.Transporter;

  constructor() {
    if (!config.sendgrid.apiKey) {
      logger.warn('SendGrid API key not configured');
    }

    // Configure Nodemailer to use SendGrid SMTP relay
    this.transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      secure: false, // Use TLS
      auth: {
        user: 'apikey', // This is literally the string 'apikey'
        pass: config.sendgrid.apiKey,
      },
    });

    logger.info('SendGrid SMTP relay configured successfully');
  }

  async sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    try {
      const emailsToSkip = ['admin@example.com'];

      // In development mode, just log the email instead of sending
      if (emailsToSkip.includes(to)) {
        logger.info(
          `DEVELOPMENT MODE -- Skipping for this email ${to}: Email would be sent to ${to}`
        );
        return true;
      }

      const mailOptions = {
        from: `"Arcades Box Team" <${config.sendgrid.fromEmail}>`,
        to: to,
        subject: subject,
        html: html,
      };

      await this.transporter.sendMail(mailOptions);
      logger.info(`Email sent successfully to ${to} via SendGrid SMTP`);
      return true;
    } catch (error) {
      logger.error('Failed to send email via SendGrid SMTP:', error);
      return false;
    }
  }
}

class SendGridAPIProvider implements EmailProvider {
  constructor() {
    if (!config.sendgrid.apiKey) {
      logger.warn('SendGrid API key not configured');
    } else {
      sgMail.setApiKey(config.sendgrid.apiKey);
      logger.info('SendGrid API configured successfully');
    }
  }

  async sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    try {
      const emailsToSkip = ['admin@example.com'];

      // In development mode, just log the email instead of sending
      if (emailsToSkip.includes(to)) {
        logger.info(
          `DEVELOPMENT MODE -- Skipping for this email ${to}: Email would be sent to ${to}`
        );
        return true;
      }

      const msg = {
        to,
        from: config.sendgrid.fromEmail,
        subject,
        html,
      };

      await sgMail.send(msg);
      logger.info(`Email sent successfully to ${to} via SendGrid API`);
      return true;
    } catch (error) {
      logger.error('Failed to send email via SendGrid API:', error);
      return false;
    }
  }
}

class ResendAPIProvider implements EmailProvider {
  private resendClient: Resend | null = null;
  
  constructor() {
    if (!config.resend.apiKey) {
      logger.warn('Resend API key not configured');
    } else {
      this.resendClient = new Resend(config.resend.apiKey);
      logger.info('Resend API configured successfully');
    }
  }

  async sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    try {
      const emailsToSkip = ['admin@example.com'];

      // In development mode, just log the email instead of sending
      if (emailsToSkip.includes(to)) {
        logger.info(
          `DEVELOPMENT MODE -- Skipping for this email ${to}: Email would be sent to ${to}`
        );
        return true;
      }
      
      if (!this.resendClient) {
        logger.error('Cannot send email via Resend: API client not initialized');
        return false;
      }

      await this.resendClient.emails.send({
        from: config.resend.fromEmail,
        to,
        subject,
        html,
      });

      logger.info(`Email sent successfully to ${to} via Resend`);
      return true;
    } catch (error) {
      logger.error('Failed to send email via Resend:', error);
      return false;
    }
  }
}

export class EmailService implements EmailServiceInterface {
  private provider: EmailProvider;

  constructor() {
    switch (EMAIL_PROVIDER) {
      case 'gmail':
        this.provider = new GmailProvider();
        logger.info('Using Gmail email provider');
        break;
      case 'sendgrid-smtp':
      case 'sendgrid': // Backward compatibility
        this.provider = new SendGridSMTPProvider();
        logger.info('Using SendGrid SMTP email provider');
        break;
      case 'sendgrid-api':
        this.provider = new SendGridAPIProvider();
        logger.info('Using SendGrid API email provider');
        break;
      case 'resend':
        this.provider = new ResendAPIProvider();
        logger.info('Using Resend email provider');
        break;
      case 'ses':
      default:
        this.provider = new SESProvider();
        logger.info('Using AWS SES email provider');
        break;
    }
  }

  /**
   * Send an invitation email with a link to register
   */
  async sendInvitationEmail(
    email: string,
    invitationLink: string,
    role: string
  ): Promise<boolean> {
    const html = invitationEmailTemplate(
      invitationLink,
      role,
      config.otp.invitationExpiryDays
    );
    return this.sendEmail(email, 'Invitation to join Arcades Box', html);
  }

  /**
   * Send a welcome email to a new user
   */
  async sendWelcomeEmail(email: string, name: string): Promise<boolean> {
    const html = welcomeEmailTemplate(name);
    return this.sendEmail(email, 'Welcome to Arcades Box', html);
  }

  /**
   * Send a password reset email
   */
  async sendPasswordResetEmail(
    email: string,
    resetLink: string
  ): Promise<boolean> {
    const html = resetPasswordEmailTemplate(resetLink);
    return this.sendEmail(email, 'Reset your Arcades Box password', html);
  }

  /**
   * Send an OTP verification email
   */
  async sendOtpEmail(email: string, otp: string): Promise<boolean> {
    const html = otpEmailTemplate(otp, config.otp.expiryMinutes);
    return this.sendEmail(email, 'Your Verification Code', html);
  }

  /**
   * Send email notification when a user's role is revoked
   */
  async sendRoleRevokedEmail(email: string, oldRole: string): Promise<boolean> {
    const html = roleRevokedEmailTemplate(oldRole);
    return this.sendEmail(email, 'Your Role Has Been Changed', html);
  }

  /**
   * Send email notification when a user's role is changed
   */
  async sendRoleChangedEmail(
    email: string,
    oldRole: string,
    newRole: string
  ): Promise<boolean> {
    const html = roleChangedEmailTemplate(oldRole, newRole);
    return this.sendEmail(email, 'Your Role Has Been Updated', html);
  }

  /**
   * Send email notification when a user's account is deleted or deactivated
   */
  async sendAccountDeletionEmail(
    email: string,
    userName: string,
    isDeactivation: boolean = false
  ): Promise<boolean> {
    const html = accountDeletionEmailTemplate(userName, isDeactivation);
    const subject = isDeactivation
      ? 'Your Arcades Box Account Has Been Deactivated'
      : 'Your Arcades Box Account Has Been Deleted';
    return this.sendEmail(email, subject, html);
  }

  /**
   * Send an email using the configured provider (Gmail or SES)
   */
  private async sendEmail(
    to: string,
    subject: string,
    html: string
  ): Promise<boolean> {
    return this.provider.sendEmail(to, subject, html);
  }
}

export const emailService = new EmailService();
