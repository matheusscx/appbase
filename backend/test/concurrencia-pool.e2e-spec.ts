import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { Server, AddressInfo } from 'net';
import { AppModule } from '../src/app.module';

// Seed (IDs fijos, ver seeder.service.ts)
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

// N = tamaño del pool, leído de la misma env que `app.module.ts:160`. Fijarlo
// en 10 lo volvía mudo: con `DB_POOL_SIZE=20` la ráfaga quedaba por debajo del
// pool y el test pasaba sin ejercitar nada. El umbral medido del deadlock era
// exactamente N = tamaño del pool: 9 ok / 10 cuelga.
// `|| 10` y no `?? 10` a propósito: con `DB_POOL_SIZE=` vacío, `Number('')` es
// 0 y la ráfaga sería de cero requests — el detector mudo otra vez, por la otra
// puerta. `app.module.ts` usa `??` y en ese caso pide `poolSize: 0`, pero
// pg-pool hace `max || poolSize || 10` (`node_modules/pg-pool/index.js:89`), o
// sea que el pool efectivo sigue siendo 10: este `|| 10` espeja el pool REAL.
// `test/setup-env.ts` corre en `setupFiles`, así que `.env` ya está cargado acá.
const RAFAGA = Number(process.env.DB_POOL_SIZE || 10);

describe('Concurrencia: el pool de conexiones no se deadlockea (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let itemId: string;
  let port: number;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.use(cookieParser());
    await app.init();

    // Login en DOS pasos: el token de `/auth/login` de un usuario multi-tenant
    // sale con `tenant_id: null` y PermisosGuard lo rechaza con 403. El tenant
    // activo se fija con `switch-tenant`, que además exige la cookie de refresh
    // (mismo patrón que rbac-y-contrasena.e2e-spec.ts:47 y papelera:63).
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
        `Bearer ${(resLogin.body as { access_token: string }).access_token}`,
      )
      .send({ tenantId: PARIS_TENANT_ID });
    expect(resTenant.status).toBe(200);
    token = (resTenant.body as { access_token: string }).access_token;

    // Ítem propio, tipo servicio: sin stock → sin contaminación acumulativa
    // entre corridas locales, y sin locks de inventario que ensucien la medición.
    const item = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `E2E Ráfaga Pool ${Date.now()}`,
        precioBase: '5000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
      });
    expect(item.status).toBe(201);
    itemId = (item.body as { id: string }).id;

    // La ráfaga va por HTTP real: supertest levanta un listener efímero por
    // request y N simultáneas lo tumban con ECONNRESET — fallaría siempre,
    // por la razón equivocada (ver rbac-y-contrasena.e2e-spec.ts:330).
    const server = app.getHttpServer() as Server;
    if (!server.listening) {
      await new Promise<void>((resolve) => server.listen(0, resolve));
    }
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    // Acumular fallos de limpieza y afirmar DESPUÉS de app.close(): un expect
    // que tira antes de cerrar deja el pool abierto y jest no termina nunca
    // (medido: 7 min colgado; patrón de caja-testigo.e2e-spec.ts).
    const fallos: string[] = [];
    try {
      if (itemId) {
        const res = await request(app.getHttpServer())
          .delete(`/api/items/${itemId}`)
          .set('Authorization', `Bearer ${token}`);
        if (res.status !== 200) fallos.push(`DELETE item: ${res.status}`);
      }
    } finally {
      await app.close();
    }
    expect(fallos).toEqual([]);
  });

  it(`${RAFAGA} ventas simultáneas (= tamaño del pool) responden todas y el backend sigue vivo`, async () => {
    const respuestas = await Promise.all(
      Array.from({ length: RAFAGA }, () =>
        fetch(`http://127.0.0.1:${port}/api/ventas`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            canal: 'online', // caja virtual: sin depender de una caja abierta
            lineas: [{ itemId, cantidad: '1' }],
            pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000.0000' }],
          }),
        }),
      ),
    );

    expect(respuestas.map((r) => r.status)).toEqual(
      Array.from({ length: RAFAGA }, () => 201),
    );

    // El 201 solo no alcanza: un arreglo que respondiera OK sin escribir nada
    // pasaría igual el `expect` de arriba. Cada venta trae su `id`, los 10 son
    // distintos (nada de responder 201 repitiendo la misma fila) y al menos
    // una resuelve por GET — la prueba de que quedó persistida de verdad, no
    // solo devuelta en memoria.
    const cuerpos = (await Promise.all(respuestas.map((r) => r.json()))) as {
      id: string;
    }[];
    const ids = cuerpos.map((v) => v.id);
    expect(ids).toHaveLength(RAFAGA);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(
      true,
    );
    expect(new Set(ids).size).toBe(RAFAGA);

    const detalle = await fetch(
      `http://127.0.0.1:${port}/api/ventas/${ids[0]}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    expect(detalle.status).toBe(200);
    const ventaDetalle = (await detalle.json()) as { id: string };
    expect(ventaDetalle.id).toBe(ids[0]);

    // Y el proceso no quedó envenenado: la request siguiente también responde.
    const despues = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
    });
    expect(despues.status).toBe(200);
  }, 60_000);
});
