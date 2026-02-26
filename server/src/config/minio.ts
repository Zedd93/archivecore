import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from './env';

export const s3Client = new S3Client({
  endpoint: `http${config.minio.useSSL ? 's' : ''}://${config.minio.endpoint}:${config.minio.port}`,
  region: 'us-east-1',
  credentials: {
    accessKeyId: config.minio.accessKey,
    secretAccessKey: config.minio.secretKey,
  },
  forcePathStyle: true,
});

export async function uploadFile(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await s3Client.send(new PutObjectCommand({
    Bucket: config.minio.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

export async function getPresignedUrl(key: string, expiresIn = 900): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: config.minio.bucket,
    Key: key,
  });
  return getSignedUrl(s3Client, command, { expiresIn });
}

export async function deleteFile(key: string): Promise<void> {
  await s3Client.send(new DeleteObjectCommand({
    Bucket: config.minio.bucket,
    Key: key,
  }));
}
