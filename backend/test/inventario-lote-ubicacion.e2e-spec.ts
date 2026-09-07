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
 * ⚠️ **Muleta declarada, no patrón a copiar** (misma razón que
 * `inventario-serie-ubicacion.e2e-spec.ts`): `PATCH /items/:id/stock`
 * siempre entra/sale del local (`ItemsService.ajustarStock` resuelve
 * `UbicacionesService.localDe` y no acepta `ubicacionId`) y `POST
 * /traslados` todavía no existe (Tarea 9), así que la única forma de que un
 * lote tenga saldo EN LA BODEGA es un `INSERT` directo a `lote_ubicacion`.
 * Cuando exista el endpoint, este spec se reescribe para mover el lote por
 * la API real.
 *
 * Por la misma razón, el test de "no se puede sacar más de lo que hay en
 * esa ubicación" no puede pedir la salida DESDE la bodega (no hay forma de
 * apuntar el movimiento ahí por HTTP todavía): en cambio, el lote tiene MÁS
 * saldo total en la bodega (muleta) que en el local, y la salida —forzada al
 * local por el endpoint— tiene que rechazar igual, probando que el chequeo
 * mira el saldo de la ubicación y no el total del lote.
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
        cantidad: '8',
        costoUnitario: '1000',
        lote: { codigoLote, fechaVencimiento: '2027-06-01' },
      });
    expect(resEntrada.status).toBe(200);

    const resLotesAntes = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/lotes`)
      .set('Authorization', `Bearer ${token}`);
    expect(resLotesAntes.status).toBe(200);
    const loteId = (resLotesAntes.body as LoteResponse[])[0].id;

    // 5 en la bodega — la muleta declarada arriba (sin `POST /traslados`,
    // solo un `INSERT` directo puede plantar saldo del MISMO lote en otro
    // lugar). Números distintos (8/5) a propósito: con cantidades iguales un
    // mutante que sumara TODOS los lotes del ítem en vez de acotar por
    // ubicación sobreviviría sin que ningún assert lo note.
    await ds.query(
      `INSERT INTO lote_ubicacion (lote_id, ubicacion_id, cantidad)
       VALUES ($1, $2, '5.0000')`,
      [loteId, bodegaId],
    );

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

    // Y `stock_ubicacion` del LOCAL —el saldo materializado que de verdad
    // usa el resto del sistema (ventas, listados)— quedó en 8, no en 13: lo
    // recalculó `recalcularStockLote` sumando SOLO `lote_ubicacion` de esa
    // ubicación. (La bodega no tiene fila propia en `stock_ubicacion` en
    // este test: la muleta de arriba planta `lote_ubicacion` directo, sin
    // pasar por `registrarMovimiento` — el único que la recalcula —, así que
    // no hay nada que afirmar ahí sin `POST /traslados`.)
    const saldos: { ubicacion_id: string; stock: string }[] = await ds.query(
      `SELECT ubicacion_id, stock FROM stock_ubicacion WHERE item_id = $1`,
      [itemId],
    );
    const stockPorUbicacion = new Map(
      saldos.map((r) => [r.ubicacion_id, r.stock]),
    );
    expect(stockPorUbicacion.get(localId)).toBe('8.0000');
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
        cantidad: '5',
        costoUnitario: '1000',
        lote: { codigoLote, fechaVencimiento: '2027-06-01' },
      });
    expect(resEntrada.status).toBe(200);

    const resLotesAntes = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/lotes`)
      .set('Authorization', `Bearer ${token}`);
    expect(resLotesAntes.status).toBe(200);
    const loteId = (resLotesAntes.body as LoteResponse[])[0].id;

    // 20 en la bodega — MÁS que en el local, y más que los 8 que se van a
    // pedir: si el chequeo mirara el total del lote (25) en vez del saldo de
    // la ubicación que recibe la salida (el local, 5), esto pasaría cuando
    // no debería.
    await ds.query(
      `INSERT INTO lote_ubicacion (lote_id, ubicacion_id, cantidad)
       VALUES ($1, $2, '20.0000')`,
      [loteId, bodegaId],
    );

    const resSalida = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'salida',
        motivo: 'ajuste_manual',
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
        cantidad: '3',
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
    // tiene por qué tocar la identidad del lote.
    await ds.query(
      `INSERT INTO lote_ubicacion (lote_id, ubicacion_id, cantidad)
       VALUES ($1, $2, '2.0000')`,
      [loteId, bodegaId],
    );

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
