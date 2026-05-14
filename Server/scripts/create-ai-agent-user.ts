/**
 * Throwaway script — creates an AI-agent user with EDITOR role.
 * Usage:
 *   npx ts-node scripts/create-ai-agent-user.ts <email> [password]
 *
 * If password is omitted, a 24-byte random one is generated and printed.
 * Re-running with the same email is a no-op (logs and exits).
 */

import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { AppDataSource } from '../src/config/database';
import { User } from '../src/entities/User';
import { Role, RoleType } from '../src/entities/Role';

const [EMAIL, PASSWORD_ARG] = process.argv.slice(2);

if (!EMAIL) {
  console.error('Usage: npx ts-node scripts/create-ai-agent-user.ts <email> [password]');
  process.exit(1);
}

async function main() {
  await AppDataSource.initialize();

  const userRepo = AppDataSource.getRepository(User);
  const roleRepo = AppDataSource.getRepository(Role);

  const existing = await userRepo.findOne({ where: { email: EMAIL, isDeleted: false } });
  if (existing) {
    console.log(`User ${EMAIL} already exists (id=${existing.id}). Nothing to do.`);
    await AppDataSource.destroy();
    return;
  }

  const editorRole = await roleRepo.findOne({ where: { name: RoleType.EDITOR } });
  if (!editorRole) {
    throw new Error('Editor role not found in roles table — seed the roles first.');
  }

  const password = PASSWORD_ARG || randomBytes(24).toString('base64url');
  const hashed = await bcrypt.hash(password, 10);

  const user = userRepo.create({
    firstName: 'AI',
    lastName: 'Review Agent',
    email: EMAIL,
    password: hashed,
    role: editorRole,
    roleId: editorRole.id,
    isActive: true,
    isVerified: true,
    hasAcceptedTerms: true,
  });
  await userRepo.save(user);

  console.log('\n--- AI AGENT USER CREATED ---');
  console.log(`id:       ${user.id}`);
  console.log(`email:    ${user.email}`);
  console.log(`role:     ${editorRole.name}`);
  if (!PASSWORD_ARG) {
    console.log(`password: ${password}`);
    console.log('(generated — store it now; it is not retrievable later)');
  }
  console.log('-----------------------------\n');

  await AppDataSource.destroy();
}

main().catch(async (err) => {
  console.error(err);
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  process.exit(1);
});
