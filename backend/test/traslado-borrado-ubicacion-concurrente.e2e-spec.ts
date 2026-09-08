import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import type { Server, AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

// Seed (IDs fijos, ver seeder.service.ts)
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface UbicacionListada {
  id: string;
  nombre: string;
  tipo: 'local' | 'bodega';
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUÉ PRUEBA ESTE SPEC Y QUÉ NO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PRUEBA: lo que levantó la revisión de rama del frente "bodegas y traslados"
 * (el workspace de esa revisión se borró al cerrar el frente; lo durable está
 * en `docs/features/bodegas-y-traslados.md`). `UbicacionesService.remove` era
 * un check-then-act sin transacción ni lock:
 * `TrasladosService.crearEnTransaccion` podía escribir saldo en una ubicación
 * mientras `remove()` contaba 0 stock (statement previo, sin ver ese commit) y
 * borraba la fila — el stock quedaba colgado de una bodega borrada, invisible
 * en el desglose por ubicación pero todavía sumado al total del catálogo.
 *
 * CÓMO: el interleaving es DETERMINISTA, no una ráfaga probabilística — misma
 * técnica que `sobreventa-concurrente-ubicacion.e2e-spec.ts`. Una compuerta
 * (un `QueryRunner` propio, fuera de Nest) retiene con `FOR UPDATE` la fila de
 * `item_producto` del ítem a trasladar —la misma que `TrasladosService` usa de
 * ancla— mientras el traslado y el borrado entran y se encolan detrás:
 *
 *   compuerta: FOR UPDATE item_producto      → retiene la fila ancla
 *   traslado:  POST /traslados (bodega dest) → SELECT ubicaciones FOR SHARE
 *                                               (rápido, nadie más la toca) y
 *                                               se encola en el ancla
 *   borrado:   DELETE /ubicaciones/:bodegaId → SELECT ubicaciones FOR UPDATE;
 *                                               el traslado ya tiene el FOR
 *                                               SHARE → se encola DETRÁS del
 *                                               traslado (no de la compuerta)
 *   compuerta: ROLLBACK                      → el traslado entra, lockea el
 *                                               ítem, escribe saldo, commitea
 *                                               → el borrado despierta con su
 *                                               FOR UPDATE recién ahí
 *
 * Sin el `FOR SHARE` del traslado y el `FOR UPDATE` + transacción del borrado,
 * el `DELETE` no tiene ningún lock que lo frene: corre sus tres pasos sueltos
 * apenas llega (cuenta 0, porque el traslado todavía no escribió nada) y borra
 * la ubicación ANTES de que el traslado —ya validado, ya con la ubicación en
 * memoria— escriba saldo ahí. Con el arreglo, el `DELETE` queda detrás del
 * `FOR SHARE` del traslado y su `COUNT` lee el saldo recién commiteado: la
 * ubicación sobrevive con un 400, no un 204.
 *
 * `esperandoLockEnLaCompuerta` es lo que separa este verde del verde de una
 * compuerta que no enganchó: cuenta las sesiones en `pg_stat_activity` con
 * `wait_event_type = 'Lock'` justo antes de soltar. Con el arreglo puesto son
 * DOS — el traslado esperando la compuerta, el borrado esperando al traslado
 * — aunque estén encoladas en dos recursos distintos (`item_producto` y la
 * fila de `ubicaciones`): Postgres retiene cualquier lock ya adquirido por una
 * transacción aunque esa misma transacción esté bloqueada en otro lado.
 *
 * NO PRUEBA:
 * - El caso simétrico (borrado gana la carrera primero): ese lado ya lo cubre
 *   la lectura de `remove()` en su forma actual —`FOR UPDATE` sobre la fila de
 *   `ubicaciones` bloquea cualquier `SELECT ... FOR SHARE` posterior del
 *   traslado hasta que el borrado commitea, y ese `SELECT` after-borrado ya no
 *   encuentra la fila (`eliminado_el IS NULL`), así que el traslado sale con
 *   404 — es lectura de código, no un caso con interleaving propio que valga
 *   una segunda compuerta.
 * - Traslados con más de una línea o con item_unidad/lote_ubicacion: la
 *   carrera es sobre el lock de `ubicaciones`, no sobre el modo de inventario.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('Borrado de ubicación concurrente con un traslado hacia ella (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let port: number;
  let itemId: string;
  let localId: string;
  let bodegaId: string;
  let motivoId: string;

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

    // Bodega PROPIA del spec: la borramos (o lo intentamos) durante el test,
    // así que compartirla con otro spec la volvería dependiente del orden.
    const resBodega = await request(app.getHttpServer())
      .post('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Bodega carrera borrado E2E ${Date.now()}`,
        tipo: 'bodega',
      });
    expect(resBodega.status).toBe(201);
    bodegaId = (resBodega.body as IdResponse).id;

    const resMotivos = await request(app.getHttpServer())
      .get('/api/motivos-traslado?soloActivas=true')
      .set('Authorization', `Bearer ${token}`);
    expect(resMotivos.status).toBe(200);
    motivoId = (resMotivos.body as IdResponse[])[0].id;

    // Producto propio del spec con 10 en el local: el traslado se lleva 5 a
    // la bodega, y eso es lo que la carrera pone en juego.
    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Carrera borrado ubicación E2E ${Date.now()}`,
        precioBase: '1000',
        precioIncluyeImpuesto: true,
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '10',
        costo: '500',
      });
    expect(resItem.status).toBe(201);
    itemId = (resItem.body as IdResponse).id;

    const server = app.getHttpServer() as Server;
    if (!server.listening) {
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
    }
    port = (server.address() as AddressInfo).port;
  }, 120000);

  afterAll(async () => {
    // Acumular fallos y afirmar DESPUÉS de `app.close()`: un expect que tira
    // antes de cerrar deja el pool abierto y jest no termina nunca.
    const fallos: string[] = [];
    try {
      // Si el test pasó (arreglo puesto), la bodega sigue viva con 5 de
      // stock: hay que devolverlo antes de poder borrar item y bodega. Si el
      // test corrió sobre código sin el arreglo, la bodega ya está borrada y
      // este traslado de vuelta 404-ea — se tolera, no es lo que se limpia acá.
      const resVuelta = await request(app.getHttpServer())
        .post('/api/traslados')
        .set('Authorization', `Bearer ${token}`)
        .send({
          origenId: bodegaId,
          destinoId: localId,
          motivoTrasladoId: motivoId,
          lineas: [{ itemId, cantidad: '5' }],
        });
      if (resVuelta.status !== 201 && resVuelta.status !== 404) {
        fallos.push(`traslado de vuelta: ${resVuelta.status}`);
      }

      if (itemId) {
        const res = await request(app.getHttpServer())
          .delete(`/api/items/${itemId}`)
          .set('Authorization', `Bearer ${token}`);
        if (res.status !== 200) fallos.push(`DELETE item: ${res.status}`);
      }
      if (bodegaId) {
        const res = await request(app.getHttpServer())
          .delete(`/api/ubicaciones/${bodegaId}`)
          .set('Authorization', `Bearer ${token}`);
        // Puede llegar ya borrada (404) si el traslado de vuelta también lo
        // estaba (bodega ya eliminada por un run anterior sin el arreglo);
        // 204 es el caso normal.
        if (res.status !== 204 && res.status !== 404) {
          fallos.push(`DELETE ubicación: ${res.status}`);
        }
      }
    } finally {
      await app.close();
    }
    expect(fallos).toEqual([]);
  });

  /** Sesiones frenadas en un lock ahora mismo. Es lo que separa el verde real
   * del verde de una compuerta que no enganchó. */
  const esperandoLock = async (): Promise<number> => {
    const filas: { count: string }[] = await ds.query(
      `SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    return Number(filas[0].count);
  };

  const dispararTraslado = () => () =>
    fetch(`http://127.0.0.1:${port}/api/traslados`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        origenId: localId,
        destinoId: bodegaId,
        motivoTrasladoId: motivoId,
        lineas: [{ itemId, cantidad: '5' }],
      }),
    });

  const dispararBorrado = () => () =>
    fetch(`http://127.0.0.1:${port}/api/ubicaciones/${bodegaId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

  it('el traslado que está escribiendo stock en la bodega gana: el borrado espera y rebota con 400, no borra la ubicación con saldo colgado', async () => {
    const compuerta = ds.createQueryRunner();
    let esperandoLockEnLaCompuerta = -1;
    let statusTraslado = -1;
    let statusBorrado = -1;
    let cuerpoBorrado: unknown = null;
    try {
      await compuerta.connect();
      await compuerta.startTransaction();
      // La MISMA fila que `TrasladosService.crearEnTransaccion` usa de ancla
      // (`FOR UPDATE OF ip`).
      await compuerta.query(
        `SELECT item_id FROM item_producto WHERE item_id = $1 FOR UPDATE`,
        [itemId],
      );

      const traslado = dispararTraslado()();
      // El traslado toma su `FOR SHARE` sobre `ubicaciones` en su primera
      // sentencia, bien antes de encolarse en la compuerta: 600ms sobra para
      // que eso ya haya pasado cuando disparamos el borrado.
      await dormir(600);
      const borrado = dispararBorrado()();
      await dormir(600);

      esperandoLockEnLaCompuerta = await esperandoLock();
      await compuerta.rollbackTransaction();

      const [rTraslado, rBorrado] = await Promise.all([traslado, borrado]);
      statusTraslado = rTraslado.status;
      statusBorrado = rBorrado.status;
      cuerpoBorrado = await rBorrado.json();
    } finally {
      if (compuerta.isTransactionActive) await compuerta.rollbackTransaction();
      await compuerta.release();
    }

    // Las dos estaban encoladas de verdad.
    expect(esperandoLockEnLaCompuerta).toBe(2);

    // El traslado pasa siempre (nunca lo bloqueó nada más que la compuerta).
    expect(statusTraslado).toBe(201);

    // Lo que el 400 custodia en este interleaving: el borrado NO puede
    // completarse con saldo recién escrito en esa ubicación. Antes del arreglo
    // esto daba 204 y la ubicación quedaba borrada con 5 de stock colgado.
    expect(statusBorrado).toBe(400);
    expect(JSON.stringify(cuerpoBorrado)).toContain('todavía tiene');

    // La ubicación sigue viva.
    const ubicRows: { eliminado_el: string | null }[] = await ds.query(
      `SELECT eliminado_el FROM ubicaciones WHERE ubicacion_id = $1`,
      [bodegaId],
    );
    expect(ubicRows).toHaveLength(1);
    expect(ubicRows[0].eliminado_el).toBeNull();

    // Y el stock que el traslado escribió sigue ahí, no colgado de nada: la
    // ubicación que lo tiene existe.
    const saldoBodega: { stock: string }[] = await ds.query(
      `SELECT stock FROM stock_ubicacion WHERE item_id = $1 AND ubicacion_id = $2`,
      [itemId, bodegaId],
    );
    expect(saldoBodega).toHaveLength(1);
    expect(Number(saldoBodega[0].stock)).toBe(5);
  }, 60000);
});
