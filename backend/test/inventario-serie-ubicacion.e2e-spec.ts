import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * Tarea 6 del plan de bodegas
 * (`docs/superpowers/plans/2026-09-06-bodegas-y-traslados.md`): cada unidad
 * serializada (`item_unidad`, modo `serie`) sabe en qué ubicación está —
 * `item_unidad.ubicacion_id`— y el saldo de `stock_ubicacion` en ese modo se
 * recalcula contando SOLO las unidades de esa ubicación.
 *
 * ✅ **Sin muleta desde la Tarea 9.** `PATCH /items/:id/stock` siempre entra al
 * local (`ItemsService.ajustarStock` resuelve `UbicacionesService.localDe`),
 * así que hasta el 2026-09-07 la única forma de tener una unidad físicamente
 * EN LA BODEGA era un `INSERT` directo a `item_unidad`. Ahora la unidad se
 * mueve con `POST /traslados`, que es además la prueba de que el traslado en
 * modo `serie` deja la unidad **disponible** en el destino en vez de darla de
 * baja: una unidad que se traslada no salió del inventario, cambió de lugar.
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
interface UnidadResponse {
  id: string;
  serie: string;
  ubicacionId: string;
}
interface ItemDetalleResponse {
  id: string;
  stockVendible: string;
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

describe('inventario — unidades serializadas por ubicación (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let localId: string;
  let bodegaId: string;
  let bodegaNombre: string;

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

    const localRows: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones
        WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID],
    );
    localId = localRows[0].ubicacion_id;

    // La bodega demo del seed (`seedUbicaciones`), no una creada por el spec:
    // así este archivo no necesita el endpoint POST /ubicaciones para armar
    // el escenario.
    const bodegaRows: { ubicacion_id: string; nombre: string }[] =
      await ds.query(
        `SELECT ubicacion_id, nombre FROM ubicaciones
          WHERE tenant_id = $1 AND tipo = 'bodega' AND eliminado_el IS NULL
          LIMIT 1`,
        [PARIS_TENANT_ID],
      );
    bodegaId = bodegaRows[0].ubicacion_id;
    bodegaNombre = bodegaRows[0].nombre;
  });

  afterAll(async () => {
    await app.close();
  });

  /** El primer motivo de traslado del tenant (los cinco fijos vienen del seed). */
  async function motivoTrasladoId(): Promise<string> {
    const res = await request(app.getHttpServer())
      .get('/api/motivos-traslado')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as { id: string }[])[0].id;
  }

  /**
   * Una unidad con esa serie, nacida en el local y trasladada a la bodega por
   * la API. Devuelve su `unidad_id`.
   */
  async function unidadEnLaBodega(
    itemId: string,
    serie: string,
  ): Promise<string> {
    const resEntrada = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        ubicacionId: localId,
        cantidad: '1',
        series: [{ serie }],
      });
    expect(resEntrada.status).toBe(200);

    const resUnidades = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/unidades`)
      .set('Authorization', `Bearer ${token}`);
    expect(resUnidades.status).toBe(200);
    const unidad = (resUnidades.body as UnidadResponse[]).find(
      (u) => u.serie === serie,
    );
    expect(unidad).toBeDefined();

    const resTraslado = await request(app.getHttpServer())
      .post('/api/traslados')
      .set('Authorization', `Bearer ${token}`)
      .send({
        origenId: localId,
        destinoId: bodegaId,
        motivoTrasladoId: await motivoTrasladoId(),
        lineas: [{ itemId, cantidad: '1', unidadIds: [unidad!.id] }],
      });
    expect(resTraslado.status).toBe(201);
    return unidad!.id;
  }

  async function crearItemSerie(nombre: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        modoInventario: 'serie',
      });
    expect(res.status).toBe(201);
    return (res.body as ItemResponse).id;
  }

  it('la unidad nace en la ubicación del movimiento (el local, por la API real)', async () => {
    const itemId = await crearItemSerie(
      `Serie ubicación E2E ${Date.now()}-${Math.random()}`,
    );

    const resEntrada = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        ubicacionId: localId,
        cantidad: '1',
        series: [{ serie: `IMEI-LOCAL-${Date.now()}` }],
      });
    expect(resEntrada.status).toBe(200);

    const resUnidades = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/unidades`)
      .set('Authorization', `Bearer ${token}`);
    expect(resUnidades.status).toBe(200);
    const unidades = resUnidades.body as UnidadResponse[];
    expect(unidades).toHaveLength(1);
    expect(unidades[0].ubicacionId).toBe(localId);
  });

  it('una salida serie solo consume unidades de esa ubicación', async () => {
    const itemId = await crearItemSerie(
      `Serie salida-ubicación E2E ${Date.now()}-${Math.random()}`,
    );
    const serieBodega = `IMEI-BODEGA-${Date.now()}`;

    // La unidad nace en el local y se MUEVE a la bodega por la API real.
    const unidadBodegaId = await unidadEnLaBodega(itemId, serieBodega);

    // Salida en el LOCAL pidiendo la unidad que está en la bodega.
    const resSalida = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'salida',
        motivo: 'ajuste_manual',
        ubicacionId: localId,
        cantidad: '1',
        unidadIds: [unidadBodegaId],
      });

    expect(resSalida.status).toBe(400);
    const mensaje = (resSalida.body as { message: string }).message;
    expect(mensaje).toContain(serieBodega);
    expect(mensaje).toContain(bodegaNombre);

    // Y la unidad sigue disponible y en la bodega: la salida rechazada no
    // tiene que dejar rastro.
    const filas: { estado: string; ubicacion_id: string }[] = await ds.query(
      `SELECT estado, ubicacion_id FROM item_unidad WHERE unidad_id = $1`,
      [unidadBodegaId],
    );
    expect(filas[0].estado).toBe('disponible');
    expect(filas[0].ubicacion_id).toBe(bodegaId);
  });

  it('stock_ubicacion se recalcula contando solo las unidades de esa ubicación', async () => {
    const itemId = await crearItemSerie(
      `Serie recálculo-ubicación E2E ${Date.now()}-${Math.random()}`,
    );

    // 5 unidades entran al local, y 2 se van a la bodega por la API: quedan 3
    // en el local. Si el recálculo contara todas las unidades disponibles del
    // ítem (el bug de antes de esta tarea, cuando la columna no existía), el
    // local quedaría en 5 en vez de 3. 3 y 2 a propósito, no números iguales.
    const marca = `${Date.now()}-${Math.random()}`;
    const resEntrada = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        ubicacionId: localId,
        cantidad: '5',
        series: [
          { serie: `IMEI-LOCAL-A-${marca}` },
          { serie: `IMEI-LOCAL-B-${marca}` },
          { serie: `IMEI-LOCAL-C-${marca}` },
          { serie: `IMEI-BODEGA-A-${marca}` },
          { serie: `IMEI-BODEGA-B-${marca}` },
        ],
      });
    expect(resEntrada.status).toBe(200);

    const resUnidades = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/unidades`)
      .set('Authorization', `Bearer ${token}`);
    expect(resUnidades.status).toBe(200);
    const aMover = (resUnidades.body as UnidadResponse[])
      .filter((u) => u.serie.startsWith('IMEI-BODEGA-'))
      .map((u) => u.id);
    expect(aMover).toHaveLength(2);

    const resTraslado = await request(app.getHttpServer())
      .post('/api/traslados')
      .set('Authorization', `Bearer ${token}`)
      .send({
        origenId: localId,
        destinoId: bodegaId,
        motivoTrasladoId: await motivoTrasladoId(),
        lineas: [{ itemId, cantidad: '2', unidadIds: aMover }],
      });
    expect(resTraslado.status).toBe(201);

    const resDetalle = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDetalle.status).toBe(200);
    // `stockVendible` es el stock DEL LOCAL (ver tabla de nombres del plan):
    // 3, no 5 — las 2 unidades de la bodega no cuentan acá.
    expect((resDetalle.body as ItemDetalleResponse).stockVendible).toBe(
      '3.0000',
    );
  });
});
