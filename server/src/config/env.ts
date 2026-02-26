import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

  database: {
    url: process.env.DATABASE_URL || 'postgresql://archivecore:archivecore123@localhost:5432/archivecore',
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  minio: {
    endpoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    accessKey: process.env.MINIO_ACCESS_KEY || 'archivecore',
    secretKey: process.env.MINIO_SECRET_KEY || 'archivecore123',
    bucket: process.env.MINIO_BUCKET || 'archivecore-files',
    useSSL: process.env.MINIO_USE_SSL === 'true',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-in-production',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  encryption: {
    key: process.env.ENCRYPTION_KEY || 'dev-encryption-key-32-bytes-long!',
  },
};
