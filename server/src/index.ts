import app from './app';
import { config } from './config/env';
import { prisma } from './config/database';
import { redis } from './config/redis';

const log = {
  info: (...args: unknown[]) => { if (config.nodeEnv !== 'test') process.stdout.write(args.join(' ') + '\n'); },
  error: (...args: unknown[]) => { process.stderr.write(args.join(' ') + '\n'); },
};

async function main() {
  log.info('╔══════════════════════════════════════════╗');
  log.info('║         ArchiveCore Server v1.0          ║');
  log.info('╚══════════════════════════════════════════╝');
  log.info(`Environment: ${config.nodeEnv}`);

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

  // Graceful shutdown
  const shutdown = async (signal: string) => {
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
