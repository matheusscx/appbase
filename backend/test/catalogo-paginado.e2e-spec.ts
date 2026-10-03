import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';
import { todasLasPaginas } from './helpers/paginacion';
import { loginSegundoTenant } from './helpers/segundo-tenant';
import { randomUUID } from 'node:crypto';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const BOLETA_ID = '550e8400-e29b-41d4-a716-446655440145';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

const TOTAL = 105;
/** Los múltiplos de 3 entran con stock 0: son 35 de 105. */
const SIN_STOCK = 35;
const CON_STOCK = TOTAL - SIN_STOCK;

interface TokenResponse {
  access_token: string;
}
interface FilaCatalogo {
  id: string;
  nombre: string;
  modoInventario?: string;
  stockDisponible?: string | null;
}
interface CatalogoResponse {
  data: FilaCatalogo[];
  meta: { total: number };
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

/**
 * `GET /items` paginado en el servidor: lista de `tipo`, `orden=disponibilidad`,
 * `ids` y `modoInventario` (spec 2026-10-03-catalogo-paginado § 3).
 *
 * Los 105 productos se crean por `POST /api/items`, uno por uno (el camino
 * real), porque 105 > `MAX_PAGE_SIZE` (100): con 100 o menos, la propiedad que
 * este spec fija —que el producto 101 se encuentra y se vende— no se puede
 * ejercer. Los múltiplos de 3 entran con stock 0, así que el orden de
 * disponibilidad tiene dos grupos de tamaño distinto (70 y 35) y partidos por
 * una página (48): un orden que cambiara de una página a otra repetiría o
 * saltearía filas.
 */
describe('Catálogo paginado en el servidor (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let caja: CajaAbierta;
  /** Id de cada producto, en el orden de creación (`ids[0]` es P001). */
  const ids: string[] = [];
  // Marca ÚNICA por corrida: la base arrastra catálogo de otras suites y de
  // corridas anteriores; acotar por la marca deja solo los 105 de este spec.
  const marca = `E2E-CAT-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  const nombre = (n: number) => `${marca} P${String(n).padStart(3, '0')}`;
  const idDe = (n: number) => ids[n - 1];

  const listar = (query: string) =>
    request(app.getHttpServer())
      .get(`/api/items?${query}`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `switch-tenant` lee `req.cookies`, y `cookieParser` vive en `main.ts`.
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();

    token = await login(app);
    caja = await abrirCaja(app, token, {
      comentario: 'Apertura E2E catálogo paginado',
    });

    for (let n = 1; n <= TOTAL; n++) {
      const res = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: nombre(n),
          precioBase: '1000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'producto',
          unidadMedida: 'unidad',
          stock: n % 3 === 0 ? '0' : '5',
          costo: '500',
        });
      expect(res.status).toBe(201);
      ids.push((res.body as { id: string }).id);
    }
  }, 180000);

  afterAll(async () => {
    // Acumular en vez de cortar, y el `close` en un `finally` con la aserción
    // DESPUÉS (afirmar antes deja la app viva con su `@Cron`). Molde:
    // `items-pausados.e2e-spec.ts`.
    const fallos: string[] = [];
    try {
      for (const id of ids) {
        try {
          const res = await request(app.getHttpServer())
            .delete(`/api/items/${id}`)
            .set('Authorization', `Bearer ${token}`);
          if (![200, 204].includes(res.status)) {
            fallos.push(`borrar ${id} → ${res.status}`);
          }
        } catch (e) {
          fallos.push(`borrar ${id} → ${(e as Error).message}`);
        }
      }
      if (caja) {
        try {
          await cerrarCaja(app, token, caja);
        } catch (e) {
          fallos.push(`cerrar caja → ${(e as Error).message}`);
        }
      }
    } finally {
      await app.close();
    }

    expect(fallos).toEqual([]);
  }, 180000);

  const URL_GRILLA = () =>
    `/api/items?tipo=producto,receta,combo&activo=true&orden=disponibilidad&search=${marca}&pageSize=48`;

  it('recorre las páginas sin repetir ni saltear: 105 ids distintos', async () => {
    // `todasLasPaginas` ya afirma que vio `meta.total` ids distintos.
    const filas = await todasLasPaginas<FilaCatalogo>(app, token, URL_GRILLA());

    expect(filas).toHaveLength(TOTAL);
    expect(new Set(filas.map((f) => f.id))).toEqual(new Set(ids));
  });

  it('orden: primero las 70 con stock 5, después las 35 con stock 0, cada grupo por nombre', async () => {
    const filas = await todasLasPaginas<FilaCatalogo>(app, token, URL_GRILLA());

    const conStock: string[] = [];
    const sinStock: string[] = [];
    for (let n = 1; n <= TOTAL; n++) {
      (n % 3 === 0 ? sinStock : conStock).push(nombre(n));
    }
    expect(conStock).toHaveLength(CON_STOCK);
    expect(sinStock).toHaveLength(SIN_STOCK);

    const nombres = filas.map((f) => f.nombre);
    expect(nombres.slice(0, CON_STOCK)).toEqual(conStock);
    expect(nombres.slice(CON_STOCK)).toEqual(sinStock);
  });

  it('el camino ordenado conserva los campos del listado: `modoInventario` y `stockDisponible` en cada fila', async () => {
    const filas = await todasLasPaginas<FilaCatalogo>(app, token, URL_GRILLA());

    expect(filas).toHaveLength(TOTAL);
    for (const f of filas) {
      expect(f.modoInventario).toBe('cantidad');
      expect(f.stockDisponible).toEqual(expect.any(String));
    }
  });

  it('el 101 se encuentra por búsqueda', async () => {
    const res = await listar(
      `tipo=producto,receta,combo&activo=true&orden=disponibilidad&search=${marca} P101&pageSize=48`,
    );

    expect(res.status).toBe(200);
    const body = res.body as CatalogoResponse;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].nombre).toBe(nombre(101));
    expect(body.data[0].id).toBe(idDe(101));
  });

  it('el 101 se vende', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipoDocumentoId: BOLETA_ID,
        lineas: [{ itemId: idDe(101), cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '1000' }],
      });

    expect(res.status).toBe(201);
  });

  it('una lista de `tipo` con un valor inválido da 400', async () => {
    const res = await listar(`tipo=producto,pizza&search=${marca}`);

    expect(res.status).toBe(400);
  });

  it('`ids` con más de 100 UUIDs da 400', async () => {
    const demasiados = Array.from({ length: 101 }, () => randomUUID()).join(
      ',',
    );
    const res = await listar(`ids=${demasiados}&pageSize=100`);

    expect(res.status).toBe(400);
  });

  it('`ids` resuelve exactamente los pedidos', async () => {
    const res = await listar(`ids=${idDe(101)},${idDe(2)}&pageSize=100`);

    expect(res.status).toBe(200);
    const body = res.body as CatalogoResponse;
    expect(body.data.map((f) => f.id).sort()).toEqual(
      [idDe(101), idDe(2)].sort(),
    );
    expect(body.meta.total).toBe(2);
  });

  it('`ids` no cruza tenants: el segundo tenant no ve el ítem de Paris', async () => {
    const tokenAjeno = await loginSegundoTenant(app);

    const res = await request(app.getHttpServer())
      .get(`/api/items?ids=${idDe(101)}&pageSize=100`)
      .set('Authorization', `Bearer ${tokenAjeno}`);

    expect(res.status).toBe(200);
    expect((res.body as CatalogoResponse).data).toEqual([]);
  });

  it('`modoInventario=cantidad` con la marca devuelve los 105', async () => {
    const filas = await todasLasPaginas<FilaCatalogo>(
      app,
      token,
      `/api/items?modoInventario=cantidad&search=${marca}&pageSize=100`,
    );

    expect(filas).toHaveLength(TOTAL);
  });

  it('sin parámetros nuevos nada cambia: un `tipo`, orden por nombre, P003 en su lugar', async () => {
    const res = await listar(`tipo=producto&search=${marca}&pageSize=100`);

    expect(res.status).toBe(200);
    const body = res.body as CatalogoResponse;
    expect(body.meta.total).toBe(TOTAL);
    expect(body.data).toHaveLength(100);
    const nombres = body.data.map((f) => f.nombre);
    expect(nombres).toEqual(
      Array.from({ length: 100 }, (_, i) => nombre(i + 1)),
    );
    // P003 no tiene stock y aun así va tercero: ese orden no mira la disponibilidad.
    expect(nombres[2]).toBe(nombre(3));
  });
});
