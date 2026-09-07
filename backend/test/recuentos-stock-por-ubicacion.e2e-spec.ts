import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * Red de la Tarea 3b (GIRAR 2/2) del plan de bodegas, reescrita en la Tarea 11
 * tal como su docblock anterior anunciaba: `docs/superpowers/plans/
 * 2026-09-06-bodegas-y-traslados.md`.
 *
 * ⚠️ **Este spec afirmaba otra cosa hasta el 2026-09-07** —que `stockSistema`
 * congelaba siempre el saldo del LOCAL, tapón deliberado de la Tarea 4—. La
 * Tarea 11 levanta ese tapón: la sesión de recuento ahora ELIGE ubicación, y
 * el congelado (`create`) y la aplicación del delta (`aplicar`) tienen que
 * mirar la MISMA — acá, la BODEGA, para ejercitar justo el camino que el
 * tapón bloqueaba.
 *
 * El escenario numérico sigue siendo el que motivó el tapón original: un
 * producto con 10 en el local y 20 en la bodega. Antes de la Tarea 11 no
 * había forma de contar la bodega por API — este spec es la prueba de que
 * ahora sí, y de que el delta aterriza ahí y no en el local.
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
interface MotivoTrasladoResponse {
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
  ubicacionId: string;
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

  it('stockSistema congela el saldo de la ubicación ELEGIDA (la bodega), y aplicar posta el delta ahí — el local no se toca', async () => {
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

    // 3. 30 en el local, por la API real.
    await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        ubicacionId: localId,
        cantidad: '30',
        costoUnitario: '500',
      })
      .expect(200);

    // 4. 20 se van a la bodega POR LA API: quedan 10 en el local y 20 en la
    // bodega. Números distintos a propósito, así un mutante que lea el total
    // donde va la ubicación elegida (o viceversa) no sobrevive.
    const resMotivosTraslado = await request(app.getHttpServer())
      .get('/api/motivos-traslado')
      .set('Authorization', `Bearer ${token}`);
    expect(resMotivosTraslado.status).toBe(200);

    const resTraslado = await request(app.getHttpServer())
      .post('/api/traslados')
      .set('Authorization', `Bearer ${token}`)
      .send({
        origenId: localId,
        destinoId: bodegaId,
        motivoTrasladoId: (
          resMotivosTraslado.body as MotivoTrasladoResponse[]
        )[0].id,
        lineas: [{ itemId, cantidad: '20' }],
      });
    expect(resTraslado.status).toBe(201);

    // 5. Crear la sesión de recuento SOBRE LA BODEGA y verificar que
    // `stockSistema` congeló el saldo de la bodega (20), no el del local (10)
    // ni el total del tenant (30). Es el escenario exacto que el tapón de la
    // Tarea 4 bloqueaba: si congelara el total, el operador que cuenta lo que
    // ve en la bodega guardaría una diferencia falsa y aplicar movería stock
    // que nunca se movió.
    const resCrear = await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ ubicacionId: bodegaId, itemIds: [itemId] });
    expect(resCrear.status).toBe(201);
    const recuentoId = (resCrear.body as RecuentoCreateResponse).id;

    const resDetalle = await request(app.getHttpServer())
      .get(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDetalle.status).toBe(200);
    const detalle = resDetalle.body as RecuentoDetalleResponse;
    expect(detalle.ubicacionId).toBe(bodegaId);
    const linea = detalle.lineas.find((l) => l.itemId === itemId);
    expect(linea).toBeDefined();
    expect(linea!.stockSistema).toBe('20.0000');

    // 6. Y la otra mitad del par, que es la que el bug original desalineaba:
    // dónde ATERRIZA el delta. El conteo va a 22 —**distinto** del congelado
    // a propósito—: con 22 el delta es +2 y `aplicar` sí llama a
    // `registrarMovimiento`. Contar 20 dejaría el delta en cero,
    // `lineasAAplicar` vacío, y `aplicar` cortaría antes de resolver
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
      .send({ cantidadContada: '22', motivoDiferenciaId: motivo.id })
      .expect(200);

    const resAplicar = await request(app.getHttpServer())
      .post(`/api/recuentos/${recuentoId}/aplicar`)
      .set('Authorization', `Bearer ${token}`);
    expect(resAplicar.status).toBe(201);
    expect((resAplicar.body as RecuentoAplicarResponse).lineasAplicadas).toBe(
      1,
    );

    // El delta aterrizó en la BODEGA: 20 + 2 = 22, y el local quedó intacto
    // en 10. Si `aplicar` posteara contra el local (el bug original), esto
    // sería local 12 / bodega 20.
    const saldos: { ubicacion_id: string; stock: string }[] = await ds.query(
      `SELECT ubicacion_id, stock FROM stock_ubicacion WHERE item_id = $1`,
      [itemId],
    );
    const porUbicacion = new Map(saldos.map((r) => [r.ubicacion_id, r.stock]));
    expect(porUbicacion.get(bodegaId)).toBe('22.0000');
    expect(porUbicacion.get(localId)).toBe('10.0000');

    // Y un solo movimiento, de 2, en la bodega. El `ubicacion_id` se afirma
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
    expect(movs[0].ubicacion_id).toBe(bodegaId);
  });
});
