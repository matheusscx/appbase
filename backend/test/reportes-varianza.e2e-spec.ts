import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { contarYAplicar } from './helpers/recuentos';
import { loginSegundoTenant } from './helpers/segundo-tenant';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

interface TokenResponse {
  access_token: string;
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

describe('Reporte de varianza (e2e)', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;

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

    tokenAdmin = await login(app);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  function leer(token: string, query = ''): Promise<request.Response> {
    return request(app.getHttpServer())
      .get(`/api/reportes/varianza${query}`)
      .set('Authorization', `Bearer ${token}`);
  }

  describe('permiso y módulo contratado', () => {
    it('200 con lista paginada para el admin del tenant que contrató Varianza', async () => {
      const res = await leer(tokenAdmin);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(Array.isArray((res.body as { data: unknown[] }).data)).toBe(true);
      expect(res.body).toHaveProperty('meta.total');
      expect(res.body).toHaveProperty('meta.page');
      expect(res.body).toHaveProperty('meta.pageSize');
    });

    /**
     * El borde es COMERCIAL, no de aislamiento: el admin del segundo tenant no
     * ve datos ajenos, ve un módulo que su empresa no contrató. `userHasPermiso`
     * mira `tenant_modulos` también para el rol fijo, así que ni siquiera el
     * admin entra (`rbac.service.ts`). Por eso el seed le da `Varianza` a Paris
     * y NO al segundo tenant: sin esa asimetría este caso no existe.
     *
     * ⚠️ El segundo tenant se llama **Demo Bodega**, no "Falabella" — las
     * constantes del repo mienten (ver el docblock de `helpers/segundo-tenant`).
     */
    it('403 para el admin del segundo tenant, que no contrató el módulo', async () => {
      const tokenSegundoTenant = await loginSegundoTenant(app);

      const res = await leer(tokenSegundoTenant);

      expect(res.status).toBe(403);
    });

    it('401 sin token', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/reportes/varianza',
      );

      expect(res.status).toBe(401);
    });
  });

  describe('validación de la query', () => {
    it('400 si ubicacionId no es un uuid', async () => {
      const res = await leer(tokenAdmin, '?ubicacionId=no-es-uuid');

      expect(res.status).toBe(400);
    });

    it('400 si desde no es una fecha', async () => {
      const res = await leer(tokenAdmin, '?desde=ayer');

      expect(res.status).toBe(400);
    });

    /**
     * Fecha pura: es lo que emite `AppDateInput`, y el borde superior tiene que
     * resolverse con el día del NEGOCIO del tenant (`bordeHastaSql`), no con la
     * medianoche de calendario. Acá solo se verifica que el pipe la acepta y que
     * la consulta no revienta; que el día sea el correcto lo cubre la Tarea 2.
     */
    it('200 con fechas puras YYYY-MM-DD', async () => {
      const res = await leer(tokenAdmin, '?desde=2026-09-01&hasta=2026-09-30');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });

    /**
     * Un timestamp explícito también es válido (`@IsDateString()` lo acepta) y
     * NO se expande: quien lo manda pidió ese instante. El caso está acá porque
     * es el que tiró 500 en otros módulos — `requiereDiaNegocio` evita pushear
     * zona/corte cuando ningún borde es fecha pura, y sin eso Postgres rechaza
     * el bind con un parámetro que la consulta no nombra.
     */
    it('200 con un timestamp explícito, sin 500 por el bind', async () => {
      const res = await leer(
        tokenAdmin,
        '?desde=2026-09-01T15:30:00Z&hasta=2026-09-30T15:30:00Z',
      );

      expect(res.status).toBe(200);
    });
  });

  /**
   * La ventana contra Postgres REAL. El unitario no puede probar esto: con `Db`
   * mockeado, el mock devuelve las filas que se le piden sin importar qué JOIN
   * arma la consulta (medido el 2026-09-20 — mutar `LEFT JOIN` a `JOIN` dejó los
   * nueve unitarios en verde).
   */
  describe('la ventana entre dos recuentos', () => {
    let localId: string;
    let motivoId: string;

    beforeAll(async () => {
      const resUbic = await request(app.getHttpServer())
        .get('/api/ubicaciones')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resUbic.status).toBe(200);
      localId = (resUbic.body as { id: string; tipo: string }[]).find(
        (u) => u.tipo === 'local',
      )!.id;

      const resMotivos = await request(app.getHttpServer())
        .get('/api/motivos-diferencia-inventario')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(resMotivos.status).toBe(200);
      motivoId = (resMotivos.body as { id: string }[])[0].id;
    });

    async function crearProductoConStock(stock: string): Promise<string> {
      const resItem = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          nombre: `Varianza E2E ${Date.now()}-${Math.random()}`,
          precioBase: '10000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'producto',
        });
      expect(resItem.status).toBe(201);
      const itemId = (resItem.body as { id: string }).id;

      const resStock = await request(app.getHttpServer())
        .patch(`/api/items/${itemId}/stock`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          tipo: 'entrada',
          motivo: 'compra',
          ubicacionId: localId,
          cantidad: stock,
          costoUnitario: '1000',
        });
      expect(resStock.status).toBe(200);
      return itemId;
    }

    function filaDe(
      body: unknown,
      itemId: string,
    ): Record<string, unknown> | undefined {
      return (body as { data: Record<string, unknown>[] }).data.find(
        (f) => f.itemId === itemId,
      );
    }

    it('con DOS recuentos aplicados, la fila es medible y nombra a los dos', async () => {
      const itemId = await crearProductoConStock('100');
      const recA = await contarYAplicar(app, tokenAdmin, {
        ubicacionId: localId,
        itemId: itemId,
        cantidadContada: '98',
        motivoDiferenciaId: motivoId,
      });
      const recB = await contarYAplicar(app, tokenAdmin, {
        ubicacionId: localId,
        itemId: itemId,
        cantidadContada: '95',
        motivoDiferenciaId: motivoId,
      });

      const res = await leer(tokenAdmin, `?itemId=${itemId}`);

      expect(res.status).toBe(200);
      const fila = filaDe(res.body, itemId);
      expect(fila).toBeDefined();
      expect(fila).toMatchObject({
        medible: true,
        recuentoInicialId: recA,
        recuentoFinalId: recB,
        ubicacionId: localId,
      });
    });

    it('con UN solo recuento, la fila aparece pero no es medible', async () => {
      const itemId = await crearProductoConStock('50');
      await contarYAplicar(app, tokenAdmin, {
        ubicacionId: localId,
        itemId: itemId,
        cantidadContada: '48',
        motivoDiferenciaId: motivoId,
      });

      const res = await leer(tokenAdmin, `?itemId=${itemId}`);

      expect(res.status).toBe(200);
      const fila = filaDe(res.body, itemId);
      expect(fila).toBeDefined();
      expect(fila).toMatchObject({ medible: false, recuentoInicialId: null });
    });

    /**
     * ⛔ **El caso que el unitario NO puede probar, y el que justifica el
     * `LEFT JOIN`.** Un recuento cuya línea da **delta cero** no escribe
     * movimiento (`recuentos.service.ts` saltea el delta cero), así que
     * `recuento_inventario_linea.movimiento_id` queda en `NULL`. Con un `JOIN`
     * normal ese grupo se caería del reporte entero — o sea, se perdería
     * justamente el conteo que salió **perfecto**, que es el que confirma que el
     * número es confiable.
     *
     * Acá el primer recuento cuenta EXACTAMENTE lo que hay (delta cero) y el
     * segundo encuentra un faltante. La fila tiene que seguir siendo medible.
     */
    it('un recuento que dio justo no escribe movimiento y la fila sobrevive igual', async () => {
      const itemId = await crearProductoConStock('40');
      const recA = await contarYAplicar(app, tokenAdmin, {
        ubicacionId: localId,
        itemId: itemId,
        cantidadContada: '40',
        motivoDiferenciaId: motivoId,
      }); // delta 0: sin movimiento
      const recB = await contarYAplicar(app, tokenAdmin, {
        ubicacionId: localId,
        itemId: itemId,
        cantidadContada: '37',
        motivoDiferenciaId: motivoId,
      }); // faltante de 3

      const res = await leer(tokenAdmin, `?itemId=${itemId}`);

      expect(res.status).toBe(200);
      const fila = filaDe(res.body, itemId);
      expect(fila).toBeDefined();
      expect(fila).toMatchObject({
        medible: true,
        recuentoInicialId: recA,
        recuentoFinalId: recB,
      });
    });

    it('filtrar por otra ubicación no devuelve la fila del local', async () => {
      const itemId = await crearProductoConStock('30');
      await contarYAplicar(app, tokenAdmin, {
        ubicacionId: localId,
        itemId: itemId,
        cantidadContada: '29',
        motivoDiferenciaId: motivoId,
      });
      await contarYAplicar(app, tokenAdmin, {
        ubicacionId: localId,
        itemId: itemId,
        cantidadContada: '28',
        motivoDiferenciaId: motivoId,
      });

      const resBodega = await request(app.getHttpServer())
        .post('/api/ubicaciones')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ nombre: `Bodega varianza ${Date.now()}`, tipo: 'bodega' });
      expect(resBodega.status).toBe(201);
      const bodegaId = (resBodega.body as { id: string }).id;

      const res = await leer(
        tokenAdmin,
        `?itemId=${itemId}&ubicacionId=${bodegaId}`,
      );

      expect(res.status).toBe(200);
      expect(filaDe(res.body, itemId)).toBeUndefined();
    });
  });
});
