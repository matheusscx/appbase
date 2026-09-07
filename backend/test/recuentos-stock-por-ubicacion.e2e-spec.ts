import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * Red de la Tarea 3b (GIRAR 2/2) del plan de bodegas:
 * `docs/superpowers/plans/2026-09-06-bodegas-y-traslados.md`.
 *
 * ⚠️ **Este spec afirmaba lo contrario hasta el 2026-09-06** —que `stockSistema`
 * congelaba el TOTAL del tenant— y esa conducta resultó ser un bug, no un
 * contrato. El congelado tomaba la suma de todas las ubicaciones y el `aplicar`
 * posteaba el delta **solo contra el local** (`recuentos.service.ts`), así que
 * los dos números no hablaban de lo mismo. Era inofensivo mientras todo el stock
 * vivía en el local; con stock repartido en bodega se vuelve una salida
 * fantasma: un producto con 40 en el local y 15 en la bodega se le muestra al
 * operador como 55, el operador cuenta 40, y aplicar descuenta 15 del local sin
 * que se haya movido nada.
 *
 * Lo que este spec fija ahora: **congelado y aplicación miran la misma
 * ubicación, el local.** Es el tapón, no el diseño final — el recuento por
 * ubicación (elegir en cuál se cuenta) llega en la Tarea 11 del mismo plan, y
 * ahí este spec se vuelve a escribir para afirmar la ubicación elegida.
 *
 * ⚠️ Misma muleta declarada que `items-stock-por-ubicacion.e2e-spec.ts`: el
 * stock de la bodega se planta con SQL directo a `stock_ubicacion` porque
 * `POST /traslados` todavía no existe (Tarea 9 del plan).
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface ItemResponse {
  id: string;
}
interface UbicacionResponse {
  id: string;
}
interface RecuentoCreateResponse {
  id: string;
}
interface RecuentoLinea {
  lineaId: string;
  itemId: string;
  stockSistema: string;
}
interface RecuentoAplicarResponse {
  lineasAplicadas: number;
}
interface MotivoDiferenciaItem {
  id: string;
  nombre: string;
}
interface RecuentoDetalleResponse {
  lineas: RecuentoLinea[];
}

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  expect(resLogin.status).toBe(200);
  const initialToken = (resLogin.body as TokenResponse).access_token;

  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  expect(resTenant.status).toBe(200);
  return (resTenant.body as TokenResponse).access_token;
}

describe('Recuentos — stock por ubicación (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
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
    token = await login(app);

    const rows: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones
        WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID],
    );
    localId = rows[0].ubicacion_id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('stockSistema congela el saldo del LOCAL, que es contra el que se aplica el delta', async () => {
    // 1. Una bodega nueva para este tenant.
    const resBodega = await request(app.getHttpServer())
      .post('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Bodega recuento E2E ${Date.now()}`,
        tipo: 'bodega',
      });
    expect(resBodega.status).toBe(201);
    const bodegaId = (resBodega.body as UbicacionResponse).id;

    // 2. Un producto nuevo, por cantidad (el recuento solo admite ese modo).
    const nombreItem = `Item recuento E2E ${Date.now()}-${Math.random()}`;
    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: nombreItem,
        precioBase: '1000',
        precioIncluyeImpuesto: true,
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
      });
    expect(resItem.status).toBe(201);
    const itemId = (resItem.body as ItemResponse).id;

    // 3. 10 en el local, por la API real (compra sin `ubicacionId` cae en el
    // local por default).
    await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: '10',
        costoUnitario: '500',
      })
      .expect(200);

    // 4. 20 en la bodega — la muleta declarada arriba. 10 y 20 a propósito,
    // no números iguales: así un mutante que lea el total donde va el local
    // (o viceversa) no sobrevive.
    await ds.query(
      `INSERT INTO stock_ubicacion (item_id, ubicacion_id, stock) VALUES ($1, $2, '20.0000')`,
      [itemId, bodegaId],
    );

    // 5. Crear la sesión de recuento y verificar que `stockSistema` congeló
    // el saldo del LOCAL (10), no el total del tenant (30). Si congelara 30, el
    // operador que cuenta lo que ve en el salón guardaría una diferencia de −18
    // en vez de +2, y aplicar postearía una salida de 18 del local en lugar de
    // una entrada de 2: stock destruido por un conteo correcto.
    const resCrear = await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemIds: [itemId] });
    expect(resCrear.status).toBe(201);
    const recuentoId = (resCrear.body as RecuentoCreateResponse).id;

    const resDetalle = await request(app.getHttpServer())
      .get(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDetalle.status).toBe(200);
    const linea = (resDetalle.body as RecuentoDetalleResponse).lineas.find(
      (l) => l.itemId === itemId,
    );
    expect(linea).toBeDefined();
    expect(linea!.stockSistema).toBe('10.0000');

    // 6. Y la otra mitad del par, que es la que el bug desalineaba: dónde
    // ATERRIZA el delta. El conteo va a 12 —**distinto** del congelado a
    // propósito—: con 12 el delta es +2 y `aplicar` sí llama a
    // `registrarMovimiento`. Contar 10 dejaría el delta en cero,
    // `lineasAAplicar` vacío, y el `aplicar` cortaría antes de resolver
    // siquiera la ubicación: el test pasaría sin ejercitar la mitad que dice
    // medir.
    const resMotivos = await request(app.getHttpServer())
      .get('/api/motivos-diferencia-inventario')
      .set('Authorization', `Bearer ${token}`);
    expect(resMotivos.status).toBe(200);
    const motivo = (resMotivos.body as MotivoDiferenciaItem[])[0];
    expect(motivo).toBeDefined();

    await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}/lineas/${linea!.lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidadContada: '12', motivoDiferenciaId: motivo.id })
      .expect(200);

    const resAplicar = await request(app.getHttpServer())
      .post(`/api/recuentos/${recuentoId}/aplicar`)
      .set('Authorization', `Bearer ${token}`);
    expect(resAplicar.status).toBe(201);
    expect((resAplicar.body as RecuentoAplicarResponse).lineasAplicadas).toBe(
      1,
    );

    // El delta aterrizó en el LOCAL: 10 + 2 = 12, y la bodega quedó intacta.
    // Si `aplicar` posteara contra la bodega, esto sería local 10 / bodega 22.
    const saldos: { ubicacion_id: string; stock: string }[] = await ds.query(
      `SELECT ubicacion_id, stock FROM stock_ubicacion WHERE item_id = $1`,
      [itemId],
    );
    const porUbicacion = new Map(saldos.map((r) => [r.ubicacion_id, r.stock]));
    expect(porUbicacion.get(localId)).toBe('12.0000');
    expect(porUbicacion.get(bodegaId)).toBe('20.0000');

    // Y un solo movimiento, de 2, en el local. El `ubicacion_id` se afirma
    // directo y no por su efecto: es la columna que un mutante cambiaría.
    const movs: { tipo: string; cantidad: string; ubicacion_id: string }[] =
      await ds.query(
        `SELECT tipo, cantidad, ubicacion_id FROM movimientos_inventario
          WHERE item_id = $1 AND motivo = 'recuento' AND eliminado_el IS NULL`,
        [itemId],
      );
    expect(movs).toHaveLength(1);
    expect(movs[0].tipo).toBe('entrada');
    expect(Number(movs[0].cantidad)).toBe(2);
    expect(movs[0].ubicacion_id).toBe(localId);
  });
});
