import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { opcionesTypeOrm } from './typeorm.config';

/**
 * El DataSource de la CLI de TypeORM (`npm run migration:*`), y nada más: la app
 * arma el suyo en `app.module.ts` con las mismas opciones (`opcionesTypeOrm`).
 *
 * Se corre desde el host, así que hace lo mismo que `test/setup-env.ts`: toma
 * el `.env` de la raíz si `DATABASE_URL` no vino del entorno, y cambia el host
 * `postgres` —el nombre del servicio adentro del compose— por `localhost`. En
 * un worktree el `.env` ya trae `localhost` y el puerto propio (`entorno.sh`).
 */
if (!process.env.DATABASE_URL) {
  process.loadEnvFile(resolve(__dirname, '../../../.env'));
  process.env.DATABASE_URL = process.env.DATABASE_URL?.replace(
    /@postgres:/,
    '@localhost:',
  );
}

// Sin URL, `pg` caería en silencio a sus defaults (`localhost:5432`), que en un
// worktree es la base del checkout principal: mejor no conectar.
if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL vacía: ni el entorno ni el .env de la raíz la traen.',
  );
}

export default new DataSource(opcionesTypeOrm(process.env.DATABASE_URL));
