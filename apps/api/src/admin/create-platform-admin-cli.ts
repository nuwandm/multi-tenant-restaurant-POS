// Creates a platform admin, or makes an existing user one.
//   pnpm platform:admin you@example.com "Your Name"
// Uses PLATFORM_ADMIN_PASSWORD if set, otherwise generates a password and prints it once.
// Connects with DATABASE_URL, which must be allowed to write platform_admins (the migration owner).
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../auth/pin';
import { createSql } from '../db/client';

const [email, name = 'Platform admin'] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!email || !url) {
  console.error('Usage: pnpm platform:admin <email> [name]   (needs DATABASE_URL)');
  process.exit(1);
}

const password = process.env.PLATFORM_ADMIN_PASSWORD ?? randomBytes(12).toString('base64url');
const sql = createSql(url);
try {
  const passwordHash = await hashPassword(password);
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, display_name, password_hash)
    VALUES (${email}, ${name}, ${passwordHash})
    ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash
    RETURNING id`;
  await sql`INSERT INTO platform_admins (user_id) VALUES (${user!.id}) ON CONFLICT DO NOTHING`;
  console.log(`Platform admin: ${email}`);
  if (!process.env.PLATFORM_ADMIN_PASSWORD) console.log(`Password (shown once): ${password}`);
} finally {
  await sql.end();
}
