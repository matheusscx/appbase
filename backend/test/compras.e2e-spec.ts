import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loginSegundoTenant } from './helpers/segundo-tenant';

/**
 * **Compras, pieza 1 — el borrador** (spec
 * `docs/superpowers/specs/2026-09-18-compras-recepcion-design.md` § 4.1 y § 5).
 *
 * Solo el borrador: crear, editar, descartar, el folio único por proveedor y
 * tipo, los catálogos del formulario, los permisos y el aislamiento entre
 * tenants. Confirmar, corregir y anular son de las tareas siguientes del plan.
 *
 * Proveedor, bodega y producto son **propios** del spec, con nombre único, y
 * el folio también: el archivo no depende de lo que dejaron otras suites.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ENCARGADO_COMPRAS_EMAIL = 'encargado.compras@paris.cl';
/** Tiene `Salones`, no `Compras`: sirve para el 403. */
const SIN_COMPRAS_EMAIL = 'encargado.salon@paris.cl';
/** Solo `Compras:Leer`: el que distingue "ver" de "recibir". */
const COMPRAS_LECTURA_EMAIL = 'compras.lectura@paris.cl';
const PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface TipoDocumento {
  id: string;
  nombre: string;
  codigo: string | null;
  requiereFolio: boolean;
}
interface Proveedor {
  id: string;
  nombre: string;
}
interface CompraDetalle {
  id: string;
  estado: string;
  folio: string | null;
  proveedorNombre: string | null;
  total: string | null;
  lineas: { itemId: string; cantidad: string; precioUnitario: string | null }[];
}
interface Paginado<T> {
  data: T[];
  meta: { total: number };
}

describe('Compras — borrador (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let proveedorId: string;
  let otroProveedorId: string;
  let empresaId: string;
  let bodegaId: string;
  let productoId: string;
  let factura: TipoDocumento;
  let sinDocumento: TipoDocumento;

  const nombreUnico = (base: string) =>
    `${base} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const folioUnico = () =>
    `E2E-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

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

  function borrador(extra: Record<string, unknown> = {}) {
    return {
      proveedorId,
      tipoDocumentoCompraId: factura.id,
      folio: folioUnico(),
      fechaDocumento: '2026-09-15',
      ubicacionId: bodegaId,
      lineas: [
        {
          itemId: productoId,
          cantidad: '10',
          unidadCodigo: 'kg',
          precioUnitario: '1500',
        },
        { itemId: productoId, cantidad: '500', unidadCodigo: 'g' },
      ],
      ...extra,
    };
  }

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
        nombre: nombreUnico('Distribuidora E2E'),
      })
    ).id;
    otroProveedorId = (
      await post<IdResponse>('/api/terceros', {
        tipo: 'proveedor',
        nombre: nombreUnico('Otra distribuidora E2E'),
      })
    ).id;
    empresaId = (
      await post<IdResponse>('/api/terceros', {
        tipo: 'empresa',
        nombre: nombreUnico('Empresa cliente E2E'),
      })
    ).id;
    bodegaId = (
      await post<IdResponse>('/api/ubicaciones', {
        nombre: nombreUnico('Bodega compras E2E'),
        tipo: 'bodega',
      })
    ).id;
    productoId = (
      await post<IdResponse>('/api/items', {
        nombre: nombreUnico('Harina compras E2E'),
        precioBase: '1000',
        precioIncluyeImpuesto: true,
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'kg',
        stock: '1',
        costo: '500',
      })
    ).id;

    const tipos = await get<TipoDocumento[]>('/api/compras/tipos-documento');
    factura = tipos.find((t) => t.codigo === '33')!;
    sinDocumento = tipos.find((t) => !t.requiereFolio)!;
  }, 120000);

  afterAll(async () => {
    await app.close();
  });

  it('los documentos son los seis de Chile, con "Sin documento" sin folio', async () => {
    const tipos = await get<TipoDocumento[]>('/api/compras/tipos-documento');
    expect(tipos.map((t) => t.codigo).sort()).toEqual(
      ['33', '34', '39', '46', '52', null].sort(),
    );
    expect(sinDocumento.nombre).toBe('Sin documento');
    expect(sinDocumento.requiereFolio).toBe(false);
  });

  it('los proveedores incluyen al del spec y no a un tercero "empresa"', async () => {
    const provs = await get<Proveedor[]>('/api/compras/proveedores');
    const ids = provs.map((p) => p.id);
    expect(ids).toContain(proveedorId);
    expect(ids).not.toContain(empresaId);
  });

  it('crea un borrador con una línea sin precio, y el detalle lo muestra', async () => {
    const creado = await post<CompraDetalle>('/api/compras', borrador());
    expect(creado.estado).toBe('borrador');

    const detalle = await get<CompraDetalle>(`/api/compras/${creado.id}`);
    expect(detalle.lineas).toHaveLength(2);
    expect(detalle.lineas[0].precioUnitario).toBe('1500.0000');
    expect(detalle.lineas[1].precioUnitario).toBeNull();
    // Falta un precio: el total no se puede afirmar.
    expect(detalle.total).toBeNull();
  });

  it('editar reemplaza las líneas enteras', async () => {
    const creado = await post<CompraDetalle>('/api/compras', borrador());
    const res = await request(app.getHttpServer())
      .patch(`/api/compras/${creado.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(
        borrador({
          folio: creado.folio,
          lineas: [
            {
              itemId: productoId,
              cantidad: '3',
              unidadCodigo: 'kg',
              precioUnitario: '1000',
            },
          ],
        }),
      );
    expect(res.status).toBe(200);
    const detalle = res.body as CompraDetalle;
    expect(detalle.lineas).toHaveLength(1);
    expect(detalle.total).toBe('3000');
  });

  it('el mismo folio del mismo proveedor y tipo es 409, y nombra la compra', async () => {
    const folio = folioUnico();
    await post<CompraDetalle>('/api/compras', borrador({ folio }));
    const r = await intentar('post', '/api/compras', borrador({ folio }));
    expect(r.status).toBe(409);
    expect(r.message).toContain(folio);
    expect(r.message).toContain('Distribuidora E2E');
  });

  it('el mismo folio con OTRO proveedor pasa', async () => {
    const folio = folioUnico();
    await post<CompraDetalle>('/api/compras', borrador({ folio }));
    await post<CompraDetalle>(
      '/api/compras',
      borrador({ folio, proveedorId: otroProveedorId }),
    );
  });

  it('"Sin documento" entra sin folio, y dos compras sin documento no chocan', async () => {
    const a = await post<CompraDetalle>(
      '/api/compras',
      borrador({ tipoDocumentoCompraId: sinDocumento.id, folio: undefined }),
    );
    const b = await post<CompraDetalle>(
      '/api/compras',
      borrador({ tipoDocumentoCompraId: sinDocumento.id, folio: undefined }),
    );
    expect(a.folio).toBeNull();
    expect(b.folio).toBeNull();
  });

  // `@EsCosto()` sin `EscalaMonedaPipe` no valida nada: el precio llegaba a
  // `numeric(18,4)` y Postgres lo redondeaba en silencio. Decisión del owner:
  // 400, nunca cuantizar a escondidas.
  it('un precio con más de 4 decimales es 400, no se redondea en silencio', async () => {
    const r = await intentar(
      'post',
      '/api/compras',
      borrador({
        lineas: [
          {
            itemId: productoId,
            cantidad: '10',
            unidadCodigo: 'kg',
            precioUnitario: '1500.123456',
          },
        ],
      }),
    );
    expect(r.status).toBe(400);
  });

  it('un tercero que no es proveedor es 400', async () => {
    const r = await intentar(
      'post',
      '/api/compras',
      borrador({ proveedorId: empresaId }),
    );
    expect(r.status).toBe(400);
    expect(r.message).toContain('no es un proveedor');
  });

  it('el listado filtra por estado', async () => {
    const creado = await post<CompraDetalle>('/api/compras', borrador());
    const pagina = await get<Paginado<CompraDetalle>>(
      `/api/compras?estado=borrador&proveedorId=${proveedorId}&pageSize=100`,
    );
    expect(pagina.data.map((c) => c.id)).toContain(creado.id);
    const confirmadas = await get<Paginado<CompraDetalle>>(
      `/api/compras?estado=confirmada&proveedorId=${proveedorId}`,
    );
    expect(confirmadas.data.map((c) => c.id)).not.toContain(creado.id);
  });

  it('descartar un borrador lo saca: el detalle da 404', async () => {
    const creado = await post<CompraDetalle>('/api/compras', borrador());
    const res = await request(app.getHttpServer())
      .delete(`/api/compras/${creado.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    await get(`/api/compras/${creado.id}`, 404);
  });

  it('descartado, su folio queda libre para cargarlo de nuevo', async () => {
    const folio = folioUnico();
    const creado = await post<CompraDetalle>(
      '/api/compras',
      borrador({ folio }),
    );
    const res = await request(app.getHttpServer())
      .delete(`/api/compras/${creado.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    await post<CompraDetalle>('/api/compras', borrador({ folio }));
  });

  describe('permisos', () => {
    it('sin el módulo Compras: 403 al leer y al crear', async () => {
      const sinCompras = await login(SIN_COMPRAS_EMAIL);
      expect(
        (await intentar('get', '/api/compras', {}, sinCompras)).status,
      ).toBe(403);
      expect(
        (await intentar('post', '/api/compras', borrador(), sinCompras)).status,
      ).toBe(403);
    });

    it('el encargado de compras, sin ser admin, lee y crea', async () => {
      const encargado = await login(ENCARGADO_COMPRAS_EMAIL);
      await get('/api/compras', 200, encargado);
      await post<CompraDetalle>('/api/compras', borrador(), 201, encargado);
    });

    // El control que separa `Leer` de `Crear`. Sin él, un guard que pidiera
    // `Leer` en el POST pasaba la suite entera (medido): los otros dos
    // usuarios dan el mismo resultado con cualquiera de las dos acciones.
    it('con solo Compras:Leer, ve el listado pero no puede crear, editar ni descartar', async () => {
      const lectura = await login(COMPRAS_LECTURA_EMAIL);
      await get('/api/compras', 200, lectura);
      await get('/api/compras/tipos-documento', 200, lectura);
      expect(
        (await intentar('post', '/api/compras', borrador(), lectura)).status,
      ).toBe(403);

      const ajena = await post<CompraDetalle>('/api/compras', borrador());
      expect(
        (
          await intentar(
            'patch',
            `/api/compras/${ajena.id}`,
            borrador({ folio: ajena.folio }),
            lectura,
          )
        ).status,
      ).toBe(403);
      expect(
        (await intentar('delete', `/api/compras/${ajena.id}`, {}, lectura))
          .status,
      ).toBe(403);
    });
  });

  describe('aislamiento entre tenants', () => {
    it('una compra de Paris no existe para el otro tenant', async () => {
      const creado = await post<CompraDetalle>('/api/compras', borrador());
      const otro = await loginSegundoTenant(app);
      await get(`/api/compras/${creado.id}`, 404, otro);
    });

    it('el otro tenant no puede usar al proveedor de Paris', async () => {
      const otro = await loginSegundoTenant(app);
      // El body entero es de Paris; el primer rechazo es el proveedor ajeno, con
      // el mismo mensaje que uno inexistente.
      const r = await intentar('post', '/api/compras', borrador(), otro);
      expect(r.status).toBe(400);
      expect(r.message).toBe('Proveedor no encontrado');
    });
  });
});
