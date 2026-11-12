import postgres from 'postgres';
import { migrate } from './migrate';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = postgres(url, { onnotice: () => {} });
try {
  const applied = await migrate(sql);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
} finally {
  await sql.end();
}
