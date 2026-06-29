import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../.env') });

// When E2E tests run on the host (not inside Docker), the DB host must be localhost
if (process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    /@postgres:/,
    '@localhost:',
  );
}
