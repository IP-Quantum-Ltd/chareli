import { DataSource } from 'typeorm';
import config from './config';
import path from 'path';

const commonOptions = {
  type: 'postgres' as const,
  synchronize: false,
  logging: false, // Set to false to disable SQL query logs
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  entities: [path.join(__dirname, '../entities/**/*.{ts,js}')],
  migrations: [path.join(__dirname, '../migrations/**/*.{ts,js}')],
  subscribers: [path.join(__dirname, '../subscribers/**/*.{ts,js}')],
  extra: {
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    // Environment-based connection pooling for Supabase
    // Respects Supavisor pooler limits based on compute tier
    //
    // CRITICAL: Increased pool size to handle JSON CDN generation background jobs
    // JSON generation runs every 2-5 min and needs 3-5 connections temporarily
    //
    // Supabase Micro (dev): 200 max pooler clients
    // - 20 instances × 15 = 300 connections (not safe, use lower per-instance)
    // - Current: 15 connections per instance (safe for dev/staging)
    //
    // Production: Adjust based on Supabase tier
    // - Small (400 pooler): 50 instances × 15 = 300 (75% capacity, safe)
    // - Medium (600 pooler): 50 instances × 20 = 400 (67% capacity, safe)
    max: config.env === 'production' ? 3 : 5,

    // Connection management
    connectionTimeoutMillis: 30000, // 30s connection timeout
    statement_timeout: 60000, // 60s statement timeout

    // Ensure connections are released promptly
    idleTimeoutMillis: 10000, // Reduced from 30s - release idle connections faster

    // Minimum pool size (0 = lazy connect, no connections held open)
    min: 0,
  },
};

// Use replication if a read host is configured
// This allows offloading read queries to a replica (slave)
const dataSourceOptions = config.database.readHost
  ? {
      ...commonOptions,
      replication: {
        master: {
          host: config.database.host,
          port: config.database.port,
          username: config.database.username,
          password: config.database.password,
          database: config.database.database,
        },
        slaves: [
          {
            host: config.database.readHost,
            port: config.database.port,
            username: config.database.username,
            password: config.database.password,
            database: config.database.database,
          },
        ],
      },
    }
  : {
      ...commonOptions,
      host: config.database.host,
      port: config.database.port,
      username: config.database.username,
      password: config.database.password,
      database: config.database.database,
    };

// If DATABASE_URL is set, use it directly (supports Neon, Supabase, etc.)
const finalDataSourceOptions = process.env.DATABASE_URL
  ? {
      ...commonOptions,
      url: process.env.DATABASE_URL,
    }
  : dataSourceOptions;

// Cast to any because TypeORM types struggle with the conditional replication union
export const AppDataSource = new DataSource(finalDataSourceOptions as any);

export const initializeDatabase = async (): Promise<void> => {
  try {
    await AppDataSource.initialize();
    console.log('Database connection established');
  } catch (error) {
    console.error('Error connecting to database:', error);
    throw error;
  }
};
