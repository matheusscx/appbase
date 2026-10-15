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

// CifradoDteService (módulo dte) tira error en el constructor si falta su clave, y
// AppModule la construye al bootear. Los
// `.env` de los worktrees creados antes del 2026-10-14 no la tienen: sin este
// default, todo e2e de ese worktree muere al arrancar. Valor de test (32 bytes b64),
// el mismo de `.env.example`.
process.env.DTE_ENCRYPTION_KEY ??=
  'JLHn+lnKC1wCp+GmSRpUyuuBf8uwR18F9KyNsn24ews=';

// Los jobs de la cola de envío al SII corren solos cada 30 s. En los e2e los dispara cada test a
// mano: un tick automático a mitad de un test podría tomar sus boletas, y las URLs por defecto
// son las del SII de verdad.
process.env.DTE_COLA_AUTOMATICA ??= 'false';

// El proveedor de software que firma RutProvSW/RznSocProvSW en cada boleta: configuración del
// sistema, no del tenant. Sin estas dos el perfil fiscal trae SIN_PROVEEDOR_SOFTWARE y no se
// puede encender la emisión. Valores de prueba (el RUT es válido).
process.env.DTE_PROVEEDOR_RUT ??= '76222333-3';
process.env.DTE_PROVEEDOR_RAZON_SOCIAL ??= 'Proveedor de prueba SpA';
