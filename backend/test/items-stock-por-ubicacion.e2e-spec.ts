import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * Red de la Tarea 3a (GIRAR 1/2) del frente de bodegas — el plan se borró al
 * cerrarlo; lo durable está en `docs/features/bodegas-y-traslados.md`,
 * «GET /items, GET /items/:id».
 *
 * `GET /items` y `GET /items/:id` tienen que devolver los TRES números —
 * `stock` (total del tenant), `stockVendible` (el del local) y
 * `stockDisponible` (`stockVendible − comprometido`, sin cuentas abiertas acá
 * es el mismo número que `stockVendible`)— calculados desde `stock_ubicacion`,
 * y `GET /items/:id` gana el desglose por ubicación.
 *
 * ✅ **Sin muleta desde la Tarea 9**: el escenario se arma entero por la API
 * (compra al local + `POST /traslados` a la bodega). Hasta el 2026-09-07 el
 * saldo de la bodega se plantaba con un `INSERT` directo a `stock_ubicacion`
 * porque el endpoint no existía, y esa excepción estaba declarada en
 * `costo-stock-choke-point.invariant.spec.ts`. Ya no hay ninguna.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
/** Falabella: el otro tenant del seed, para el 404 por ubicación ajena. */
const FALABELLA_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';

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
  tipo: 'local' | 'bodega';
}
interface MotivoTrasladoResponse {
  id: string;
}
interface ItemListado {
  id: string;
  stock: string;
  stockVendible: string;
  stockDisponible: string;
}
interface ItemListaResponse {
  data: ItemListado[];
}
interface DesgloseUbicacion {
  ubicacionId: string;
  nombre: string;
  stock: string;
}
interface ItemDetalleResponse {
  id: string;
  stock: string;
  stockVendible: string;
  desglosePorUbicacion: DesgloseUbicacion[];
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

describe('items — stock por ubicación (e2e)', () => {
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
      `SELECT ubicacion_id FROM ubicaciones WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID],
    );
    localId = rows[0].ubicacion_id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('stock es el total, stockVendible el del local, y stockDisponible frena solo por el local', async () => {
    // 1. Una bodega nueva para este tenant.
    const resBodega = await request(app.getHttpServer())
      .post('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Bodega stock-por-ubicacion E2E ${Date.now()}`,
        tipo: 'bodega',
      });
    expect(resBodega.status).toBe(201);
    const bodegaId = (resBodega.body as UbicacionResponse).id;

    // 2. Un producto nuevo.
    const nombreItem = `Item stock-por-ubicacion E2E ${Date.now()}-${Math.random()}`;
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

    // 3. 30 en el local, por la API real: desde la Tarea 12 `ubicacionId` es
    // requerido en el body — ya no hay default silencioso al local.
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

    // 4. 20 de esos 30 se van a la bodega POR LA API. Quedan 10 en el local y
    // 20 en la bodega: números distintos a propósito, así un mutante que
    // devuelva el total donde va el vendible (o viceversa) no sobrevive.
    const resMotivos = await request(app.getHttpServer())
      .get('/api/motivos-traslado')
      .set('Authorization', `Bearer ${token}`);
    expect(resMotivos.status).toBe(200);
    const motivoId = (resMotivos.body as MotivoTrasladoResponse[])[0].id;

    const resTraslado = await request(app.getHttpServer())
      .post('/api/traslados')
      .set('Authorization', `Bearer ${token}`)
      .send({
        origenId: localId,
        destinoId: bodegaId,
        motivoTrasladoId: motivoId,
        lineas: [{ itemId, cantidad: '20' }],
      });
    expect(resTraslado.status).toBe(201);

    // 5. GET /items: los tres números de la fila, con el salón vacío
    // (sin cuentas abiertas, `stockDisponible` = `stockVendible`).
    const resLista = await request(app.getHttpServer())
      .get(`/api/items?search=${encodeURIComponent(nombreItem)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resLista.status).toBe(200);
    const fila = (resLista.body as ItemListaResponse).data.find(
      (d) => d.id === itemId,
    );
    expect(fila).toBeDefined();
    expect(fila!.stock).toBe('30.0000');
    expect(fila!.stockVendible).toBe('10.0000');
    expect(fila!.stockDisponible).toBe('10.0000');

    // 6. GET /items/:id: `stock` y `stockVendible` (no `stockDisponible` —
    // ese vive en `GET /items` y en las filas anidadas del drawer de
    // personalización; el detalle de un producto suelto no lo tuvo nunca, ver
    // `ItemsService.findOne`), más el desglose — el local primero (aunque el
    // nombre de la bodega gane alfabéticamente), después las bodegas por
    // nombre.
    const resDetalle = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDetalle.status).toBe(200);
    const detalle = resDetalle.body as ItemDetalleResponse;
    expect(detalle.stock).toBe('30.0000');
    expect(detalle.stockVendible).toBe('10.0000');
    expect(detalle.desglosePorUbicacion).toEqual([
      { ubicacionId: localId, nombre: expect.any(String), stock: '10.0000' },
      { ubicacionId: bodegaId, nombre: expect.any(String), stock: '20.0000' },
    ]);
  });

  /**
   * `PATCH /items/:id/stock` era el único de los cuatro endpoints que escriben
   * eligiendo ubicación —`POST /mermas`, `POST /recuentos`, `POST /traslados`
   * (con `origenId`/`destinoId`) y éste— sin e2e HTTP de los **dos rechazos
   * del campo `ubicacionId`**: requerido → 400, y de otro tenant → 404. (Los
   * rechazos de este endpoint POR falta de stock en la ubicación sí estaban:
   * `inventario-serie-ubicacion.e2e-spec.ts:206` y
   * `inventario-lote-ubicacion.e2e-spec.ts:242`. Lo que faltaba es el campo,
   * no el saldo.) Del campo estaba probado solo el service mockeado
   * (`items.service.spec.ts`), que no ejercita el `ValidationPipe` — un DTO
   * probado con `plainToInstance` no prueba que el pipe lo rechace.
   *
   * Cómo están los otros tres, medido el 2026-09-07 para no volver a contarlo
   * de memoria: solo `POST /mermas` tiene los DOS casos
   * (`mermas.e2e-spec.ts:459` y `:471`). `POST /recuentos`
   * (`recuentos.e2e-spec.ts:1609`) y `POST /traslados`
   * (`traslados.e2e-spec.ts:1246`) tienen el 404 por ubicación ajena y **no**
   * el 400 del campo requerido; esos dos huecos quedaron anotados en
   * `docs/agent/pendientes.md`.
   *
   * ⚠️ "Compra" no es un endpoint: es uno de los cuatro `motivo` de este mismo
   * `PATCH` (`compra`, `devolucion`, `ajuste_manual`, `inventario_inicial`).
   * El encabezado *"Compra, merma, recuento, ajuste manual"* de
   * `docs/features/bodegas-y-traslados.md` nombra cuatro gestos de pantalla
   * que en la API son TRES endpoints —compra y ajuste manual son éste—, así
   * que estos dos casos cubren también la fila "compra".
   *
   * Los dos casos son los dos dueños distintos del rechazo: el 400 lo pone el
   * pipe sobre `AjusteStockDto.ubicacionId` (requerido, sin default al local),
   * y el 404 lo pone `UbicacionesService.findOneOrFail` dentro de la
   * transacción, antes de tocar nada.
   */
  describe('PATCH /items/:id/stock — los dos rechazos de ubicacionId', () => {
    let itemId: string;

    beforeAll(async () => {
      const resItem = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `Item ajuste-ubicacion E2E ${Date.now()}-${Math.random()}`,
          precioBase: '1000',
          precioIncluyeImpuesto: true,
          monedaId: CLP_MONEDA_ID,
          tipo: 'producto',
        });
      expect(resItem.status).toBe(201);
      itemId = (resItem.body as ItemResponse).id;

      await request(app.getHttpServer())
        .patch(`/api/items/${itemId}/stock`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          tipo: 'entrada',
          motivo: 'compra',
          ubicacionId: localId,
          cantidad: '5',
          costoUnitario: '100',
        })
        .expect(200);
    });

    it('sin ubicacionId → 400', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/items/${itemId}/stock`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tipo: 'entrada', motivo: 'compra', cantidad: '1' });
      expect(res.status).toBe(400);
    });

    it('un ubicacionId de otro tenant da 404, y el stock no se mueve', async () => {
      // El local de Falabella, pedido con el token de Falabella: no se planta
      // un UUID inventado, que daría 404 por no existir en vez de por ser
      // ajeno — y ahí el test pasaría aunque el service no filtrara por tenant.
      const resLoginF = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@sistema.com', password: 'admin' });
      expect(resLoginF.status).toBe(200);
      const resTenantF = await request(app.getHttpServer())
        .post('/api/auth/switch-tenant')
        .set(
          'Cookie',
          (resLoginF.headers['set-cookie'] as unknown as string[]) ?? [],
        )
        .set(
          'Authorization',
          `Bearer ${(resLoginF.body as TokenResponse).access_token}`,
        )
        .send({ tenantId: FALABELLA_TENANT_ID });
      expect(resTenantF.status).toBe(200);
      const tokenFalabella = (resTenantF.body as TokenResponse).access_token;

      const resUbicF = await request(app.getHttpServer())
        .get('/api/ubicaciones')
        .set('Authorization', `Bearer ${tokenFalabella}`);
      expect(resUbicF.status).toBe(200);
      const ubicacionFalabellaId = (resUbicF.body as UbicacionResponse[]).find(
        (u) => u.tipo === 'local',
      )!.id;

      const res = await request(app.getHttpServer())
        .patch(`/api/items/${itemId}/stock`)
        .set('Authorization', `Bearer ${token}`) // token de PARIS
        .send({
          tipo: 'entrada',
          motivo: 'compra',
          ubicacionId: ubicacionFalabellaId,
          cantidad: '7',
          costoUnitario: '100',
        });
      expect(res.status).toBe(404);

      // Y no dejó rastro. ⚠️ **La aserción que caza la fuga es la del TOTAL,
      // no la del desglose** — al revés de lo que parece:
      //   · `stock` sale del `LEFT JOIN LATERAL` de `baseQuery`, que suma
      //     TODA fila de `stock_ubicacion` del ítem sin filtrar por tenant
      //     (`JOIN ubicaciones u2 … AND u2.eliminado_el IS NULL`, sin
      //     `tenant_id`). Una escritura en la ubicación de Falabella lo
      //     movería a 12, y por eso este `toBe('5.0000')` la vería.
      //   · `desglosePorUbicacion` SÍ filtra `u.tenant_id`, así que una fila
      //     ajena le es invisible por construcción: nunca puede fallar por
      //     esto.
      // O sea: la del total no sobra, es la única red. La del desglose se
      // queda porque fija lo otro —que el 404 tampoco escribió de más en el
      // local propio—, no porque vea al vecino.
      const resDespues = await request(app.getHttpServer())
        .get(`/api/items/${itemId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(resDespues.status).toBe(200);
      const detalle = resDespues.body as ItemDetalleResponse;
      expect(detalle.stock).toBe('5.0000');
      expect(detalle.desglosePorUbicacion).toEqual([
        { ubicacionId: localId, nombre: expect.any(String), stock: '5.0000' },
      ]);
    });
  });
});
