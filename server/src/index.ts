import app from './app';
import { config } from './config/env';
import { prisma } from './config/database';
import { redis } from './config/redis';
import { webhookService } from './modules/integrations/webhook.service';
import { orderSlaService } from './modules/orders/order-sla.service';
import { slaTargetAlertService } from './modules/reports/sla-target-alert.service';
import { orderReturnReminderService } from './modules/orders/order-return-reminder.service';
import { emailDeliveryService } from './modules/notifications/email-delivery.service';
import { smtpSettings } from './modules/notifications/email-transport';

const log = {
  info: (...args: unknown[]) => { if (config.nodeEnv !== 'test') process.stdout.write(args.join(' ') + '\n'); },
  error: (...args: unknown[]) => { process.stderr.write(args.join(' ') + '\n'); },
};

async function main() {
  log.info('╔══════════════════════════════════════════╗');
  log.info('║         ArchiveCore Server v1.0          ║');
  log.info('╚══════════════════════════════════════════╝');
  log.info(`Environment: ${config.nodeEnv}`);
  log.info(`Email reminders: ${smtpSettings() ? 'enabled' : 'disabled (SMTP not configured)'}`);

  // Test database connection
  try {
    await prisma.$connect();
    log.info('✅ PostgreSQL — connected');
  } catch (err) {
    log.error('❌ PostgreSQL — connection error:', err);
    process.exit(1);
  }

  // Test Redis connection
  try {
    await redis.ping();
    log.info('✅ Redis — connected');
  } catch (err) {
    log.info('⚠️  Redis — not available (cache disabled):', (err as Error).message);
  }

  // Start server
  const server = app.listen(config.port, () => {
    log.info(`🚀 Server started on port ${config.port}`);
    log.info(`📡 API: http://localhost:${config.port}/api`);
    log.info(`❤️  Health: http://localhost:${config.port}/api/health`);
  });

  const deliverWebhooks = () => {
    void webhookService.processDue().catch(() => log.error('Webhook delivery worker failed; retrying later'));
  };
  const webhookTimer = setInterval(deliverWebhooks, 30_000);
  webhookTimer.unref();
  deliverWebhooks();

  let checkingSla = false;
  const checkOrderSla = () => {
    if (checkingSla) return;
    checkingSla = true;
    void orderSlaService.processDue()
      .catch(() => log.error('Order SLA escalation worker failed; retrying later'))
      .finally(() => { checkingSla = false; });
  };
  const slaTimer = setInterval(checkOrderSla, 60_000);
  slaTimer.unref();
  checkOrderSla();

  let checkingSlaTargets = false;
  const checkSlaTargets = () => {
    if (checkingSlaTargets) return;
    checkingSlaTargets = true;
    void slaTargetAlertService.processDue()
      .catch((error) => log.error('Tenant SLA target alert worker failed; retrying later:', error))
      .finally(() => { checkingSlaTargets = false; });
  };
  const slaTargetTimer = setInterval(checkSlaTargets, 6 * 60 * 60_000);
  slaTargetTimer.unref();
  checkSlaTargets();

  let checkingReturns = false;
  const checkReturns = () => {
    if (checkingReturns) return;
    checkingReturns = true;
    void orderReturnReminderService.processDue()
      .catch((error) => log.error('Loan return reminder worker failed; retrying later:', error))
      .finally(() => { checkingReturns = false; });
  };
  const returnTimer = setInterval(checkReturns, 60 * 60_000);
  returnTimer.unref();
  checkReturns();

  const deliverEmails = () => {
    void emailDeliveryService.processDue()
      .catch((error) => log.error('Email delivery worker failed; retrying later:', error));
  };
  const emailTimer = setInterval(deliverEmails, 60_000);
  emailTimer.unref();
  deliverEmails();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    clearInterval(webhookTimer);
    clearInterval(slaTimer);
    clearInterval(slaTargetTimer);
    clearInterval(returnTimer);
    clearInterval(emailTimer);
    log.info(`\n📡 Received ${signal}, shutting down...`);
    server.close(async () => {
      await prisma.$disconnect();
      redis.disconnect();
      log.info('👋 Server closed');
      process.exit(0);
    });

    // Force close after 10s
    setTimeout(() => {
      log.error('⚠️  Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch(err => {
  log.error('❌ Startup error:', err);
  process.exit(1);
});
