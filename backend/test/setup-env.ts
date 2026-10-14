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

// Los límites de intentos (ADR-032) son de producción: 10 logins por correo cada
// 15 min, 100 requests por minuto por usuario. La suite entra cientos de veces
// con el mismo admin y los chocaría en el primer minuto. La escala los vuelve
// inalcanzables salvo para `limites.e2e-spec.ts`, que la baja a 1 para medirlos.
process.env.LIMITES_ESCALA ??= '1000';
