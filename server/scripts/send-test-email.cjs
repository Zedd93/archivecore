const nodemailer = require('nodemailer');
const { z } = require('zod');
const { config } = require('../dist/config/env.js');
const { validSmtpSettings, smtpTransportOptions } = require('../dist/modules/notifications/email-transport.js');

const recipientSchema = z.string().email().max(254);

async function sendTestEmail(settings, recipient, createTransport = nodemailer.createTransport) {
  const transport = createTransport(smtpTransportOptions(settings));
  try {
    const result = await transport.sendMail({
      from: settings.from,
      to: recipient,
      subject: 'ArchiveCore - test poczty SMTP',
      text: 'To jest kontrolna wiadomosc testowa ArchiveCore. Nie dotyczy zadnego zlecenia ani dokumentu.\n',
    });
    if (!result.accepted?.some((address) => address.toLowerCase() === recipient.toLowerCase())) {
      throw Object.assign(new Error('Recipient not accepted'), { code: 'RECIPIENT_REJECTED' });
    }
  } finally {
    transport.close();
  }
}

function safeErrorCode(error) {
  const code = error?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code) ? code : 'UNKNOWN';
}

async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--to' || !recipientSchema.safeParse(args[1]).success) {
    process.stderr.write('Uzycie: npm run email:send-test -- --to adres@example.com\n');
    process.exitCode = 1;
    return;
  }
  if (!validSmtpSettings(config.smtp)) {
    process.stderr.write('Brak lub nieprawidlowa konfiguracja SMTP. Uruchom najpierw npm run email:check.\n');
    process.exitCode = 1;
    return;
  }

  try {
    await sendTestEmail(config.smtp, args[1]);
    process.stdout.write('Serwer SMTP przyjal wiadomosc testowa. Sprawdz skrzynke odbiorcza i spam; samo przyjecie nie potwierdza doreczenia.\n');
  } catch (error) {
    const responseCode = Number.isInteger(error?.responseCode) ? ` (${error.responseCode})` : '';
    process.stderr.write(`Nie udalo sie wyslac wiadomosci testowej: ${safeErrorCode(error)}${responseCode}. Sprawdz logi dostawcy poczty.\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write('Test wysylki zakonczyl sie nieoczekiwanym bledem.\n');
    process.exitCode = 1;
  });
}

module.exports = { sendTestEmail, safeErrorCode, main };
