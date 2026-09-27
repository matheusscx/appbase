import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loginSegundoTenant } from './helpers/segundo-tenant';

/**
 * **Compras, pieza 2 — presentaciones de compra por proveedor** (spec
 * `docs/superpowers/specs/2026-09-27-compras-unidad-de-compra-design.md` § 3.1
 * y § 5): cómo le viene un producto a un proveedor ("Caja (12)", "Saco (25
 * kg)"), su CRUD y el seed. La línea que la consume es la Tarea 2.
 *
 * Proveedor, productos y presentaciones son **propios** del archivo, con
 * nombre único: no depende de lo que dejaron otras suites.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ENCARGADO_COMPRAS_EMAIL = 'encargado.compras@paris.cl';
/** Solo `Compras:Leer`: el que distingue "ver" de "cargar". */
const COMPRAS_LECTURA_EMAIL = 'compras.lectura@paris.cl';
const PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
/** Espejo de `PresentacionCompraVista` (`presentaciones-compra.service.ts`). */
interface PresentacionVista {
  id: string;
  proveedorId: string;
  itemId: string;
  nombre: string;
  contenido: string;
  unidadCodigo: string;
}

describe('presentaciones de compra (spec pieza 2 § 5)', () => {
  let app: INestApplication<App>;
  let token: string;
  let proveedorId: string;
  let otroProveedorId: string;
  let empresaId: string;
  let latas: string;
  let harinaG: string;
  let yogurt: string;
  let celular: string;

  const nombreUnico = (base: string) =>
    `${base} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  async function login(email: string): Promise<string> {
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: PASS });
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
    return (resTenant.body as TokenResponse).access_token;
  }

  async function post<T>(
    url: string,
    body: Record<string, unknown>,
    esperado = 201,
    conToken = token,
  ): Promise<T> {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${conToken}`)
      .send(body);
    expect(res.status).toBe(esperado);
    return res.body as T;
  }

  async function get<T>(
    url: string,
    esperado = 200,
    conToken = token,
  ): Promise<T> {
    const res = await request(app.getHttpServer())
      .get(url)
      .set('Authorization', `Bearer ${conToken}`);
    expect(res.status).toBe(esperado);
    return res.body as T;
  }

  /** El intento crudo: status y mensaje, para afirmar sobre los dos. */
  async function intentar(
    metodo: 'post' | 'patch' | 'get' | 'delete',
    url: string,
    body: Record<string, unknown> = {},
    conToken = token,
  ): Promise<{ status: number; message: string }> {
    const res = await request(app.getHttpServer())
      [metodo](url)
      .set('Authorization', `Bearer ${conToken}`)
      .send(body);
    const message = (res.body as { message?: string | string[] }).message;
    return {
      status: res.status,
      message: Array.isArray(message) ? message.join(' ') : (message ?? ''),
    };
  }

  /** Un producto propio, con nombre único, en la unidad pedida. */
  async function productoNuevo(
    unidad: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    return (
      await post<IdResponse>('/api/items', {
        nombre: nombreUnico('Presentación E2E'),
        precioBase: '1000',
        precioIncluyeImpuesto: true,
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: unidad,
        ...extra,
      })
    ).id;
  }

  const crear = (
    body: Record<string, unknown>,
    esperado = 201,
    conToken = token,
  ) =>
    post<PresentacionVista>(
      '/api/compras/presentaciones',
      body,
      esperado,
      conToken,
    );

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

    token = await login(ADMIN_EMAIL);

    proveedorId = (
      await post<IdResponse>('/api/terceros', {
        tipo: 'proveedor',
        nombre: nombreUnico('Distribuidora presentaciones E2E'),
      })
    ).id;
    otroProveedorId = (
      await post<IdResponse>('/api/terceros', {
        tipo: 'proveedor',
        nombre: nombreUnico('Otra distribuidora presentaciones E2E'),
      })
    ).id;
    empresaId = (
      await post<IdResponse>('/api/terceros', {
        tipo: 'empresa',
        nombre: nombreUnico('Empresa cliente presentaciones E2E'),
      })
    ).id;

    latas = await productoNuevo('unidad');
    harinaG = await productoNuevo('g');
    yogurt = await productoNuevo('unidad', { modoInventario: 'lote' });
    celular = await productoNuevo('unidad', { modoInventario: 'serie' });
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  it('crea "Caja (12)" y la lista con el proveedor', async () => {
    const caja = await crear({
      proveedorId,
      itemId: latas,
      nombre: ' Caja ',
      contenido: '12',
      unidadCodigo: 'unidad',
    });
    expect(caja).toMatchObject({
      proveedorId,
      itemId: latas,
      nombre: 'Caja',
      contenido: '12.0000',
      unidadCodigo: 'unidad',
    });
    const lista = await get<PresentacionVista[]>(
      `/api/compras/presentaciones?proveedorId=${proveedorId}`,
    );
    expect(lista.map((p) => p.id)).toContain(caja.id);
    const deOtro = await get<PresentacionVista[]>(
      `/api/compras/presentaciones?proveedorId=${otroProveedorId}`,
    );
    expect(deOtro.map((p) => p.id)).not.toContain(caja.id);
  });

  it('"Saco (25 kg)" de un producto en gramos se acepta: la unidad es compatible', async () => {
    await crear({
      proveedorId,
      itemId: harinaG,
      nombre: 'Saco',
      contenido: '25',
      unidadCodigo: 'kg',
    });
  });

  it('un producto por lote se acepta: "lote sí, serie no" (spec § 2)', async () => {
    await crear({
      proveedorId,
      itemId: yogurt,
      nombre: 'Bandeja',
      contenido: '10',
      unidadCodigo: 'unidad',
    });
  });

  it('unidad incompatible, producto por serie o contenido 0 son 400', async () => {
    expect(
      (
        await intentar('post', '/api/compras/presentaciones', {
          proveedorId,
          itemId: latas,
          nombre: 'Caja',
          contenido: '12',
          unidadCodigo: 'kg',
        })
      ).status,
    ).toBe(400);
    const serie = await intentar('post', '/api/compras/presentaciones', {
      proveedorId,
      itemId: celular,
      nombre: 'Caja',
      contenido: '10',
      unidadCodigo: 'unidad',
    });
    expect(serie.status).toBe(400);
    expect(serie.message).toContain('serie');
    expect(
      (
        await intentar('post', '/api/compras/presentaciones', {
          proveedorId,
          itemId: latas,
          nombre: 'Caja',
          contenido: '0',
          unidadCodigo: 'unidad',
        })
      ).status,
    ).toBe(400);
  });

  it('nombre de solo espacios o un tercero que no es proveedor son 400', async () => {
    expect(
      (
        await intentar('post', '/api/compras/presentaciones', {
          proveedorId,
          itemId: latas,
          nombre: '   ',
          contenido: '12',
          unidadCodigo: 'unidad',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await intentar('post', '/api/compras/presentaciones', {
          proveedorId: empresaId,
          itemId: latas,
          nombre: 'Caja',
          contenido: '12',
          unidadCodigo: 'unidad',
        })
      ).status,
    ).toBe(400);
  });

  it('el mismo nombre vivo del mismo par es 409 (sin distinguir mayúsculas); retirada, se puede repetir', async () => {
    const item = await productoNuevo('unidad');
    const a = await crear({
      proveedorId,
      itemId: item,
      nombre: 'Pack',
      contenido: '6',
      unidadCodigo: 'unidad',
    });
    const r = await intentar('post', '/api/compras/presentaciones', {
      proveedorId,
      itemId: item,
      nombre: 'PACK',
      contenido: '12',
      unidadCodigo: 'unidad',
    });
    expect(r.status).toBe(409);
    await intentar('delete', `/api/compras/presentaciones/${a.id}`);
    await crear({
      proveedorId,
      itemId: item,
      nombre: 'Pack',
      contenido: '12',
      unidadCodigo: 'unidad',
    });
  });

  it('editar corrige 24 → 12; null es 400; ausente no toca', async () => {
    const item = await productoNuevo('unidad');
    const c = await crear({
      proveedorId,
      itemId: item,
      nombre: 'Caja',
      contenido: '24',
      unidadCodigo: 'unidad',
    });
    const r = await request(app.getHttpServer())
      .patch(`/api/compras/presentaciones/${c.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ contenido: '12' });
    expect(r.status).toBe(200);
    expect(r.body as PresentacionVista).toMatchObject({
      nombre: 'Caja',
      contenido: '12.0000',
    });
    expect(
      (
        await intentar('patch', `/api/compras/presentaciones/${c.id}`, {
          contenido: null,
        })
      ).status,
    ).toBe(400);
  });

  it('retirar la saca del listado; retirar dos veces es 404', async () => {
    const item = await productoNuevo('unidad');
    const c = await crear({
      proveedorId,
      itemId: item,
      nombre: 'Caja',
      contenido: '12',
      unidadCodigo: 'unidad',
    });
    expect(
      (await intentar('delete', `/api/compras/presentaciones/${c.id}`)).status,
    ).toBe(204);
    const lista = await get<PresentacionVista[]>(
      `/api/compras/presentaciones?proveedorId=${proveedorId}`,
    );
    expect(lista.map((p) => p.id)).not.toContain(c.id);
    expect(
      (await intentar('delete', `/api/compras/presentaciones/${c.id}`)).status,
    ).toBe(404);
  });

  it('solo Compras:Leer es 403 en los cuatro; el encargado de compras crea', async () => {
    const lectura = await login(COMPRAS_LECTURA_EMAIL);
    const c = await crear(
      {
        proveedorId,
        itemId: latas,
        nombre: `Pack ${Date.now()}`,
        contenido: '6',
        unidadCodigo: 'unidad',
      },
      201,
      await login(ENCARGADO_COMPRAS_EMAIL),
    );
    expect(
      (
        await intentar(
          'get',
          `/api/compras/presentaciones?proveedorId=${proveedorId}`,
          {},
          lectura,
        )
      ).status,
    ).toBe(403);
    expect(
      (await intentar('post', '/api/compras/presentaciones', {}, lectura))
        .status,
    ).toBe(403);
    expect(
      (
        await intentar(
          'patch',
          `/api/compras/presentaciones/${c.id}`,
          { contenido: '8' },
          lectura,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await intentar(
          'delete',
          `/api/compras/presentaciones/${c.id}`,
          {},
          lectura,
        )
      ).status,
    ).toBe(403);
  });

  it('otro tenant: no la lista, editarla o retirarla es 404, y no crea una para el proveedor de Paris', async () => {
    const c = await crear({
      proveedorId,
      itemId: latas,
      nombre: `Six ${Date.now()}`,
      contenido: '6',
      unidadCodigo: 'unidad',
    });
    const otro = await loginSegundoTenant(app);
    const lista = await get<PresentacionVista[]>(
      `/api/compras/presentaciones?proveedorId=${proveedorId}`,
      200,
      otro,
    );
    expect(lista).toEqual([]);
    expect(
      (
        await intentar(
          'patch',
          `/api/compras/presentaciones/${c.id}`,
          { contenido: '8' },
          otro,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await intentar(
          'delete',
          `/api/compras/presentaciones/${c.id}`,
          {},
          otro,
        )
      ).status,
    ).toBe(404);
    const r = await intentar(
      'post',
      '/api/compras/presentaciones',
      {
        proveedorId,
        itemId: latas,
        nombre: 'Caja',
        contenido: '12',
        unidadCodigo: 'unidad',
      },
      otro,
    );
    expect(r).toEqual({ status: 400, message: 'Proveedor no encontrado' });
  });

  it('el seed deja "Bolsa (24)" y "Caja (10 kg)" de Distribuidora Andina', async () => {
    const lista = await get<PresentacionVista[]>(
      '/api/compras/presentaciones?proveedorId=550e8400-e29b-41d4-a716-446655440147',
    );
    expect(lista.map((p) => [p.nombre, p.contenido, p.unidadCodigo])).toEqual(
      expect.arrayContaining([
        ['Bolsa', '24.0000', 'unidad'],
        ['Caja', '10.0000', 'kg'],
      ]),
    );
  });
});
