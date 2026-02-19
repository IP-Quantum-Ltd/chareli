/**
 * Debug Controller - For checking environment variables and config
 * IMPORTANT: Should be protected or disabled in production
 */

import { Request, Response } from 'express';
import config from '../config/config';

/**
 * Mask sensitive values - show only last 4 characters
 */
function maskValue(value: string | undefined): string {
  if (!value || value === '') {
    return '[NOT SET]';
  }
  if (value.length <= 4) {
    return '***';
  }
  return '...' + value.slice(-4);
}

/**
 * Debug endpoint to check config values
 */
export const debugConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const debugInfo = {
      timestamp: new Date().toISOString(),
      nodeEnv: process.env.NODE_ENV,
      
      // ZIP Processing Config
      zipProcessing: {
        exists: !!config.zipProcessing,
        mode: config.zipProcessing?.mode || '[UNDEFINED]',
        envVar: process.env.ZIP_PROCESSING_MODE || '[NOT SET IN ENV]',
      },
      
      // Cloudflare Config
      cloudflare: {
        webhookSecretExists: !!config.cloudflare?.webhookSecret,
        webhookSecretMasked: maskValue(config.cloudflare?.webhookSecret),
        webhookSecretEnv: maskValue(process.env.CLOUDFLARE_WEBHOOK_SECRET),
        apiTokenExists: !!config.cloudflare?.apiToken,
        apiTokenMasked: maskValue(config.cloudflare?.apiToken),
        cdnZoneIdMasked: maskValue(config.cloudflare?.cdnZoneId),
      },
      
      // Storage Config
      storage: {
        provider: config.storageProvider,
        providerEnv: process.env.STORAGE_PROVIDER || '[NOT SET]',
      },
      
      // Redis Config
      redis: {
        host: config.redis?.host,
        port: config.redis?.port,
        passwordExists: !!config.redis?.password,
      },
      
      // R2 Config (masked)
      r2: {
        accountIdMasked: maskValue(config.r2?.accountId),
        bucketExists: !!config.r2?.bucket,
        publicUrlMasked: maskValue(config.r2?.publicUrl),
      },
      
      // Config object structure check
      configStructure: {
        hasZipProcessing: 'zipProcessing' in config,
        hasCloudflare: 'cloudflare' in config,
        configKeys: Object.keys(config),
      },
    };

    res.status(200).json({
      success: true,
      debug: debugInfo,
      warning: 'This endpoint should be disabled in production!',
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack,
    });
  }
};
