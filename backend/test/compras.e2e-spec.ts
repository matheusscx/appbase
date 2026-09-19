import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { AppModule } from '../src/app.module';
import { loginSegundoTenant } from './helpers/segundo-tenant';
import { Db } from '../src/common/db/db.service';
import { InventarioService } from '../src/modules/inventario/inventario.service';

/**
 * **Compras, pieza 1 — el borrador y la confirmación** (spec
 * `docs/superpowers/specs/2026-09-18-compras-recepcion-design.md` § 4.1, § 4.2
 * y § 5).
 *
 * El borrador (crear, editar, descartar, el folio único por proveedor y tipo,
 * los catálogos del formulario, el descuento al total), confirmar (el stock, el
 * costo, el regalo, los modos serie y lote), rehacer la cuenta, corregir una
 * confirmada (precio, cantidad y descuento), los permisos y el aislamiento
 * entre tenants. Anular es de la tarea siguiente del plan.
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
/** `Leer` y `Crear`, sin `Actualizar`: recibe, pero no corrige. */
const COMPRAS_CARGA_EMAIL = 'compras.carga@paris.cl';
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
  faltaCosto: boolean;
  descuentoTotal: string | null;
  lineas: {
    id: string;
    itemId: string;
    cantidad: string;
    precioUnitario: string | null;
  }[];
  cambios: {
    compraLineaId: string;
    campo: string;
    valorAnterior: string | null;
    valorNuevo: string | null;
    usuarioNombre: string | null;
  }[];
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
  let localId: string;
  let productoId: string;
  let ds: DataSource;
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
    ds = app.get(DataSource);

    token = await login(ADMIN_EMAIL);

    const ubicaciones =
      await get<{ id: string; tipo: string }[]>('/api/ubicaciones');
    localId = ubicaciones.find((u) => u.tipo === 'local')!.id;

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

  describe('confirmar (spec § 4.2)', () => {
    /** Producto propio, sin stock ni costo: el CPP parte de cero. */
    async function productoVacio(
      extra: Record<string, unknown> = {},
    ): Promise<string> {
      return (
        await post<IdResponse>('/api/items', {
          nombre: nombreUnico('Compra confirmar E2E'),
          precioBase: '1000',
          precioIncluyeImpuesto: true,
          monedaId: CLP_MONEDA_ID,
          tipo: 'producto',
          unidadMedida: 'unidad',
          ...extra,
        })
      ).id;
    }

    async function costoActual(itemId: string): Promise<string | null> {
      const item = await get<{ costoActual: string | null }>(
        `/api/items/${itemId}`,
      );
      return item.costoActual == null
        ? null
        : new Decimal(item.costoActual).toFixed(4);
    }

    async function stockEn(itemId: string, ubicacionId: string) {
      const filas: { stock: string }[] = await ds.query(
        `SELECT stock FROM stock_ubicacion WHERE item_id = $1 AND ubicacion_id = $2`,
        [itemId, ubicacionId],
      );
      return filas.length ? Number(filas[0].stock) : 0;
    }

    async function confirmar(
      compraId: string,
      esperado = 201,
      conToken = token,
    ) {
      return post<CompraDetalle>(
        `/api/compras/${compraId}/confirmar`,
        {},
        esperado,
        conToken,
      );
    }

    it('mueve el stock a la ubicación de la compra; la línea sin precio no toca el costo', async () => {
      const itemId = await productoVacio();
      const compra = await post<CompraDetalle>(
        '/api/compras',
        borrador({
          lineas: [
            {
              itemId,
              cantidad: '10',
              unidadCodigo: 'unidad',
              precioUnitario: '1500',
            },
            { itemId, cantidad: '5', unidadCodigo: 'unidad' },
          ],
        }),
      );
      const confirmada = await confirmar(compra.id);
      expect(confirmada.estado).toBe('confirmada');

      expect(await stockEn(itemId, bodegaId)).toBe(15);
      // La primera entrada fija 1.500; la segunda, sin precio, no promedia.
      expect(await costoActual(itemId)).toBe('1500.0000');

      // Cada movimiento cuelga de su línea.
      const movs: { compra_linea_id: string | null; motivo: string }[] =
        await ds.query(
          `SELECT compra_linea_id, motivo FROM movimientos_inventario
            WHERE item_id = $1 AND eliminado_el IS NULL ORDER BY secuencia`,
          [itemId],
        );
      expect(movs).toHaveLength(2);
      expect(movs.every((m) => m.motivo === 'compra')).toBe(true);
      expect(movs.every((m) => m.compra_linea_id != null)).toBe(true);
    });

    it('una compra a la bodega pondera el costo con el stock del local (el total del producto)', async () => {
      // 10 en el local a $1.000, por el ajuste de stock.
      const itemId = await productoVacio();
      const res = await request(app.getHttpServer())
        .patch(`/api/items/${itemId}/stock`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          ubicacionId: localId,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '10',
          costoUnitario: '1000',
        });
      expect(res.status).toBe(200);

      const compra = await post<CompraDetalle>(
        '/api/compras',
        borrador({
          lineas: [
            {
              itemId,
              cantidad: '10',
              unidadCodigo: 'unidad',
              precioUnitario: '1600',
            },
          ],
        }),
      );
      await confirmar(compra.id);
      // (10×1.000 + 10×1.600) / 20 = 1.300. Con el peso de la bodega (0) daría 1.600.
      expect(await costoActual(itemId)).toBe('1300.0000');
    });

    it('lo regalado entra a $0 y el costo promedio lo reparte: $738,4615 la unidad', async () => {
      const itemId = await productoVacio();
      const compra = await post<CompraDetalle>(
        '/api/compras',
        borrador({
          lineas: [
            {
              itemId,
              cantidad: '144',
              unidadCodigo: 'unidad',
              precioUnitario: '800',
            },
            {
              itemId,
              cantidad: '12',
              unidadCodigo: 'unidad',
              precioUnitario: '0',
            },
          ],
        }),
      );
      await confirmar(compra.id);
      // 115.200 / 156
      expect(await costoActual(itemId)).toBe('738.4615');
    });

    it('confirmar dos veces es 409, y una confirmada no se edita ni se descarta', async () => {
      const compra = await post<CompraDetalle>('/api/compras', borrador());
      await confirmar(compra.id);
      expect(
        (await intentar('post', `/api/compras/${compra.id}/confirmar`)).status,
      ).toBe(409);
      expect(
        (
          await intentar(
            'patch',
            `/api/compras/${compra.id}`,
            borrador({ folio: compra.folio }),
          )
        ).status,
      ).toBe(409);
      expect(
        (await intentar('delete', `/api/compras/${compra.id}`)).status,
      ).toBe(409);
    });

    it('una compra sin líneas no se confirma', async () => {
      const compra = await post<CompraDetalle>(
        '/api/compras',
        borrador({ lineas: [] }),
      );
      const r = await intentar('post', `/api/compras/${compra.id}/confirmar`);
      expect(r.status).toBe(400);
      expect(r.message).toContain('no tiene líneas');
    });

    it('con solo Compras:Leer no se confirma', async () => {
      const compra = await post<CompraDetalle>('/api/compras', borrador());
      const lectura = await login(COMPRAS_LECTURA_EMAIL);
      expect(
        (
          await intentar(
            'post',
            `/api/compras/${compra.id}/confirmar`,
            {},
            lectura,
          )
        ).status,
      ).toBe(403);
    });

    it('modo lote: entra el lote con su vencimiento en la bodega', async () => {
      const itemId = await productoVacio({ modoInventario: 'lote' });
      const codigoLote = `LT-COMPRA-${Date.now()}`;
      const compra = await post<CompraDetalle>(
        '/api/compras',
        borrador({
          lineas: [
            {
              itemId,
              cantidad: '6',
              unidadCodigo: 'unidad',
              precioUnitario: '500',
              lote: { codigoLote, fechaVencimiento: '2028-01-31' },
            },
          ],
        }),
      );
      await confirmar(compra.id);
      const lotes = await get<
        {
          codigoLote: string;
          desglosePorUbicacion: { ubicacionId: string; cantidad: string }[];
        }[]
      >(`/api/items/${itemId}/lotes`);
      const lote = lotes.find((l) => l.codigoLote === codigoLote)!;
      expect(
        Number(
          lote.desglosePorUbicacion.find((d) => d.ubicacionId === bodegaId)!
            .cantidad,
        ),
      ).toBe(6);
    });

    it('modo serie: entran las series en la bodega', async () => {
      const itemId = await productoVacio({ modoInventario: 'serie' });
      const marca = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
      const compra = await post<CompraDetalle>(
        '/api/compras',
        borrador({
          lineas: [
            {
              itemId,
              cantidad: '2',
              unidadCodigo: 'unidad',
              precioUnitario: '90000',
              series: [{ serie: `SN-A-${marca}` }, { serie: `SN-B-${marca}` }],
            },
          ],
        }),
      );
      await confirmar(compra.id);
      const unidades = await get<{ serie: string; ubicacionId: string }[]>(
        `/api/items/${itemId}/unidades?estado=disponible`,
      );
      expect(unidades.map((u) => u.serie).sort()).toEqual(
        [`SN-A-${marca}`, `SN-B-${marca}`].sort(),
      );
      expect(unidades.every((u) => u.ubicacionId === bodegaId)).toBe(true);
    });

    async function ajustarStock(itemId: string, body: Record<string, unknown>) {
      const res = await request(app.getHttpServer())
        .patch(`/api/items/${itemId}/stock`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
      expect(res.status).toBe(200);
    }

    /** Confirma una compra de UNA línea sin precio y devuelve su id. */
    async function compraSinPrecio(
      itemId: string,
      cantidad: string,
      ubicacionId: string,
    ): Promise<string> {
      const compra = await post<CompraDetalle>(
        '/api/compras',
        borrador({
          ubicacionId,
          lineas: [{ itemId, cantidad, unidadCodigo: 'unidad' }],
        }),
      );
      await confirmar(compra.id);
      return compra.id;
    }

    /**
     * **Rehacer la cuenta** (spec § 4.3), contra la base real: el recorrido,
     * sus JOIN y `costo_informado` son SQL, y el unitario los mockea.
     *
     * La tarea 7 no tiene endpoint: lo llaman corregir y anular (tareas 8 y 9).
     * Por eso se llama al service directo y el precio de la línea se completa
     * con SQL, en lugar de la corrección de la tarea 8. El e2e de esa tarea
     * repite el tomate por HTTP.
     */
    describe('rehacer la cuenta (spec § 4.3)', () => {
      let usuarioId: string;

      beforeAll(async () => {
        const filas: { usuario_id: string }[] = await ds.query(
          `SELECT usuario_id FROM usuarios WHERE correo = $1 AND eliminado_el IS NULL`,
          [ADMIN_EMAIL],
        );
        usuarioId = filas[0].usuario_id;
      });

      /** En lugar de la corrección de precio de la tarea 8. */
      async function completarPrecio(compraId: string, precio: string) {
        await ds.query(
          `UPDATE compra_lineas SET precio_unitario = $2, costo_unitario_base = $2
            WHERE compra_id = $1`,
          [compraId, precio],
        );
      }

      function rehacerCuenta(itemId: string, compraId: string) {
        return app.get(Db).transaccion((manager) =>
          app.get(InventarioService).recalcularCostoDesdeCompra(manager, {
            tenantId: PARIS_TENANT_ID,
            itemId,
            compraId,
            usuarioId,
            comentario: 'Rehacer la cuenta E2E',
          }),
        );
      }

      async function correcciones(itemId: string) {
        const filas: {
          ubicacion_id: string;
          costo_anterior: string;
          compra_linea_id: string;
        }[] = await ds.query(
          `SELECT ubicacion_id, costo_anterior, compra_linea_id
             FROM movimientos_inventario
            WHERE item_id = $1 AND motivo = 'correccion_compra'
              AND eliminado_el IS NULL`,
          [itemId],
        );
        return filas;
      }

      it('tomate del owner: 10 que entraron sin costo por el ajuste de stock no mueven el promedio → $1.400', async () => {
        const itemId = await productoVacio();
        await ajustarStock(itemId, {
          ubicacionId: localId,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          costoUnitario: '1000',
        });
        const compraId = await compraSinPrecio(itemId, '20', bodegaId);
        await ajustarStock(itemId, {
          ubicacionId: localId,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '10',
        });

        // El kardex dice cuál trajo costo; `costo_unitario` no alcanza: el
        // de los 10 sin costo congeló el CPP de ese momento.
        const kardex: { costo_unitario: string; costo_informado: boolean }[] =
          await ds.query(
            `SELECT costo_unitario, costo_informado FROM movimientos_inventario
              WHERE item_id = $1 AND eliminado_el IS NULL ORDER BY secuencia`,
            [itemId],
          );
        expect(kardex.map((m) => m.costo_informado)).toEqual([
          true,
          false,
          false,
        ]);
        expect(new Decimal(kardex[2].costo_unitario).toFixed(4)).toBe(
          '1000.0000',
        );

        await completarPrecio(compraId, '1500');
        const r = await rehacerCuenta(itemId, compraId);

        // (5 × 1.000 + 20 × 1.500) / 25, y los 10 sin costo no lo mueven.
        // Promediarlos con el $1.000 congelado daba $1.285,71.
        expect(r.costoNuevo).toBe('1400.0000');
        expect(await costoActual(itemId)).toBe('1400.0000');
        const [corr] = await correcciones(itemId);
        expect(corr.ubicacion_id).toBe(bodegaId);
        expect(new Decimal(corr.costo_anterior).toFixed(4)).toBe('1000.0000');
        expect(corr.compra_linea_id).not.toBeNull();
      });

      it('recorre por secuencia aunque creado_el diga otro orden', async () => {
        const itemId = await productoVacio();
        await ajustarStock(itemId, {
          ubicacionId: localId,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          costoUnitario: '1000',
        });
        const compraId = await compraSinPrecio(itemId, '20', localId);
        await ajustarStock(itemId, {
          ubicacionId: localId,
          tipo: 'salida',
          motivo: 'ajuste_manual',
          cantidad: '25',
        });
        // Stock en cero: esta entrada reinicia el costo a $2.000.
        await ajustarStock(itemId, {
          ubicacionId: localId,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '10',
          costoUnitario: '2000',
        });
        expect(await costoActual(itemId)).toBe('2000.0000');

        // Dos transacciones que compiten por el lock del producto pueden
        // quedar con `creado_el` al revés del orden en que se aplicaron
        // (medido en `kardex-secuencia.e2e-spec.ts`). Acá se fija a mano para
        // que sea determinista: la entrada queda "antes" que la salida.
        await ds.query(
          `UPDATE movimientos_inventario e
              SET creado_el = s.creado_el - interval '1 millisecond'
             FROM movimientos_inventario s
            WHERE e.item_id = $1 AND s.item_id = $1
              AND e.tipo = 'entrada' AND e.costo_unitario = 2000
              AND s.tipo = 'salida'`,
          [itemId],
        );

        await completarPrecio(compraId, '1500');
        const r = await rehacerCuenta(itemId, compraId);

        // Por secuencia: la salida deja el stock en cero y la entrada reinicia
        // a $2.000, que ya es el vigente. Por `creado_el`, la entrada promediaba
        // con los 25 a $1.400 y daba $1.571,43.
        expect(r).toEqual({
          costoAnterior: '2000.0000',
          costoNuevo: '2000.0000',
          movimientoId: null,
        });
        expect(await correcciones(itemId)).toHaveLength(0);
      });

      it('si la bodega de la compra se vació y se borró, la corrección va al local', async () => {
        const bodegaEfimera = (
          await post<IdResponse>('/api/ubicaciones', {
            nombre: nombreUnico('Bodega efímera E2E'),
            tipo: 'bodega',
          })
        ).id;
        const itemId = await productoVacio();
        await ajustarStock(itemId, {
          ubicacionId: localId,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          costoUnitario: '1000',
        });
        const compraId = await compraSinPrecio(itemId, '20', bodegaEfimera);
        await ajustarStock(itemId, {
          ubicacionId: bodegaEfimera,
          tipo: 'salida',
          motivo: 'ajuste_manual',
          cantidad: '20',
        });
        const borrado = await request(app.getHttpServer())
          .delete(`/api/ubicaciones/${bodegaEfimera}`)
          .set('Authorization', `Bearer ${token}`);
        expect(borrado.status).toBe(204);

        await completarPrecio(compraId, '1500');
        await rehacerCuenta(itemId, compraId);

        // La salida de la bodega pesa: (5 × 1.000 + 20 × 1.500) / 25 = 1.400,
        // y después quedan 5 a ese costo.
        expect(await costoActual(itemId)).toBe('1400.0000');
        const [corr] = await correcciones(itemId);
        expect(corr.ubicacion_id).toBe(localId);
      });
    });

    it('el descuento al total se carga en el borrador y se reparte al confirmar (spec § 6)', async () => {
      const sinPrecio = await intentar(
        'post',
        '/api/compras',
        borrador({ descuentoTotal: '100' }),
      );
      expect(sinPrecio.status).toBe(400);
      expect(sinPrecio.message).toContain('Falta el precio de alguna línea');

      const itemId = await productoVacio();
      const compra = await post<CompraDetalle>(
        '/api/compras',
        borrador({
          descuentoTotal: '1000',
          lineas: [
            {
              itemId,
              cantidad: '10',
              unidadCodigo: 'unidad',
              precioUnitario: '1000',
            },
          ],
        }),
      );
      expect(new Decimal(compra.descuentoTotal!).toFixed(0)).toBe('1000');

      await confirmar(compra.id);
      // (10 × 1.000 − 1.000) / 10
      expect(await costoActual(itemId)).toBe('900.0000');
    });

    describe('corregir una confirmada (spec § 4.4)', () => {
      async function primeraLinea(compraId: string): Promise<string> {
        return (await get<CompraDetalle>(`/api/compras/${compraId}`)).lineas[0]
          .id;
      }

      function corregirPrecio(
        compraId: string,
        lineaId: string,
        precioUnitario: string,
        conToken = token,
      ) {
        return intentar(
          'patch',
          `/api/compras/${compraId}/lineas/${lineaId}`,
          { precioUnitario },
          conToken,
        );
      }

      function corregirDescuento(
        compraId: string,
        descuentoTotal: string | null,
        conToken = token,
      ) {
        return intentar(
          'patch',
          `/api/compras/${compraId}/descuento`,
          { descuentoTotal },
          conToken,
        );
      }

      it('tomate: completar el precio llega a $1.400, y lo que salió antes queda a $1.000', async () => {
        const itemId = await productoVacio();
        await ajustarStock(itemId, {
          ubicacionId: localId,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          costoUnitario: '1000',
        });
        const compraId = await compraSinPrecio(itemId, '20', bodegaId);
        await ajustarStock(itemId, {
          ubicacionId: bodegaId,
          tipo: 'salida',
          motivo: 'ajuste_manual',
          cantidad: '8',
        });

        const r = await corregirPrecio(
          compraId,
          await primeraLinea(compraId),
          '1500',
        );
        expect(r.status).toBe(200);

        // (5 × 1.000 + 20 × 1.500) / 25
        expect(await costoActual(itemId)).toBe('1400.0000');
        const detalle = await get<CompraDetalle>(`/api/compras/${compraId}`);
        expect(detalle.faltaCosto).toBe(false);
        expect(detalle.cambios).toHaveLength(1);
        expect(detalle.cambios[0]).toMatchObject({
          campo: 'precio',
          valorAnterior: null,
          valorNuevo: '1500',
        });
        expect(detalle.cambios[0].usuarioNombre).not.toBeNull();

        const salida: { costo_unitario: string }[] = await ds.query(
          `SELECT costo_unitario FROM movimientos_inventario
            WHERE item_id = $1 AND tipo = 'salida' AND eliminado_el IS NULL`,
          [itemId],
        );
        expect(new Decimal(salida[0].costo_unitario).toFixed(4)).toBe(
          '1000.0000',
        );
      });

      it('sin Compras:Actualizar es 403 aunque pueda recibir; el encargado sí corrige', async () => {
        const itemId = await productoVacio();
        const carga = await login(COMPRAS_CARGA_EMAIL);
        // Control: `compras.carga` SÍ recibe. Sin esto, su 403 de abajo podría
        // ser por no tener Compras en absoluto.
        const compra = await post<CompraDetalle>(
          '/api/compras',
          borrador({
            lineas: [{ itemId, cantidad: '10', unidadCodigo: 'unidad' }],
          }),
          201,
          carga,
        );
        await confirmar(compra.id, 201, carga);
        const lineaId = await primeraLinea(compra.id);

        expect(
          (await corregirPrecio(compra.id, lineaId, '1500', carga)).status,
        ).toBe(403);
        expect((await corregirDescuento(compra.id, '100', carga)).status).toBe(
          403,
        );
        const lectura = await login(COMPRAS_LECTURA_EMAIL);
        expect(
          (await corregirPrecio(compra.id, lineaId, '1500', lectura)).status,
        ).toBe(403);

        const encargado = await login(ENCARGADO_COMPRAS_EMAIL);
        expect(
          (await corregirPrecio(compra.id, lineaId, '1500', encargado)).status,
        ).toBe(200);
      });

      it('el descuento al total se reparte en el costo; con una línea sin precio es 400', async () => {
        const sinPrecio = await compraSinPrecio(
          await productoVacio(),
          '10',
          bodegaId,
        );
        const falta = await corregirDescuento(sinPrecio, '1000');
        expect(falta.status).toBe(400);
        expect(falta.message).toContain('Falta el precio de alguna línea');

        const itemId = await productoVacio();
        const compra = await post<CompraDetalle>(
          '/api/compras',
          borrador({
            lineas: [
              {
                itemId,
                cantidad: '10',
                unidadCodigo: 'unidad',
                precioUnitario: '1000',
              },
            ],
          }),
        );
        await confirmar(compra.id);
        expect(await costoActual(itemId)).toBe('1000.0000');

        expect((await corregirDescuento(compra.id, '1000')).status).toBe(200);

        // (10 × 1.000 − 1.000) / 10
        expect(await costoActual(itemId)).toBe('900.0000');
        const detalle = await get<CompraDetalle>(`/api/compras/${compra.id}`);
        expect(new Decimal(detalle.descuentoTotal!).toFixed(0)).toBe('1000');
        expect(detalle.cambios.map((c) => c.campo)).toEqual(['descuento']);

        // Sin la clave es 400, no "quitar el descuento": un cliente que se
        // olvida del campo no puede borrar el vigente sin aviso.
        const sinClave = await intentar(
          'patch',
          `/api/compras/${compra.id}/descuento`,
          {},
        );
        expect(sinClave.status).toBe(400);
        expect(await costoActual(itemId)).toBe('900.0000');
      });

      it('la plata que no cabe en la moneda es 400: el descuento en pesos, el precio a 4 decimales', async () => {
        const itemId = await productoVacio();
        const compra = await post<CompraDetalle>(
          '/api/compras',
          borrador({
            lineas: [
              {
                itemId,
                cantidad: '10',
                unidadCodigo: 'unidad',
                precioUnitario: '1000',
              },
            ],
          }),
        );
        await confirmar(compra.id);

        expect((await corregirDescuento(compra.id, '100.5')).status).toBe(400);
        expect(
          (
            await corregirPrecio(
              compra.id,
              await primeraLinea(compra.id),
              '1000.12345',
            )
          ).status,
        ).toBe(400);
      });

      function corregirCantidad(
        compraId: string,
        lineaId: string,
        body: Record<string, unknown>,
      ) {
        return intentar(
          'patch',
          `/api/compras/${compraId}/lineas/${lineaId}`,
          body,
        );
      }

      it('subir la cantidad: el stock entra en la bodega de la compra y la cuenta se rehace', async () => {
        const itemId = await productoVacio();
        await ajustarStock(itemId, {
          ubicacionId: localId,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '5',
          costoUnitario: '1000',
        });
        const compra = await post<CompraDetalle>(
          '/api/compras',
          borrador({
            lineas: [
              {
                itemId,
                cantidad: '10',
                unidadCodigo: 'unidad',
                precioUnitario: '1500',
              },
            ],
          }),
        );
        await confirmar(compra.id);
        // (5 × 1.000 + 10 × 1.500) / 15
        expect(await costoActual(itemId)).toBe('1333.3333');

        const r = await corregirCantidad(
          compra.id,
          await primeraLinea(compra.id),
          { cantidad: '20' },
        );
        expect(r.status).toBe(200);

        expect(await stockEn(itemId, bodegaId)).toBe(20);
        // (5 × 1.000 + 20 × 1.500) / 25: los 10 de más cuentan en su lugar.
        expect(await costoActual(itemId)).toBe('1400.0000');
        const detalle = await get<CompraDetalle>(`/api/compras/${compra.id}`);
        expect(detalle.cambios.map((c) => [c.campo, c.valorNuevo])).toEqual([
          ['cantidad', '20'],
        ]);
      });

      it('bajar lo que ya salió es 400 y dice cuánto queda', async () => {
        const itemId = await productoVacio();
        const compraId = await compraSinPrecio(itemId, '10', bodegaId);
        await ajustarStock(itemId, {
          ubicacionId: bodegaId,
          tipo: 'salida',
          motivo: 'ajuste_manual',
          cantidad: '8',
        });

        const r = await corregirCantidad(
          compraId,
          await primeraLinea(compraId),
          { cantidad: '5' },
        );
        expect(r.status).toBe(400);
        expect(r.message).toContain('quedan 2');
        expect(await stockEn(itemId, bodegaId)).toBe(2);
      });

      it('en serie, subir entra las series nuevas y bajar saca las elegidas', async () => {
        const itemId = await productoVacio({ modoInventario: 'serie' });
        const marca = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        const compra = await post<CompraDetalle>(
          '/api/compras',
          borrador({
            lineas: [
              {
                itemId,
                cantidad: '2',
                unidadCodigo: 'unidad',
                precioUnitario: '90000',
                series: [
                  { serie: `SN-A-${marca}` },
                  { serie: `SN-B-${marca}` },
                ],
              },
            ],
          }),
        );
        await confirmar(compra.id);
        const lineaId = await primeraLinea(compra.id);

        expect(
          (
            await corregirCantidad(compra.id, lineaId, {
              cantidad: '3',
              series: [{ serie: `SN-C-${marca}` }],
            })
          ).status,
        ).toBe(200);
        const disponibles = () =>
          get<{ id: string; serie: string; ubicacionId: string }[]>(
            `/api/items/${itemId}/unidades?estado=disponible`,
          );
        expect((await disponibles()).map((u) => u.serie).sort()).toEqual(
          [`SN-A-${marca}`, `SN-B-${marca}`, `SN-C-${marca}`].sort(),
        );

        const sale = (await disponibles()).find(
          (u) => u.serie === `SN-A-${marca}`,
        )!;
        expect(
          (
            await corregirCantidad(compra.id, lineaId, {
              cantidad: '2',
              unidadIds: [sale.id],
            })
          ).status,
        ).toBe(200);
        expect((await disponibles()).map((u) => u.serie).sort()).toEqual(
          [`SN-B-${marca}`, `SN-C-${marca}`].sort(),
        );

        // Del MISMO producto y en la misma bodega, pero traída por OTRA compra:
        // el kardex la dejaría salir, y es este chequeo el que la frena.
        const otraCompra = await post<CompraDetalle>(
          '/api/compras',
          borrador({
            lineas: [
              {
                itemId,
                cantidad: '1',
                unidadCodigo: 'unidad',
                precioUnitario: '90000',
                series: [{ serie: `SN-D-${marca}` }],
              },
            ],
          }),
        );
        await confirmar(otraCompra.id);
        const deOtraCompra = (await disponibles()).find(
          (u) => u.serie === `SN-D-${marca}`,
        )!;
        const r1 = await corregirCantidad(compra.id, lineaId, {
          cantidad: '1',
          unidadIds: [deOtraCompra.id],
        });
        expect(r1.status).toBe(400);
        expect(r1.message).toContain('de las que trajo esta compra');
        expect((await disponibles()).map((u) => u.serie).sort()).toEqual(
          [`SN-B-${marca}`, `SN-C-${marca}`, `SN-D-${marca}`].sort(),
        );

        // Una unidad de OTRO producto la frena ya el kardex: 400, y no se mueve nada.
        const otro = await productoVacio({ modoInventario: 'serie' });
        await ajustarStock(otro, {
          ubicacionId: bodegaId,
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: '1',
          series: [{ serie: `SN-OTRO-${marca}` }],
        });
        const ajena = (
          await get<{ id: string }[]>(
            `/api/items/${otro}/unidades?estado=disponible`,
          )
        )[0];
        const r = await corregirCantidad(compra.id, lineaId, {
          cantidad: '1',
          unidadIds: [ajena.id],
        });
        expect(r.status).toBe(400);
        expect((await disponibles()).map((u) => u.serie).sort()).toEqual(
          [`SN-B-${marca}`, `SN-C-${marca}`, `SN-D-${marca}`].sort(),
        );
      });

      it('en lote, la diferencia va al mismo lote', async () => {
        const itemId = await productoVacio({ modoInventario: 'lote' });
        const codigoLote = `LT-CORR-${Date.now()}`;
        const compra = await post<CompraDetalle>(
          '/api/compras',
          borrador({
            lineas: [
              {
                itemId,
                cantidad: '6',
                unidadCodigo: 'unidad',
                precioUnitario: '500',
                lote: { codigoLote },
              },
            ],
          }),
        );
        await confirmar(compra.id);
        const lineaId = await primeraLinea(compra.id);

        const enBodega = async () => {
          const lotes = await get<
            {
              codigoLote: string;
              desglosePorUbicacion: { ubicacionId: string; cantidad: string }[];
            }[]
          >(`/api/items/${itemId}/lotes`);
          const lote = lotes.find((l) => l.codigoLote === codigoLote)!;
          return Number(
            lote.desglosePorUbicacion.find((d) => d.ubicacionId === bodegaId)!
              .cantidad,
          );
        };
        expect(
          (await corregirCantidad(compra.id, lineaId, { cantidad: '9' }))
            .status,
        ).toBe(200);
        expect(await enBodega()).toBe(9);
        expect(
          (await corregirCantidad(compra.id, lineaId, { cantidad: '4' }))
            .status,
        ).toBe(200);
        expect(await enBodega()).toBe(4);
      });

      it('un null explícito en el precio o la cantidad es 400, no "no tocar"', async () => {
        const compraId = await compraSinPrecio(
          await productoVacio(),
          '10',
          bodegaId,
        );
        const lineaId = await primeraLinea(compraId);
        // Junto a un campo válido, que es lo que distingue: si el null se
        // tomara como "no tocar", el otro campo se aplicaría y daría 200.
        expect(
          (
            await corregirCantidad(compraId, lineaId, {
              cantidad: '12',
              precioUnitario: null,
            })
          ).status,
        ).toBe(400);
        expect(
          (
            await corregirCantidad(compraId, lineaId, {
              precioUnitario: '1500',
              cantidad: null,
            })
          ).status,
        ).toBe(400);
        expect(
          (await get<CompraDetalle>(`/api/compras/${compraId}`)).cambios,
        ).toHaveLength(0);
      });

      it('un borrador no se corrige: 409', async () => {
        const compra = await post<CompraDetalle>('/api/compras', borrador());
        const r = await corregirPrecio(
          compra.id,
          await primeraLinea(compra.id),
          '1700',
        );
        expect(r.status).toBe(409);
      });

      it('una línea de otra compra, aunque sea del mismo tenant, es 404', async () => {
        const propia = await compraSinPrecio(
          await productoVacio(),
          '10',
          bodegaId,
        );
        const ajena = await compraSinPrecio(
          await productoVacio(),
          '10',
          bodegaId,
        );

        const r = await corregirPrecio(
          propia,
          await primeraLinea(ajena),
          '1500',
        );
        expect(r.status).toBe(404);
        expect(
          (await get<CompraDetalle>(`/api/compras/${ajena}`)).cambios,
        ).toHaveLength(0);
      });

      it('otro tenant no puede corregir una compra de Paris: 404', async () => {
        const compraId = await compraSinPrecio(
          await productoVacio(),
          '10',
          bodegaId,
        );
        const lineaId = await primeraLinea(compraId);
        const otro = await loginSegundoTenant(app);

        expect(
          (await corregirPrecio(compraId, lineaId, '1500', otro)).status,
        ).toBe(404);
        expect((await corregirDescuento(compraId, null, otro)).status).toBe(
          404,
        );
        expect(
          (await get<CompraDetalle>(`/api/compras/${compraId}`)).cambios,
        ).toHaveLength(0);
      });
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

    it('el otro tenant no puede confirmar una compra de Paris: 404, y sigue en borrador', async () => {
      const creada = await post<{ id: string }>('/api/compras', borrador());
      const otro = await loginSegundoTenant(app);
      const r = await intentar(
        'post',
        `/api/compras/${creada.id}/confirmar`,
        {},
        otro,
      );
      expect(r.status).toBe(404);

      const sigue = await get<{ estado: string }>(`/api/compras/${creada.id}`);
      expect(sigue.estado).toBe('borrador');
    });
  });
});
