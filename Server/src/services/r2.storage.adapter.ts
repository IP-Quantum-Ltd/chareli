import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
  S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import mime from 'mime-types';
import crypto from 'crypto';

import { IStorageService, UploadResult } from './storage.interface';
import config from '../config/config';
import logger from '../utils/logger';

/**
 * An adapter for the IStorageService interface that connects to Cloudflare R2.
 * It leverages R2's S3-compatible API.
 */
export class R2StorageAdapter implements IStorageService {
  private s3Client: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor() {
    // These are the R2-specific credentials and endpoint from our config
    const r2AccountId = config.r2.accountId;
    const endpoint = `https://${r2AccountId}.r2.cloudflarestorage.com`;

    const s3ClientConfig: S3ClientConfig = {
      region: 'auto', // R2 requires 'auto'
      endpoint: endpoint, // This is the key that points the SDK to R2
      credentials: {
        accessKeyId: config.r2.accessKeyId,
        secretAccessKey: config.r2.secretAccessKey,
      },
    };

    logger.info(`Initializing storage adapter for Cloudflare R2`);
    this.s3Client = new S3Client(s3ClientConfig);
    this.bucket = config.r2.bucket; // Your R2 bucket name
    this.publicUrl = config.r2.publicUrl; // e.g., https://games.yourdomain.com
  }

  /**
   * @inheritdoc
   */
  getPublicUrl(key: string): string {
    // This simply prepends the base public URL of our Worker to the storage key.
    return `${this.publicUrl}/${key}`;
  }

  /**
   * @inheritdoc
   */
  async generatePresignedUrl(
    key: string,
    contentType: string
  ): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType || 'application/octet-stream',
        CacheControl: 'public, max-age=31536000, immutable', // 1 year cache
      });

      const url = await getSignedUrl(this.s3Client, command, {
        expiresIn: 3600,
      });
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
   * @inheritdoc
   */
  async uploadFile(
    file: Buffer,
    originalname: string,
    contentType: string,
    folder: string = 'files'
  ): Promise<UploadResult> {
    try {
      const fileId = uuidv4();
      const extension = path.extname(originalname);
      const filename = path
        .basename(originalname, extension)
        .replace(/\s+/g, '-')
        .toLowerCase();

      // The key is the full path in the bucket, e.g., "thumbnails/123-abc-my-image.jpg"
      const key = `${folder}/${fileId}-${filename}${extension}`;

      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable', // 1 year cache
      });

      await this.s3Client.send(command);
      logger.info(`Successfully uploaded file to R2 with key: ${key}`);

      return {
        key,
        publicUrl: this.getPublicUrl(key),
      };
    } catch (error) {
      logger.error('Error uploading file to R2:', { error, originalname });
      throw new Error(
        `Failed to upload file to R2: ${(error as Error).message}`
      );
    }
  }

  /**
   * @inheritdoc
   */
  async uploadDirectory(localPath: string, remotePath: string): Promise<void> {
    try {
      const files = await fs.readdir(localPath, { withFileTypes: true });

      for (const file of files) {
        const fullLocalPath = path.join(localPath, file.name);
        const fullRemotePath = path
          .join(remotePath, file.name)
          .replace(/\\/g, '/');

        if (file.isDirectory()) {
          // Recursively upload subdirectories
          await this.uploadDirectory(fullLocalPath, fullRemotePath);
        } else {
          // Upload the file
          const fileContent = await fs.readFile(fullLocalPath);
          const contentType =
            mime.lookup(fullLocalPath) || 'application/octet-stream';

          const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: fullRemotePath,
            Body: fileContent,
            ContentType: contentType,
            CacheControl: 'public, max-age=31536000, immutable', // 1 year cache
          });

          await this.s3Client.send(command);
        }
      }
      logger.info(
        `Successfully uploaded directory "${localPath}" to R2 at "${remotePath}"`
      );
    } catch (error) {
      logger.error('Error uploading directory to R2:', {
        error,
        localPath,
        remotePath,
      });
      throw new Error(
        `Failed to upload directory to R2: ${(error as Error).message}`
      );
    }
  }

  /**
   * @inheritdoc
   */
  async downloadFile(key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        throw new Error('No file content received');
      }

      const buffer = Buffer.from(await response.Body.transformToByteArray());
      logger.info(`Successfully downloaded file from R2 with key: ${key}`);
      return buffer;
    } catch (error) {
      logger.error('Error downloading file from R2:', { error, key });
      throw new Error(
        `Failed to download file from R2: ${(error as Error).message}`
      );
    }
  }

  /**
   * @inheritdoc
   */
  async deleteFile(key: string): Promise<boolean> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      logger.info(`Successfully deleted file from R2 with key: ${key}`);
      return true;
    } catch (error) {
      logger.error('Error deleting file from R2:', { error, key });
      // Don't throw, just return false for a failed deletion
      return false;
    }
  }

  /**
   * Move/copy file from temporary location to permanent location within R2
   * Uses S3 CopyObject for efficient server-side copy (80-90% faster than download/upload)
   */
  async moveFile(sourceKey: string, destinationKey: string): Promise<string> {
    const startTime = Date.now();
    try {
      // First, get the source object metadata to preserve content type
      const headCommand = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: sourceKey,
      });

      const headResponse = await this.s3Client.send(headCommand);
      const contentType =
        headResponse.ContentType || 'application/octet-stream';
      const fileSize = headResponse.ContentLength || 0;

      // Use CopyObject for efficient server-side copy (no data transfer through app)
      const copyCommand = new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${sourceKey}`,
        Key: destinationKey,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable', // 1 year cache
        MetadataDirective: 'REPLACE', // Replace to add CacheControl
      });

      await this.s3Client.send(copyCommand);

      // Delete the source file after successful copy
      await this.deleteFile(sourceKey);

      const duration = Date.now() - startTime;
      logger.info(
        `[PERF] File move completed in ${duration}ms (${(
          fileSize /
          1024 /
          1024
        ).toFixed(2)}MB) - ${sourceKey} → ${destinationKey}`
      );

      return destinationKey;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[PERF] File move failed after ${duration}ms:`, {
        error,
        sourceKey,
        destinationKey,
      });
      throw new Error(`Failed to move file in R2: ${(error as Error).message}`);
    }
  }

  /**
   * Upload file with exact key (no UUID prefix or modifications)
   * Useful for CDN JSON files that need predictable paths
   * Returns both the key and ETag for cache validation
   */
  async uploadWithExactKey(
    key: string,
    body: Buffer,
    contentType: string,
    metadata?: Record<string, string>,
    cacheControl?: string
  ): Promise<{ key: string; etag: string }> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        Metadata: metadata,
        CacheControl: cacheControl || 'public, max-age=31536000, immutable',
      });

      const response = await this.s3Client.send(command);
      const etag = response.ETag?.replace(/"/g, '') || ''; // Remove quotes from ETag

      logger.info(`Successfully uploaded file to R2 with exact key: ${key}, ETag: ${etag}`);

      return { key, etag };
    } catch (error) {
      logger.error('Error uploading file with exact key to R2:', {
        error,
        key,
      });
      throw new Error(
        `Failed to upload file to R2: ${(error as Error).message}`
      );
    }
  }

  /**
   * Get the ETag of an existing object via HEAD request (cheap operation)
   * Returns null if object doesn't exist
   */
  async getObjectETag(key: string): Promise<string | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      return response.ETag?.replace(/"/g, '') || null;
    } catch (error: any) {
      // Object doesn't exist
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      logger.error('Error getting object ETag from R2:', { error, key });
      throw new Error(
        `Failed to get object ETag: ${(error as Error).message}`
      );
    }
  }

  /**
   * Get ETag + cache-control + content-type in a single HEAD request. Used by
   * uploadIfChanged so we can detect when content is unchanged but the header
   * policy has changed (e.g. we shipped a new Cache-Control and want it to
   * propagate to already-stable files on the next write-cycle).
   */
  async getObjectHeaders(
    key: string
  ): Promise<{ etag: string | null; cacheControl: string | null; contentType: string | null }> {
    try {
      const response = await this.s3Client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
      );
      return {
        etag: response.ETag?.replace(/"/g, '') || null,
        cacheControl: response.CacheControl || null,
        contentType: response.ContentType || null,
      };
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return { etag: null, cacheControl: null, contentType: null };
      }
      logger.error('Error getting object headers from R2:', { error, key });
      throw new Error(
        `Failed to get object headers: ${(error as Error).message}`
      );
    }
  }

  /**
   * Calculate MD5 hash of content (matches R2's ETag for non-multipart uploads)
   */
  private calculateMD5(content: Buffer): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Conditionally upload file only if content has changed
   * Compares MD5 hash with existing ETag to avoid unnecessary uploads
   * Saves R2 write operations and bandwidth costs
   * 
   * @returns uploaded: true if file was uploaded, false if skipped
   * @returns etag: The ETag (either existing or new)
   * @returns skipped: true if upload was skipped due to no changes
   */
  async uploadIfChanged(
    key: string,
    body: Buffer,
    contentType: string,
    metadata?: Record<string, string>,
    cacheControl?: string
  ): Promise<{ key: string; etag: string; uploaded: boolean; skipped: boolean }> {
    const startTime = Date.now();

    try {
      // Calculate MD5 of new content
      const newETag = this.calculateMD5(body);

      // One HEAD round-trip gives us everything we need to decide: ETag,
      // existing Cache-Control, existing Content-Type. Class B operation.
      const existing = await this.getObjectHeaders(key);

      // Skip only when content AND response headers match what's already
      // live. If the Cache-Control or Content-Type policy changed in code
      // (e.g. we shipped a new cache header), we force a re-upload even for
      // byte-for-byte identical content so the new header reaches R2 / the
      // edge / browsers.
      const contentMatches = existing.etag !== null && existing.etag === newETag;
      const cacheControlMatches =
        cacheControl === undefined || existing.cacheControl === cacheControl;
      const contentTypeMatches =
        existing.contentType === null || existing.contentType === contentType;

      if (contentMatches && cacheControlMatches && contentTypeMatches) {
        const duration = Date.now() - startTime;
        logger.info(
          `[OPTIMIZATION] Skipped upload (content + headers unchanged) in ${duration}ms: ${key}, ETag: ${newETag}`
        );
        return {
          key,
          etag: newETag,
          uploaded: false,
          skipped: true,
        };
      }

      if (contentMatches && (!cacheControlMatches || !contentTypeMatches)) {
        logger.info(
          `[OPTIMIZATION] Header policy changed for ${key} (cacheControl: "${existing.cacheControl}" → "${cacheControl}", contentType: "${existing.contentType}" → "${contentType}") — forcing re-upload`
        );
      }

      // Content changed or doesn't exist - proceed with upload
      const result = await this.uploadWithExactKey(
        key,
        body,
        contentType,
        metadata,
        cacheControl
      );

      const duration = Date.now() - startTime;
      logger.info(
        `[OPTIMIZATION] Uploaded (content changed) in ${duration}ms: ${key}, ETag: ${result.etag}`
      );

      return {
        ...result,
        uploaded: true,
        skipped: false,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`[OPTIMIZATION] Conditional upload failed after ${duration}ms:`, {
        error,
        key,
      });
      throw new Error(
        `Failed to conditionally upload file: ${(error as Error).message}`
      );
    }
  }
}
