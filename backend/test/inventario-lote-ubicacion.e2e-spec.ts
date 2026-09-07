import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * Tarea 7 del plan de bodegas
 * (`docs/superpowers/plans/2026-09-06-bodegas-y-traslados.md`): un mismo lote
 * (`item_lote`, modo `lote`) puede tener saldo partido entre dos
 * ubicaciones. `item_lote.cantidad_disponible` (un escalar por lote)
 * desapareció; el saldo vive en `lote_ubicacion`, una fila por
 * `(lote_id, ubicacion_id)`, y `stock_ubicacion` se recalcula sumándola.
 * Lo que NO se parte es la identidad del lote — `codigo_lote`,
 * `fecha_elaboracion`, `fecha_vencimiento` siguen en `item_lote`, una sola
 * fila por lote.
 *
 * ✅ **Sin muleta desde la Tarea 9.** `PATCH /items/:id/stock` sigue entrando y
 * saliendo solo del local (`ItemsService.ajustarStock` resuelve
 * `UbicacionesService.localDe` y no acepta `ubicacionId`), así que hasta el
 * 2026-09-07 la única forma de que un lote tuviera saldo EN LA BODEGA era un
 * `INSERT` directo a `lote_ubicacion`. Ahora el saldo se reparte con
 * `POST /traslados`, que además prueba que la ENTRADA de un traslado no
 * engorda `item_lote.cantidad_inicial` ni duplica la fila del lote.
 *
 * El test de "no se puede sacar más de lo que hay en esa ubicación" sigue
 * pidiendo la salida por `PATCH /items/:id/stock` —o sea DESDE el local, que
 * es lo único que ese endpoint sabe hacer— con el lote teniendo MÁS saldo en
 * la bodega que en el local: si el chequeo mirara el total del lote en vez del
 * saldo de la ubicación, pasaría cuando no debe.
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
interface DesgloseLote {
  ubicacionId: string;
  nombre: string;
  cantidad: string;
}
interface LoteResponse {
  id: string;
  codigoLote: string;
  fechaVencimiento: string | null;
  cantidadDisponible: string;
  desglosePorUbicacion: DesgloseLote[];
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

describe('inventario — lotes por ubicación (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let localId: string;
  let bodegaId: string;

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

    // La bodega demo del seed (`seedUbicaciones`), no una creada por el
    // spec: así este archivo no necesita `POST /ubicaciones` para armar el
    // escenario.
    const bodegaRows: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones
        WHERE tenant_id = $1 AND tipo = 'bodega' AND eliminado_el IS NULL
        LIMIT 1`,
      [PARIS_TENANT_ID],
    );
    bodegaId = bodegaRows[0].ubicacion_id;
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
   * Mueve saldo de un lote del local a la bodega por la API real. Es lo que
   * reemplazó a la muleta: y de paso prueba que la ENTRADA del traslado no
   * engorda `item_lote.cantidad_inicial` ni duplica la fila del lote.
   */
  async function trasladarALaBodega(
    itemId: string,
    loteId: string,
    cantidad: string,
  ): Promise<void> {
    const res = await request(app.getHttpServer())
      .post('/api/traslados')
      .set('Authorization', `Bearer ${token}`)
      .send({
        origenId: localId,
        destinoId: bodegaId,
        motivoTrasladoId: await motivoTrasladoId(),
        lineas: [{ itemId, cantidad, loteId }],
      });
    expect(res.status).toBe(201);
  }

  async function crearItemLote(nombre: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre,
        precioBase: '5000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        modoInventario: 'lote',
      });
    expect(res.status).toBe(201);
    return (res.body as ItemResponse).id;
  }

  it('el mismo lote puede tener saldo en dos ubicaciones', async () => {
    const itemId = await crearItemLote(
      `Lote dos-ubicaciones E2E ${Date.now()}-${Math.random()}`,
    );
    const codigoLote = `L1-${Date.now()}`;

    // 8 en el local, por la API real.
    const resEntrada = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        ubicacionId: localId,
        cantidad: '13',
        costoUnitario: '1000',
        lote: { codigoLote, fechaVencimiento: '2027-06-01' },
      });
    expect(resEntrada.status).toBe(200);

    const resLotesAntes = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/lotes`)
      .set('Authorization', `Bearer ${token}`);
    expect(resLotesAntes.status).toBe(200);
    const loteId = (resLotesAntes.body as LoteResponse[])[0].id;

    // 5 de esos 13 se van a la bodega POR LA API: quedan 8 en el local y 5 en
    // la bodega. Números distintos (8/5) a propósito: con cantidades iguales
    // un mutante que sumara TODOS los lotes del ítem en vez de acotar por
    // ubicación sobreviviría sin que ningún assert lo note.
    await trasladarALaBodega(itemId, loteId, '5');

    // El desglose y el total, por la API.
    const resLotes = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/lotes`)
      .set('Authorization', `Bearer ${token}`);
    expect(resLotes.status).toBe(200);
    const lote = (resLotes.body as LoteResponse[])[0];
    expect(lote.cantidadDisponible).toBe('13.0000');
    const porUbicacion = new Map(
      lote.desglosePorUbicacion.map((d) => [d.ubicacionId, d.cantidad]),
    );
    expect(porUbicacion.get(localId)).toBe('8.0000');
    expect(porUbicacion.get(bodegaId)).toBe('5.0000');

    // Y `stock_ubicacion` —el saldo materializado que de verdad usa el resto
    // del sistema (ventas, listados)— quedó en 8 en el local y 5 en la
    // bodega, no 13 en cada una: lo recalculó `recalcularStockLote` sumando
    // SOLO `lote_ubicacion` de esa ubicación. Ahora las DOS filas se pueden
    // afirmar, porque el traslado pasa por `registrarMovimiento` en las dos
    // puntas.
    const saldos: { ubicacion_id: string; stock: string }[] = await ds.query(
      `SELECT ubicacion_id, stock FROM stock_ubicacion WHERE item_id = $1`,
      [itemId],
    );
    const stockPorUbicacion = new Map(
      saldos.map((r) => [r.ubicacion_id, r.stock]),
    );
    expect(stockPorUbicacion.get(localId)).toBe('8.0000');
    expect(stockPorUbicacion.get(bodegaId)).toBe('5.0000');

    // Y el lote NO se infló: `cantidad_inicial` sigue siendo lo que entró a la
    // empresa (13), no 18. Es el bug que la entrada del traslado tiene que no
    // cometer — sumar de nuevo al lote lo que solo cambió de lugar.
    const filasLote: { cantidad_inicial: string }[] = await ds.query(
      `SELECT cantidad_inicial FROM item_lote WHERE lote_id = $1`,
      [loteId],
    );
    expect(filasLote).toHaveLength(1);
    expect(Number(filasLote[0].cantidad_inicial)).toBe(13);
  });

  it('una salida de lote no puede sacar de una ubicación más de lo que ese lote tiene ahí', async () => {
    const itemId = await crearItemLote(
      `Lote salida-ubicación E2E ${Date.now()}-${Math.random()}`,
    );
    const codigoLote = `L2-${Date.now()}`;

    // 5 en el local, por la API real.
    const resEntrada = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        ubicacionId: localId,
        cantidad: '25',
        costoUnitario: '1000',
        lote: { codigoLote, fechaVencimiento: '2027-06-01' },
      });
    expect(resEntrada.status).toBe(200);

    const resLotesAntes = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/lotes`)
      .set('Authorization', `Bearer ${token}`);
    expect(resLotesAntes.status).toBe(200);
    const loteId = (resLotesAntes.body as LoteResponse[])[0].id;

    // 20 se van a la bodega: quedan 5 en el local. La bodega tiene MÁS que el
    // local, y más que los 8 que se van a pedir — si el chequeo mirara el
    // total del lote (25) en vez del saldo de la ubicación que recibe la
    // salida (el local, 5), esto pasaría cuando no debería.
    await trasladarALaBodega(itemId, loteId, '20');

    const resSalida = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'salida',
        motivo: 'ajuste_manual',
        ubicacionId: localId,
        cantidad: '8',
        loteId,
      });

    expect(resSalida.status).toBe(400);
    const mensaje = (resSalida.body as { message: string }).message;
    expect(mensaje).toContain(codigoLote);
    expect(mensaje).toContain('esta ubicación');

    // Y la salida rechazada no dejó rastro: ni el local ni la bodega se
    // tocaron.
    const saldos: { ubicacion_id: string; cantidad: string }[] = await ds.query(
      `SELECT ubicacion_id, cantidad FROM lote_ubicacion WHERE lote_id = $1`,
      [loteId],
    );
    const porUbicacion = new Map(
      saldos.map((r) => [r.ubicacion_id, r.cantidad]),
    );
    expect(porUbicacion.get(localId)).toBe('5.0000');
    expect(porUbicacion.get(bodegaId)).toBe('20.0000');
  });

  it('el vencimiento del lote es uno solo, no cambia por ubicación', async () => {
    const itemId = await crearItemLote(
      `Lote vencimiento-único E2E ${Date.now()}-${Math.random()}`,
    );
    const codigoLote = `L3-${Date.now()}`;
    const vencimiento = '2028-01-15';

    const resEntrada = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        ubicacionId: localId,
        cantidad: '5',
        costoUnitario: '1000',
        lote: { codigoLote, fechaVencimiento: vencimiento },
      });
    expect(resEntrada.status).toBe(200);

    const resLotesAntes = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/lotes`)
      .set('Authorization', `Bearer ${token}`);
    expect(resLotesAntes.status).toBe(200);
    const loteId = (resLotesAntes.body as LoteResponse[])[0].id;

    // Saldo del mismo lote también en la bodega — la partición del saldo no
    // tiene por qué tocar la identidad del lote. 3 y 2, no números iguales.
    await trasladarALaBodega(itemId, loteId, '2');

    // `item_lote` sigue teniendo UNA sola fila para este lote, con UN solo
    // `fecha_vencimiento` — no se duplicó por ubicación. La partición vive
    // en `lote_ubicacion` (dos filas: local y bodega), no acá.
    const filasLote: { fecha_vencimiento: Date }[] = await ds.query(
      `SELECT fecha_vencimiento FROM item_lote WHERE lote_id = $1`,
      [loteId],
    );
    expect(filasLote).toHaveLength(1);
    expect(
      new Date(filasLote[0].fecha_vencimiento).toISOString().slice(0, 10),
    ).toBe(vencimiento);

    const filasUbicacion: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM lote_ubicacion WHERE lote_id = $1`,
      [loteId],
    );
    expect(filasUbicacion).toHaveLength(2);

    // Y la API expone el mismo dato único, no uno por fila del desglose.
    const resLotes = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/lotes`)
      .set('Authorization', `Bearer ${token}`);
    expect(resLotes.status).toBe(200);
    const lote = (resLotes.body as LoteResponse[])[0];
    expect(lote.fechaVencimiento?.slice(0, 10)).toBe(vencimiento);
  });
});
