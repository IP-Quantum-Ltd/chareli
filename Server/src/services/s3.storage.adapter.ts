import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import mime from 'mime-types';

import { IStorageService, UploadResult } from './storage.interface';
import config from '../config/config';
import logger from '../utils/logger';
import { instrumentStorage, logUploadEvent, toErrorFields } from '../utils/uploadEvents';

/**
 * An adapter for the IStorageService interface that connects to AWS S3.
 */
export class S3StorageAdapter implements IStorageService {
  private s3Client: S3Client;
  private bucket: string;
  private region: string;

  constructor() {
    // This is the AWS S3-specific configuration
    const s3ClientConfig: S3ClientConfig = {
      region: config.s3.region,
    };

    // Only add credentials if they are present (for local dev with IAM user)
    // In production on ECS, this will use the Task Role automatically.
    if (config.s3.accessKeyId && config.s3.secretAccessKey) {
      s3ClientConfig.credentials = {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      };
    }

    logger.info(`Initializing storage adapter for AWS S3`);
    this.s3Client = new S3Client(s3ClientConfig);
    this.bucket = config.s3.bucket;
    this.region = config.s3.region;
  }

  /**
   * @inheritdoc
   */
  getPublicUrl(key: string): string {
    // For AWS S3, we construct the standard S3 object URL.
    // If you were using CloudFront in front of S3, this is where you'd construct the CloudFront URL.
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }

  /**
   * @inheritdoc
   */
  async generatePresignedUrl(key: string, contentType: string): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType || 'application/octet-stream',
      });

      const url = await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
      logger.info(`Generated presigned URL for key: ${key}`);
      return url;
    } catch (error) {
      logger.error('Error generating presigned URL:', { error, key });
      throw new Error(
        `Failed to generate presigned URL: ${(error as Error).message}`
      );
    }
  }

  /**
   * The implementation for the following methods is identical to the R2 adapter
   * because they both use the same underlying AWS SDK commands.
   */

  async uploadFile(
    file: Buffer,
    originalname: string,
    contentType: string,
    folder: string = 'files'
  ): Promise<UploadResult> {
    const fileId = uuidv4();
    const extension = path.extname(originalname);
    const filename = path
      .basename(originalname, extension)
      .replace(/\s+/g, '-')
      .toLowerCase();
    const key = `${folder}/${fileId}-${filename}${extension}`;

    return instrumentStorage(
      'storage.upload',
      {
        provider: 's3',
        bucket: this.bucket,
        fileKey: key,
        fileSize: file.length,
        mime: contentType,
      },
      async () => {
        const command = new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file,
          ContentType: contentType,
        });
        await this.s3Client.send(command);
        return { key, publicUrl: this.getPublicUrl(key) };
      }
    );
  }

  async uploadDirectory(localPath: string, remotePath: string): Promise<void> {
    return instrumentStorage(
      'storage.upload_directory',
      { provider: 's3', bucket: this.bucket, fileKey: remotePath, localPath },
      async () => {
        const files = await fs.readdir(localPath, { withFileTypes: true });
        for (const file of files) {
          const fullLocalPath = path.join(localPath, file.name);
          const fullRemotePath = path
            .join(remotePath, file.name)
            .replace(/\\/g, '/');
          if (file.isDirectory()) {
            await this.uploadDirectory(fullLocalPath, fullRemotePath);
          } else {
            const fileContent = await fs.readFile(fullLocalPath);
            const contentType =
              mime.lookup(fullLocalPath) || 'application/octet-stream';
            const command = new PutObjectCommand({
              Bucket: this.bucket,
              Key: fullRemotePath,
              Body: fileContent,
              ContentType: contentType,
            });
            await this.s3Client.send(command);
          }
        }
      }
    );
  }

  async downloadFile(key: string): Promise<Buffer> {
    return instrumentStorage(
      'storage.download',
      { provider: 's3', bucket: this.bucket, fileKey: key },
      async () => {
        const response = await this.s3Client.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: key })
        );
        if (!response.Body) {
          throw new Error('No file content received');
        }
        return Buffer.from(await response.Body.transformToByteArray());
      }
    );
  }

  async deleteFile(key: string): Promise<boolean> {
    const started = Date.now();
    const ctx = { provider: 's3', bucket: this.bucket, fileKey: key };
    logUploadEvent('storage.delete.start', ctx);
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
      );
      logUploadEvent('storage.delete.complete', {
        ...ctx,
        durationMs: Date.now() - started,
      });
      return true;
    } catch (error) {
      logUploadEvent(
        'storage.delete.failed',
        { ...ctx, durationMs: Date.now() - started, ...toErrorFields(error) },
        'error'
      );
      return false;
    }
  }

  async moveFile(sourceKey: string, destinationKey: string): Promise<string> {
    return instrumentStorage(
      'storage.move',
      {
        provider: 's3',
        bucket: this.bucket,
        fileKey: destinationKey,
        sourceKey,
      },
      async () => {
        const sourceObject = await this.s3Client.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: sourceKey })
        );
        if (!sourceObject.Body) {
          throw new Error('Source file has no content');
        }
        const contentType = sourceObject.ContentType || 'application/octet-stream';
        const buffer = Buffer.from(
          await sourceObject.Body.transformToByteArray()
        );
        await this.s3Client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: destinationKey,
            Body: buffer,
            ContentType: contentType,
          })
        );
        await this.deleteFile(sourceKey);
        return destinationKey;
      }
    );
  }
}
