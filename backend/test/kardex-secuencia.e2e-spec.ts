import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import type { Server, AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * **La secuencia del kardex respeta el orden real de aplicación** (spec
 * `docs/superpowers/specs/2026-09-18-compras-recepcion-design.md` § 3.4).
 *
 * "Rehacer la cuenta" de compras recorre los movimientos de un producto en
 * orden, y `creado_el` no sirve para eso: es la hora en que EMPEZÓ la
 * transacción. Si varias transacciones empiezan mientras otra retiene el lock
 * del producto, se aplican en el orden en que lo consiguen, no en el que
 * empezaron.
 *
 * Este spec arma exactamente ese escenario: una "compuerta" retiene el
 * `FOR UPDATE` de `item_producto`, diez entradas concurrentes se encolan detrás
 * y se sueltan juntas. Ordenados por `secuencia`, los diez movimientos tienen
 * que encadenar sus saldos: el `stock_anterior` de cada uno es el
 * `stock_resultante` del anterior. Si la secuencia no reflejara el orden de
 * aplicación, la cadena se cortaría.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
/**
 * Cinco y no diez: cada entrada encolada retiene una conexión del pool mientras
 * espera el lock, y la compuerta y el sondeo de `pg_stat_activity` usan dos
 * más del MISMO pool (`DB_POOL_SIZE`, 10 por defecto). Con diez, el sondeo no
 * conseguía conexión y el spec caía por "timeout exceeded when trying to
 * connect" (medido). Cinco alcanzan para que el orden de adquisición del lock
 * sea el de Postgres y no el de llegada.
 */
const CONCURRENTES = 5;

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface UbicacionListada {
  id: string;
  tipo: 'local' | 'bodega';
}

describe('Kardex — la secuencia sigue el orden de aplicación (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let port: number;
  let localId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    ds = app.get(DataSource);

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
    expect(resLogin.status).toBe(200);
    const resTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set(
        'Cookie',
        (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
      )
      .set(
        'Authorization',
        `Bearer ${(resLogin.body as TokenResponse).access_token}`,
      )
      .send({ tenantId: PARIS_TENANT_ID });
    expect(resTenant.status).toBe(200);
    token = (resTenant.body as TokenResponse).access_token;

    const resUbic = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`);
    expect(resUbic.status).toBe(200);
    localId = (resUbic.body as UbicacionListada[]).find(
      (u) => u.tipo === 'local',
    )!.id;

    // Por HTTP real contra un puerto bindeado: diez requests de verdad, no
    // diez llamadas de supertest sobre el mismo agente. El host va explícito
    // por la misma razón que en `setup-supertest.ts`.
    const server = app.getHttpServer() as Server;
    if (!server.listening) {
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
    }
    port = (server.address() as AddressInfo).port;
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  it('diez entradas encoladas detrás del lock quedan en la secuencia en que se aplicaron', async () => {
    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Secuencia E2E ${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        precioBase: '1000',
        precioIncluyeImpuesto: true,
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
      });
    expect(resItem.status).toBe(201);
    const itemId = (resItem.body as IdResponse).id;

    const entrar = () =>
      fetch(`http://127.0.0.1:${port}/api/items/${itemId}/stock`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ubicacionId: localId,
          tipo: 'entrada',
          motivo: 'ajuste_manual',
          cantidad: '1',
        }),
      });

    const compuerta = ds.createQueryRunner();
    let statuses: number[] = [];
    try {
      await compuerta.connect();
      await compuerta.startTransaction();
      // El ancla del lock de `registrarMovimiento`.
      await compuerta.query(
        `SELECT 1 FROM item_producto WHERE item_id = $1 FOR UPDATE`,
        [itemId],
      );
      const pendientes = Array.from({ length: CONCURRENTES }, () => entrar());
      // Que las diez transacciones ya hayan empezado y estén esperando el lock
      // antes de soltarlo: ese es el caso en que `creado_el` miente.
      const hasta = Date.now() + 15000;
      for (;;) {
        const esperando: { n: string }[] = await ds.query(
          `SELECT COUNT(*) AS n FROM pg_stat_activity
            WHERE datname = current_database()
              AND wait_event_type = 'Lock'
              AND query LIKE '%item_producto%'`,
        );
        if (Number(esperando[0].n) >= CONCURRENTES) break;
        if (Date.now() > hasta) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      await compuerta.commitTransaction();
      const respuestas = await Promise.all(pendientes);
      statuses = respuestas.map((r) => r.status);
    } finally {
      // Si algo tiró antes del commit, `release()` solo devolvería la conexión
      // al pool CON la transacción abierta y el lock tomado: el resto de la
      // suite colgaría detrás de este producto. Rollback primero.
      if (compuerta.isTransactionActive) {
        await compuerta.rollbackTransaction();
      }
      await compuerta.release();
    }
    expect(statuses).toEqual(Array(CONCURRENTES).fill(200));

    const movs: {
      secuencia: string;
      stock_anterior: string;
      stock_resultante: string;
    }[] = await ds.query(
      `SELECT secuencia, stock_anterior, stock_resultante
         FROM movimientos_inventario
        WHERE item_id = $1 AND eliminado_el IS NULL
        ORDER BY secuencia`,
      [itemId],
    );
    expect(movs).toHaveLength(CONCURRENTES);
    for (let i = 0; i < movs.length; i++) {
      // Cada entrada suma 1 sobre lo que dejó la anterior en la secuencia.
      expect(Number(movs[i].stock_anterior)).toBe(i);
      expect(Number(movs[i].stock_resultante)).toBe(i + 1);
      if (i > 0) {
        expect(BigInt(movs[i].secuencia)).toBeGreaterThan(
          BigInt(movs[i - 1].secuencia),
        );
      }
    }
  }, 60000);
});
