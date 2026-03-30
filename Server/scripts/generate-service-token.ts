/**
 * One-shot script to generate a non-expiry service account token.
 * Run: npx ts-node scripts/generate-service-token.ts
 *
 * Prints the access token to stdout. Store it in ai-agent/.env as ARCADE_API_TOKEN.
 * Delete this script after use — do not commit the output token.
 */

import 'dotenv/config';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { AppDataSource } from '../src/config/database';
import { User } from '../src/entities/User';
import config from '../src/config/config';

const [EMAIL, PASSWORD] = process.argv.slice(2);

if (!EMAIL || !PASSWORD) {
  console.error('Usage: npx ts-node scripts/generate-service-token.ts <email> <password>');
  process.exit(1);
}

async function main() {
  await AppDataSource.initialize();

  const user = await AppDataSource.getRepository(User).findOne({
    where: { email: EMAIL, isDeleted: false },
    relations: ['role'],
    select: {
      id: true,
      email: true,
      password: true,
      isActive: true,
      isVerified: true,
      role: { name: true },
    },
  });

  if (!user) {
    console.error('User not found');
    process.exit(1);
  }

  if (!user.isActive) {
    console.error('Account is inactive');
    process.exit(1);
  }

  const valid = await bcrypt.compare(PASSWORD, user.password);
  if (!valid) {
    console.error('Invalid password');
    process.exit(1);
  }

  const payload = { userId: user.id, email: user.email, role: user.role.name };

  // No expiresIn — matches the server's generateTokens behaviour
  const token = jwt.sign(payload, config.jwt.secret);

  console.log('\n--- SERVICE ACCOUNT TOKEN ---');
  console.log(token);
  console.log('\nRole:', user.role.name);
  console.log('UserId:', user.id);
  console.log('\nAdd to ai-agent/.env as:');
  console.log(`ARCADE_API_TOKEN=${token}`);
  console.log('-----------------------------\n');

  await AppDataSource.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
