import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * La serie de una unidad es única **por producto vivo** — `(item_id, serie)`
 * con `eliminado_el IS NULL`, la regla que fijó el owner el 2026-09-19 — y NO
 * por tenant: cada proveedor numera como quiere y no hay estándar global, así
 * que dos productos distintos del mismo tenant sí pueden repetir número.
 *
 * El bug que cierra: el índice único existía solo en `startup-pos.sql`, que es
 * documentación y no lo ejecuta nadie —el esquema lo crea `synchronize` desde
 * las entities—, y `ItemUnidad` no lo declaraba. Dos unidades vivas del mismo
 * producto podían compartir serie y entraban **en silencio**.
 *
 * Acá van los dos caminos de `ItemsService`; los dos de compras —`confirmar` y
 * `corregirCantidad`— viven en `compras.e2e-spec.ts`, con los helpers de ese
 * archivo. Los cuatro pasan por el mismo chokepoint
 * (`InventarioService.moverSerie`, el único que inserta en `item_unidad`), y por
 * eso cada caso de acá prueba un camino distinto de la API y no el mismo dos
 * veces. Que el índice esté en la base real lo mide `esquema.e2e-spec.ts`.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}

describe('serie única por producto (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  const serieUnica = (base: string) =>
    `${base}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

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
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  /** Status y mensaje del intento crudo, para afirmar sobre los dos. */
  async function intentar(
    metodo: 'post' | 'patch',
    url: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; message: string; body: unknown }> {
    const res = await request(app.getHttpServer())
      [metodo](url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    const message = (res.body as { message?: string | string[] }).message;
    return {
      status: res.status,
      message: Array.isArray(message) ? message.join(' ') : (message ?? ''),
      body: res.body,
    };
  }

  function altaSerie(extra: Record<string, unknown> = {}) {
    return {
      nombre: serieUnica('Serie única E2E'),
      precioBase: '10000',
      monedaId: CLP_MONEDA_ID,
      tipo: 'producto',
      modoInventario: 'serie',
      unidadMedida: 'unidad',
      ...extra,
    };
  }

  async function crearProductoSerie(
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const r = await intentar('post', '/api/items', altaSerie(extra));
    expect(r.status).toBe(201);
    return (r.body as { id: string }).id;
  }

  async function ubicacionLocal(): Promise<string> {
    const res = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const local = (res.body as { id: string; tipo: string }[]).find(
      (u) => u.tipo === 'local',
    );
    expect(local).toBeDefined();
    return local!.id;
  }

  async function seriesDe(itemId: string): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/unidades`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as { serie: string }[]).map((u) => u.serie).sort();
  }

  // --- Camino 1: alta de producto en modo serie con stock inicial ------------

  it('el alta con stock inicial rechaza dos veces la misma serie, y la nombra', async () => {
    const serie = serieUnica('IMEI-ALTA-REPE');
    const r = await intentar(
      'post',
      '/api/items',
      altaSerie({ series: [{ serie }, { serie }] }),
    );
    expect(r.status).toBe(400);
    expect(r.message).toContain(serie);
  });

  it('la misma serie entra en dos productos distintos: la regla es por producto, no por tenant', async () => {
    // La regla del owner, medida: la MISMA serie entra dos veces si son dos
    // productos distintos —cada proveedor numera como quiere—, y el rechazo
    // llega recién cuando se repite DENTRO de un producto. Si el índice fuera
    // el `(tenant_id, serie)` que arrastraba `startup-pos.sql`, este caso
    // fallaría.
    const serie = serieUnica('IMEI-DOS-PRODUCTOS');
    const primero = await crearProductoSerie({ series: [{ serie }] });
    const segundo = await crearProductoSerie({ series: [{ serie }] });
    expect(await seriesDe(primero)).toEqual([serie]);
    expect(await seriesDe(segundo)).toEqual([serie]);
  });

  // --- Camino 2: ajuste/entrada manual de stock ------------------------------

  it('el ajuste de stock rechaza una serie que el producto ya tiene viva, y la nombra', async () => {
    const serie = serieUnica('IMEI-AJUSTE-VIVA');
    const itemId = await crearProductoSerie({ series: [{ serie }] });
    const localId = await ubicacionLocal();

    const r = await intentar('patch', `/api/items/${itemId}/stock`, {
      tipo: 'entrada',
      motivo: 'compra',
      ubicacionId: localId,
      cantidad: '1',
      series: [{ serie }],
    });
    expect(r.status).toBe(400);
    expect(r.message).toContain(serie);

    // Y no entró: la unidad repetida no quedó a medias.
    expect(await seriesDe(itemId)).toEqual([serie]);
  });

  it('el ajuste de stock rechaza dos series iguales en la misma tanda', async () => {
    // El otro duplicado, el que ningún índice puede ver: las dos filas todavía
    // no existen cuando se chequea.
    const serie = serieUnica('IMEI-AJUSTE-TANDA');
    const itemId = await crearProductoSerie();
    const localId = await ubicacionLocal();

    const r = await intentar('patch', `/api/items/${itemId}/stock`, {
      tipo: 'entrada',
      motivo: 'compra',
      ubicacionId: localId,
      cantidad: '2',
      series: [{ serie }, { serie }],
    });
    expect(r.status).toBe(400);
    expect(r.message).toContain(serie);
    expect(await seriesDe(itemId)).toEqual([]);
  });

  it('el ajuste sigue aceptando una serie nueva del mismo producto', async () => {
    // El control del guard: sin este caso, un chequeo que rechazara TODA serie
    // pasaría los tres tests de arriba.
    const primera = serieUnica('IMEI-OK-A');
    const segunda = serieUnica('IMEI-OK-B');
    const itemId = await crearProductoSerie({ series: [{ serie: primera }] });
    const localId = await ubicacionLocal();

    const r = await intentar('patch', `/api/items/${itemId}/stock`, {
      tipo: 'entrada',
      motivo: 'compra',
      ubicacionId: localId,
      cantidad: '1',
      series: [{ serie: segunda }],
    });
    expect(r.status).toBe(200);
    expect(await seriesDe(itemId)).toEqual([primera, segunda].sort());
  });
});
