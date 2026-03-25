import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

const url = process.env.DATABASE_URL ||
  `postgresql://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_DATABASE}${process.env.DB_SSL === 'true' ? '?sslmode=require' : ''}`;

export default defineConfig({
  dialect: 'postgresql',
  dbCredentials: { url },
});
