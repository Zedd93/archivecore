const nodemailer = require('nodemailer');
const { config } = require('../dist/config/env.js');
const { validSmtpSettings, smtpTransportOptions } = require('../dist/modules/notifications/email-transport.js');

const required = {
  SMTP_HOST: config.smtp.host,
  SMTP_USER: config.smtp.user,
  SMTP_PASSWORD: config.smtp.password,
  SMTP_FROM: config.smtp.from,
  PUBLIC_APP_URL: config.smtp.publicUrl,
};

async function main() {
  const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    process.stderr.write(`Brak konfiguracji poczty: ${missing.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  if (!validSmtpSettings(config.smtp)) {
    process.stderr.write('Nieprawidłowa konfiguracja SMTP_PORT lub PUBLIC_APP_URL.\n');
    process.exitCode = 1;
    return;
  }

  const transport = nodemailer.createTransport(smtpTransportOptions(config.smtp));
  try {
    await transport.verify();
    process.stdout.write('Połączenie i uwierzytelnienie SMTP działają. Nie wysłano wiadomości.\n');
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(error.code)
      ? error.code : 'UNKNOWN';
    const responseCode = Number.isInteger(error?.responseCode) ? ` (${error.responseCode})` : '';
    process.stderr.write(`Nie udało się zweryfikować SMTP: ${code}${responseCode}. Sprawdź ustawienia i logi dostawcy poczty.\n`);
    process.exitCode = 1;
  } finally {
    transport.close();
  }
}

main().catch(() => {
  process.stderr.write('Kontrola SMTP zakończyła się nieoczekiwanym błędem.\n');
  process.exitCode = 1;
});
