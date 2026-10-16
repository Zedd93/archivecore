import nodemailer from 'nodemailer';
import { config } from '../../config/env';

export type SmtpSettings = typeof config.smtp;

export function validSmtpSettings(settings: SmtpSettings): boolean {
  if (!settings.host || !settings.user || !settings.password || !settings.from || !settings.publicUrl) return false;
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) return false;
  try {
    const url = new URL(settings.publicUrl);
    return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function smtpSettings(): SmtpSettings | null {
  return validSmtpSettings(config.smtp) ? config.smtp : null;
}

export function smtpTransportOptions(settings: SmtpSettings) {
  return {
    host: settings.host, port: settings.port, secure: settings.secure,
    requireTLS: !settings.secure,
    auth: { user: settings.user, pass: settings.password },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000,
  };
}

export function notificationMailOptions(
  settings: SmtpSettings,
  message: { id: string; to: string; subject: string; body: string; orderId: string },
) {
  return {
    from: settings.from,
    to: message.to,
    subject: message.subject,
    text: `${message.body}\n\nOtwórz zlecenie: ${new URL(`/orders/${message.orderId}`, settings.publicUrl).toString()}\n`,
    messageId: `<${message.id}@${new URL(settings.publicUrl).hostname}>`,
  };
}

export async function sendNotificationEmail(
  settings: SmtpSettings,
  message: { id: string; to: string; subject: string; body: string; orderId: string },
) {
  const transport = nodemailer.createTransport(smtpTransportOptions(settings));
  try {
    await transport.sendMail(notificationMailOptions(settings, message));
  } finally {
    transport.close();
  }
}
