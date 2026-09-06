import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

/**
 * Red de la Tarea 2 (EXPANDIR) del plan de bodegas: prueba que la doble
 * escritura del chokepoint (`InventarioService.registrarMovimiento`) no
 * derivó — `item_producto.stock` y `stock_ubicacion` (fila del LOCAL del
 * tenant) tienen que coincidir después de cada movimiento, en los tres modos
 * de inventario. Nadie lee `stock_ubicacion` todavía (eso llega en la
 * Tarea 3), así que la única forma de verificarla acá es leyendo la tabla
 * directo por SQL.
 *
 * Se borra en la Tarea 4, cuando `item_producto.stock` deja de existir y ya
 * no hay nada que comparar.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const CAUSA_VENCIMIENTO_ID = '550e8400-e29b-41d4-a716-446655440266';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface ItemResponse {
  id: string;
}
interface VentaResponse {
  id: string;
  estado: string;
}
interface MermaResponse {
  movimientoId: string;
}
interface RecuentoCreateResponse {
  id: string;
}
interface RecuentoLinea {
  lineaId: string;
}
interface RecuentoDetalleResponse {
  lineas: RecuentoLinea[];
}
interface MotivoDiferenciaInventarioItem {
  id: string;
  esFijo: boolean;
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

describe('stock_ubicacion — paridad con item_producto (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let caja: CajaAbierta;
  let localId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `switch-tenant` y `refresh` leen `req.cookies`, y `cookieParser` vive en
    // `main.ts`, que el e2e no ejecuta. Sin esto los dos cortan con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    ds = app.get(DataSource);
    token = await login(app);
    caja = await abrirCaja(app, token, {
      comentario: 'Apertura E2E paridad stock_ubicacion',
    });

    const rows: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID],
    );
    localId = rows[0].ubicacion_id;
  });

  afterAll(async () => {
    await cerrarCaja(app, token, caja);
    await app.close();
  });

  /** Las dos tablas, leídas directo por SQL: nadie las expone por API todavía. */
  async function assertParidad(itemId: string, esperado: string) {
    const prodRows: { stock: string }[] = await ds.query(
      `SELECT stock FROM item_producto WHERE item_id = $1`,
      [itemId],
    );
    const ubiRows: { stock: string }[] = await ds.query(
      `SELECT stock FROM stock_ubicacion WHERE item_id = $1 AND ubicacion_id = $2`,
      [itemId, localId],
    );
    expect(prodRows[0]?.stock).toBe(esperado);
    expect(ubiRows[0]?.stock).toBe(esperado);
  }

  async function crearProducto(
    nombre: string,
    modoInventario?: 'cantidad' | 'serie' | 'lote',
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `${nombre} ${Date.now()}-${Math.random()}`,
        precioBase: '1000',
        // Afecto por default cierra "a góndola": el total no depende de la
        // tasa de IVA del país, así que la venta de abajo no necesita
        // calcular impuesto para saber cuánto pagar.
        precioIncluyeImpuesto: true,
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        ...(modoInventario ? { modoInventario } : {}),
      });
    expect(res.status).toBe(201);
    return (res.body as ItemResponse).id;
  }

  it('modo cantidad: compra, venta, merma y recuento mantienen las dos tablas iguales', async () => {
    const itemId = await crearProducto('Paridad cantidad E2E');

    // 1. Comprar 20
    await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: '20',
        costoUnitario: '500',
      })
      .expect(200);
    await assertParidad(itemId, '20.0000');

    // 2. Vender 3
    const resVenta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [{ itemId, cantidad: '3' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '3000.0000' }],
      });
    expect(resVenta.status).toBe(201);
    expect((resVenta.body as VentaResponse).estado).toBe('pagada');
    await assertParidad(itemId, '17.0000');

    // 3. Mermar 2
    const resMerma = await request(app.getHttpServer())
      .post('/api/mermas')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId, cantidad: '2', causaMermaId: CAUSA_VENCIMIENTO_ID });
    expect(resMerma.status).toBe(201);
    expect((resMerma.body as MermaResponse).movimientoId).toBeDefined();
    await assertParidad(itemId, '15.0000');

    // 4. Recuento con diferencia: sistema 15, contado 10 → aplica salida de 5
    const resSesion = await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemIds: [itemId] });
    expect(resSesion.status).toBe(201);
    const recuentoId = (resSesion.body as RecuentoCreateResponse).id;

    const resDetalle = await request(app.getHttpServer())
      .get(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDetalle.status).toBe(200);
    const linea = (resDetalle.body as RecuentoDetalleResponse).lineas[0];

    const resMotivos = await request(app.getHttpServer())
      .get('/api/motivos-diferencia-inventario')
      .set('Authorization', `Bearer ${token}`);
    expect(resMotivos.status).toBe(200);
    const motivoId = (resMotivos.body as MotivoDiferenciaInventarioItem[]).find(
      (m) => m.esFijo,
    )!.id;

    await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}/lineas/${linea.lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidadContada: '10', motivoDiferenciaId: motivoId })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/recuentos/${recuentoId}/aplicar`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await assertParidad(itemId, '10.0000');
  });

  it('modo serie: entrada de 2 series y salida de 1 mantienen las dos tablas iguales', async () => {
    const itemId = await crearProducto('Paridad serie E2E', 'serie');
    const marca = `${Date.now()}-${Math.random()}`;

    // 1. Entrada: 2 series nuevas
    await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: '2',
        costoUnitario: '500',
        series: [{ serie: `SN-A-${marca}` }, { serie: `SN-B-${marca}` }],
      })
      .expect(200);
    await assertParidad(itemId, '2.0000');

    // 2. Salida de 1 (auto-selección FIFO: no hace falta elegir unidadIds)
    await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'salida', motivo: 'ajuste_manual', cantidad: '1' })
      .expect(200);
    await assertParidad(itemId, '1.0000');
  });

  it('modo lote: entrada y salida mantienen las dos tablas iguales', async () => {
    const itemId = await crearProducto('Paridad lote E2E', 'lote');
    const codigoLote = `LOTE-E2E-${Date.now()}-${Math.random()}`;

    // 1. Entrada: crea el lote con 10 unidades
    await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: '10',
        costoUnitario: '500',
        lote: { codigoLote },
      })
      .expect(200);
    await assertParidad(itemId, '10.0000');

    // 2. Salida de 4 (auto-selección FIFO: no hace falta elegir loteId)
    await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'salida', motivo: 'ajuste_manual', cantidad: '4' })
      .expect(200);
    await assertParidad(itemId, '6.0000');
  });
});
