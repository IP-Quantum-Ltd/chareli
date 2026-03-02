import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../../.env') });

interface Config {
  env: string;
  port: number;
  storageProvider: 'r2' | 's3' | 'local';
  app: {
    clientUrl: string;
  };
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    readHost?: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
  };
  superadmin: {
    email: string;
    password: string;
  };
  smsService: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    senderName: string;
  };
  email: {
    service: string;
    user: string;
    password: string;
  };
  ses: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    fromEmail: string;
  };
  sendgrid: {
    apiKey: string;
    fromEmail: string;
  };
  otp: {
    expiryMinutes: number;
    invitationExpiryDays: number;
  };
  sentry: {
    dsn: string;
    environment: string;
    tracesSampleRate: number;
    enabled: boolean;
  };
  s3: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    endpoint?: string;
    forcePathStyle?: boolean;
    signedUrlExpiration: number;
  };
  cloudfront: {
    distributionDomain: string;
    keyPairId: string;
    cookieExpiration: number;
  };
  r2: {
    accountId: string;
    accessKeyId: string;
    bucket: string;
    secretAccessKey: string;
    publicUrl: string;
    workerJwtSecret: string;
  };
  twilio: {
    accountSid: string;
    authToken: string;
    fromNumber: string;
    enabled: boolean;
    verifySid: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    db?: number;
  };
  logging: {
    format: 'json' | 'pretty';
  };
  jsonCdn: {
    enabled: boolean;
    refreshIntervalMinutes: number;
    baseUrl: string;
  };
  cloudflare: {
    apiToken: string;
    cdnZoneId: string;
    appZoneId: string;
    webhookSecret: string;
  };
  zipProcessing: {
    mode: 'local' | 'cloudflare';
  };
}

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value) {
    return value;
  }
  if (defaultValue !== undefined) {
    return defaultValue;
  }

  if (process.env.NODE_ENV === 'production') {
    console.error(`FATAL: Environment variable ${key} is not set`);
    process.exit(1);
  }

  console.warn(`Environment variable ${key} is not set using empty string.`);

  return '';
}

const config: Config = {
  env: getEnv('NODE_ENV', 'development'),
  app: { clientUrl: getEnv('CLIENT_URL', 'http://localhost:5173') },
  storageProvider: getEnv('STORAGE_PROVIDER', 's3') as 'r2' | 's3' | 'local',
  port: parseInt(getEnv('PORT', '5000'), 10),
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'chareli_db',
    readHost: process.env.DB_READ_HOST,
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your_jwt_secret_key_here',
    expiresIn: process.env.JWT_EXPIRATION || '1h',
    refreshSecret:
      process.env.JWT_REFRESH_SECRET || 'your_refresh_token_secret_here',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRATION || '7d',
  },
  superadmin: {
    email: process.env.SUPERADMIN_EMAIL || 'admin@example.com',
    password: process.env.SUPERADMIN_PASSWORD || 'Admin123!',
  },
  smsService: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    senderName: process.env.AWS_SNS_SENDER_NAME || 'Chareli',
  },
  email: {
    service: process.env.EMAIL_SERVICE || '',
    user: process.env.EMAIL_USER || '',
    password: process.env.EMAIL_PASSWORD || '',
  },
  ses: {
    region: process.env.SES_REGION || 'eu-central-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    fromEmail:
      process.env.AWS_SES_FROM_EMAIL ||
      'no-reply@dev.chareli.reallygreattech.com',
  },
  sendgrid: {
    apiKey: process.env.SENDGRID_API_KEY || '',
    fromEmail: process.env.SENDGRID_FROM_EMAIL || 'no-reply@arcadesbox.com',
  },
  otp: {
    expiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES || '5', 10),
    invitationExpiryDays: parseInt(
      process.env.INVITATION_EXPIRY_DAYS || '7',
      10
    ),
  },
  sentry: {
    dsn: process.env.SENTRY_DSN || '',
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE || '0.2'
    ),
    enabled: false,
  },
  s3: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    bucket: process.env.AWS_S3_BUCKET || 'chareli-bucket',
    endpoint: process.env.AWS_S3_ENDPOINT,
    forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
    signedUrlExpiration: parseInt(
      process.env.AWS_SIGNED_URL_EXPIRATION || '3600',
      10
    ),
  },
  cloudfront: {
    distributionDomain: process.env.CLOUDFRONT_DISTRIBUTION_DOMAIN || '',
    keyPairId: process.env.CLOUDFRONT_KEY_PAIR_ID || '',
    cookieExpiration: 86400, // 1 day in seconds
  },
  r2: {
    accountId: getEnv('CLOUDFLARE_ACCOUNT_ID'),
    accessKeyId: getEnv('R2_ACCESS_KEY_ID'),
    bucket: getEnv('R2_BUCKET_NAME'),
    secretAccessKey: getEnv('R2_SECRET_ACCESS_KEY'),
    publicUrl: getEnv('R2_PUBLIC_URL'),
    workerJwtSecret: getEnv('WORKER_JWT_SECRET', 'your-worker-jwt-secret'),
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    fromNumber: process.env.TWILIO_FROM_NUMBER || '',
    enabled: process.env.USE_TWILIO === 'true',
    verifySid: process.env.TWILIO_SERVICE_SID || '',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0', 10),
  },
  logging: {
    format: (process.env.LOG_FORMAT || 'pretty') as 'json' | 'pretty',
  },
  jsonCdn: {
    enabled: process.env.JSON_CDN_ENABLED === 'true',
    refreshIntervalMinutes: parseInt(
      process.env.JSON_CDN_REFRESH_INTERVAL || '5',
      10
    ),
    baseUrl: process.env.JSON_CDN_BASE_URL || process.env.R2_PUBLIC_URL || '',
  },
  cloudflare: {
    apiToken: process.env.CLOUDFLARE_API_TOKEN || '',
    cdnZoneId: process.env.CLOUDFLARE_CDN_ZONE_ID || '',
    appZoneId: process.env.CLOUDFLARE_APP_ZONE_ID || '',
    webhookSecret: process.env.CLOUDFLARE_WEBHOOK_SECRET || '',
  },
  zipProcessing: {
    mode: (process.env.ZIP_PROCESSING_MODE || 'local') as 'local' | 'cloudflare',
  },
};

export default config;

