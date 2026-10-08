import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { randomUUID } from 'node:crypto';
import { MAX_LINEAS_POR_VENTA } from '../src/common/utils/tope-unidades-venta.util';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface GarzonCreado {
  id: string;
  pin: string;
}
interface CuentaDetalle {
  id: string;
  estado: string;
  lineas: { id: string; itemId: string; cantidad: string }[];
}

/**
 * Una cuenta de salón no puede tener más líneas que una venta
 * (`MAX_LINEAS_POR_VENTA`). La precuenta manda todas las líneas de la cuenta a
 * `/calcular`, que corta en ese número: hasta el 2026-10-08 la cuenta no tenía
 * tope, y una mesa que se pasaba se quedaba sin precuenta.
 *
 * El escenario se arma **por la API**, no por SQL: 500 productos distintos y
 * una línea de cada uno, porque pedir dos veces el mismo producto suma
 * cantidad en vez de agregar una línea. Por eso es lento (~decenas de
 * segundos), y por eso los pedidos van de a tandas.
 */
describe('Salones — tope de líneas de una cuenta (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let garzon: GarzonCreado;
  let mesaId: string;
  /** `MAX_LINEAS_POR_VENTA + 2` productos: los que llenan, uno que sobra y uno para la fusión. */
  const itemIds: string[] = [];
  let llena: CuentaDetalle;

  const TANDA = 10;

  function post(url: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(url)
      .set('Idempotency-Key', randomUUID())
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  async function postOk<T>(
    url: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const res = await post(url, body);
    expect(res.status).toBe(201);
    return res.body as T;
  }

  async function enTandas<T>(
    xs: T[],
    f: (x: T) => Promise<unknown>,
  ): Promise<void> {
    for (let i = 0; i < xs.length; i += TANDA) {
      await Promise.all(xs.slice(i, i + TANDA).map(f));
    }
  }

  async function abrirCuenta(): Promise<CuentaDetalle> {
    return postOk<CuentaDetalle>(`/api/mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
  }

  async function cuentasDeLaMesa(): Promise<CuentaDetalle[]> {
    const res = await request(app.getHttpServer())
      .get(`/api/mesas/${mesaId}/cuentas`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as CuentaDetalle[];
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
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

    const marca = Date.now();
    const indices = [...Array(MAX_LINEAS_POR_VENTA + 2).keys()];
    await enTandas(indices, async (i) => {
      const { id } = await postOk<IdResponse>('/api/items', {
        nombre: `Tope líneas E2E ${marca} #${i}`,
        tipo: 'producto',
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '10',
        costo: '100',
      });
      itemIds[i] = id;
    });

    // Garzón propio: la sesión es única por garzón y se filtra entre specs.
    garzon = await postOk<GarzonCreado>('/api/garzones', {
      nombre: `Garzón tope líneas E2E ${marca}`,
    });
    await postOk('/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });
    const salonId = (
      await postOk<IdResponse>('/api/salones', {
        nombre: `Salón tope líneas E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await postOk<IdResponse>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa tope líneas',
      })
    ).id;

    // La cuenta llena, línea por línea. Que la línea número
    // `MAX_LINEAS_POR_VENTA` entre es parte de lo que se afirma: un tope
    // corrido en uno (`>=` en vez de `>`) cae acá.
    llena = await abrirCuenta();
    await enTandas(itemIds.slice(0, MAX_LINEAS_POR_VENTA), (itemId) =>
      postOk(`/api/cuentas/${llena.id}/lineas`, { itemId, cantidad: '1' }),
    );
  }, 300000);

  afterAll(async () => {
    let cierre: number | string;
    try {
      cierre = (
        await request(app.getHttpServer())
          .post('/api/sesiones-garzon/cerrar')
          .set('Authorization', `Bearer ${token}`)
          .send({ garzonId: garzon.id, pin: garzon.pin })
      ).status;
    } catch (e) {
      cierre = (e as Error).message;
    } finally {
      await app.close();
    }
    expect([200, 201]).toContain(cierre);
  });

  it('la cuenta llega al tope pidiendo, y una línea más es 400', async () => {
    const antes = (await cuentasDeLaMesa()).find((c) => c.id === llena.id)!;
    expect(antes.lineas).toHaveLength(MAX_LINEAS_POR_VENTA);

    const res = await post(`/api/cuentas/${llena.id}/lineas`, {
      itemId: itemIds[MAX_LINEAS_POR_VENTA],
      cantidad: '1',
    });
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(
      new RegExp(`hasta ${MAX_LINEAS_POR_VENTA} líneas`),
    );

    const despues = (await cuentasDeLaMesa()).find((c) => c.id === llena.id)!;
    expect(despues.lineas).toHaveLength(MAX_LINEAS_POR_VENTA);
  });

  it('con la cuenta llena, pedir otra vez un plato que ya está suma cantidad: el tope es de líneas, no de pedidos', async () => {
    const res = await post(`/api/cuentas/${llena.id}/lineas`, {
      itemId: itemIds[0],
      cantidad: '1',
    });
    expect(res.status).toBe(201);
    const detalle = res.body as CuentaDetalle;
    expect(detalle.lineas).toHaveLength(MAX_LINEAS_POR_VENTA);
    expect(
      Number(detalle.lineas.find((l) => l.itemId === itemIds[0])!.cantidad),
    ).toBe(2);
  });

  it('fusionar sobre la cuenta llena una línea que no se junta es 400, y las dos cuentas quedan como estaban', async () => {
    const otra = await abrirCuenta();
    await postOk(`/api/cuentas/${otra.id}/lineas`, {
      itemId: itemIds[MAX_LINEAS_POR_VENTA + 1],
      cantidad: '1',
    });

    const res = await post(`/api/mesas/${mesaId}/cuentas/fusionar`, {
      cuentaIds: [llena.id, otra.id],
    });
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(
      new RegExp(`hasta ${MAX_LINEAS_POR_VENTA} líneas`),
    );

    // La fusión se revirtió entera: la otra cuenta sigue abierta y con su
    // línea, y la llena no ganó ninguna.
    const cuentas = await cuentasDeLaMesa();
    expect(cuentas.find((c) => c.id === llena.id)!.lineas).toHaveLength(
      MAX_LINEAS_POR_VENTA,
    );
    expect(cuentas.find((c) => c.id === otra.id)!.lineas).toHaveLength(1);
  });

  it('fusionar sobre la cuenta llena una línea que se junta con otra sí pasa', async () => {
    // El contraste del anterior: lo que cuenta es con cuántas líneas QUEDA la
    // cuenta, no cuántas trae cada una.
    const otra = await abrirCuenta();
    await postOk(`/api/cuentas/${otra.id}/lineas`, {
      itemId: itemIds[1],
      cantidad: '1',
    });

    const res = await post(`/api/mesas/${mesaId}/cuentas/fusionar`, {
      cuentaIds: [llena.id, otra.id],
    });
    expect(res.status).toBe(201);
    expect((res.body as CuentaDetalle).lineas).toHaveLength(
      MAX_LINEAS_POR_VENTA,
    );
  });
});
