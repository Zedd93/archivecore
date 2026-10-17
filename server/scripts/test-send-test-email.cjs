const assert = require('node:assert/strict');
const test = require('node:test');
const { sendTestEmail, safeErrorCode } = require('./send-test-email.cjs');

const settings = {
  host: 'smtp.example.com', port: 587, secure: false,
  user: 'app@example.com', password: 'secret', from: 'ArchiveCore <app@example.com>',
  publicUrl: 'https://archivecore.example.com',
};

test('sends one neutral email and closes the SMTP connection', async () => {
  let options;
  let message;
  let closed = false;
  await sendTestEmail(settings, 'biuro@doxart.pl', (smtpOptions) => {
    options = smtpOptions;
    return {
      sendMail: async (mail) => {
        message = mail;
        return { accepted: ['biuro@doxart.pl'], rejected: [] };
      },
      close: () => { closed = true; },
    };
  });
  assert.equal(options.auth.user, settings.user);
  assert.equal(message.from, settings.from);
  assert.equal(message.to, 'biuro@doxart.pl');
  assert.match(message.subject, /test/i);
  assert.doesNotMatch(message.text, /orders\//);
  assert.equal(closed, true);
});

test('rejects unaccepted recipient and closes the connection', async () => {
  let closed = false;
  await assert.rejects(
    sendTestEmail(settings, 'biuro@doxart.pl', () => ({
      sendMail: async () => ({ accepted: [], rejected: ['biuro@doxart.pl'] }),
      close: () => { closed = true; },
    })),
    { code: 'RECIPIENT_REJECTED' },
  );
  assert.equal(closed, true);
});

test('sanitizes SMTP errors before printing them', () => {
  assert.equal(safeErrorCode({ code: 'EAUTH' }), 'EAUTH');
  assert.equal(safeErrorCode({ code: 'password=secret' }), 'UNKNOWN');
});
