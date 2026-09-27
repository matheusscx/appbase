import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
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
    app.useGlobalPipes(validacionGlobal());
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

  /**
   * La línea que consume la presentación (Tarea 2, spec § 4.1, § 4.2 y § 4.3):
   * borrador, confirmar (con lo congelado) y corregir una confirmada (con el
   * contenido congelado, nunca el vivo). Helpers `stockEn`, `costoActual` y
   * `confirmar` copiados de `compras.e2e-spec.ts:447-493`; `borrador` y la
   * bodega son propios de este describe.
   */
  describe('la línea con presentación (spec pieza 2 § 4.1, § 4.2 y § 4.3)', () => {
    let ds: DataSource;
    let bodegaId: string;
    let factura: { id: string };

    interface CompraDetalle {
      id: string;
      estado: string;
      lineas: {
        id: string;
        unidadCodigo: string | null;
        presentacion: {
          id: string;
          nombre: string;
          contenido: string;
          unidadCodigo: string;
        } | null;
      }[];
      cambios: {
        campo: string;
        valorAnterior: string | null;
        valorNuevo: string | null;
      }[];
    }

    const folioUnico = () =>
      `PZ2-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    function borrador(lineas: Record<string, unknown>[]) {
      return {
        proveedorId,
        tipoDocumentoCompraId: factura.id,
        folio: folioUnico(),
        fechaDocumento: '2026-09-27',
        ubicacionId: bodegaId,
        lineas,
      };
    }

    async function stockEn(itemId: string, ubicacionId: string) {
      const filas: { stock: string }[] = await ds.query(
        `SELECT stock FROM stock_ubicacion WHERE item_id = $1 AND ubicacion_id = $2`,
        [itemId, ubicacionId],
      );
      return filas.length ? Number(filas[0].stock) : 0;
    }

    async function costoActual(itemId: string): Promise<string | null> {
      const item = await get<{ costoActual: string | null }>(
        `/api/items/${itemId}`,
      );
      return item.costoActual == null
        ? null
        : new Decimal(item.costoActual).toFixed(4);
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

    beforeAll(async () => {
      ds = app.get(DataSource);
      bodegaId = (
        await post<IdResponse>('/api/ubicaciones', {
          nombre: nombreUnico('Bodega presentaciones E2E'),
          tipo: 'bodega',
        })
      ).id;
      const tipos = await get<{ id: string; codigo: string | null }[]>(
        '/api/compras/tipos-documento',
      );
      factura = tipos.find((t) => t.codigo === '33')!;
    });

    it('10 cajas de 12 a $9.600 → 120 unidades a $800; el detalle congela "Caja" y 12', async () => {
      const item = await productoNuevo('unidad');
      const caja = await crear({
        proveedorId,
        itemId: item,
        nombre: 'Caja',
        contenido: '12',
        unidadCodigo: 'unidad',
      });
      const compra = await post<CompraDetalle>(
        '/api/compras',
        borrador([
          {
            itemId: item,
            cantidad: '10',
            presentacionId: caja.id,
            precioUnitario: '9600',
          },
        ]),
      );
      expect(compra.lineas[0]).toMatchObject({
        unidadCodigo: null,
        presentacion: {
          id: caja.id,
          nombre: 'Caja',
          contenido: '12.0000',
          unidadCodigo: 'unidad',
        },
      });
      await confirmar(compra.id);
      expect(await stockEn(item, bodegaId)).toBe(120);
      expect(await costoActual(item)).toBe('800.0000');
      const [linea] = await ds.query(
        `SELECT cantidad_base, costo_unitario_base, presentacion_nombre, contenido_base
           FROM compra_lineas WHERE compra_id = $1`,
        [compra.id],
      );
      expect(linea).toEqual({
        cantidad_base: '120.0000',
        costo_unitario_base: '800.0000',
        presentacion_nombre: 'Caja',
        contenido_base: '12.0000',
      });
    });

    it('3 cajas de 12 a $10.000 → 36 unidades a $833,3333 (no da exacto)', async () => {
      const item = await productoNuevo('unidad');
      const caja = await crear({
        proveedorId,
        itemId: item,
        nombre: 'Caja',
        contenido: '12',
        unidadCodigo: 'unidad',
      });
      const compra = await post<CompraDetalle>(
        '/api/compras',
        borrador([
          {
            itemId: item,
            cantidad: '3',
            presentacionId: caja.id,
            precioUnitario: '10000',
          },
        ]),
      );
      await confirmar(compra.id);
      expect(await stockEn(item, bodegaId)).toBe(36);
      expect(await costoActual(item)).toBe('833.3333');
    });

    it('2 "Saco (25 kg)" de un producto en gramos → 50.000 g', async () => {
      const item = await productoNuevo('g');
      const saco = await crear({
        proveedorId,
        itemId: item,
        nombre: 'Saco',
        contenido: '25',
        unidadCodigo: 'kg',
      });
      const compra = await post<CompraDetalle>(
        '/api/compras',
        borrador([
          {
            itemId: item,
            cantidad: '2',
            presentacionId: saco.id,
            precioUnitario: '2000',
          },
        ]),
      );
      await confirmar(compra.id);
      expect(await stockEn(item, bodegaId)).toBe(50000);
    });

    it('lote: 10 cajas de 12 del lote L123 → 120 en ese lote', async () => {
      const item = await productoNuevo('unidad', { modoInventario: 'lote' });
      const caja = await crear({
        proveedorId,
        itemId: item,
        nombre: 'Caja',
        contenido: '12',
        unidadCodigo: 'unidad',
      });
      const codigoLote = `L123-${Date.now()}`;
      const compra = await post<CompraDetalle>(
        '/api/compras',
        borrador([
          {
            itemId: item,
            cantidad: '10',
            presentacionId: caja.id,
            precioUnitario: '9600',
            lote: { codigoLote },
          },
        ]),
      );
      await confirmar(compra.id);
      const lotes = await get<
        {
          codigoLote: string;
          desglosePorUbicacion: { ubicacionId: string; cantidad: string }[];
        }[]
      >(`/api/items/${item}/lotes`);
      const lote = lotes.find((l) => l.codigoLote === codigoLote)!;
      expect(
        Number(
          lote.desglosePorUbicacion.find((d) => d.ubicacionId === bodegaId)!
            .cantidad,
        ),
      ).toBe(120);
    });

    it('el borrador toma la caja del día: creada con 24, editada a 12 antes de confirmar → 120', async () => {
      const item = await productoNuevo('unidad');
      const caja = await crear({
        proveedorId,
        itemId: item,
        nombre: 'Caja',
        contenido: '24',
        unidadCodigo: 'unidad',
      });
      const compra = await post<CompraDetalle>(
        '/api/compras',
        borrador([
          {
            itemId: item,
            cantidad: '10',
            presentacionId: caja.id,
            precioUnitario: '9600',
          },
        ]),
      );
      await request(app.getHttpServer())
        .patch(`/api/compras/presentaciones/${caja.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ contenido: '12' })
        .expect(200);
      await confirmar(compra.id);
      expect(await stockEn(item, bodegaId)).toBe(120);
    });

    it('retirada entre el borrador y confirmar: 400 que la nombra, y no entra nada', async () => {
      const nombreItem = nombreUnico('Retirada presentación E2E');
      const item = (
        await post<IdResponse>('/api/items', {
          nombre: nombreItem,
          precioBase: '1000',
          precioIncluyeImpuesto: true,
          monedaId: CLP_MONEDA_ID,
          tipo: 'producto',
          unidadMedida: 'unidad',
        })
      ).id;
      const caja = await crear({
        proveedorId,
        itemId: item,
        nombre: 'Caja',
        contenido: '12',
        unidadCodigo: 'unidad',
      });
      const compra = await post<CompraDetalle>(
        '/api/compras',
        borrador([
          {
            itemId: item,
            cantidad: '10',
            presentacionId: caja.id,
            precioUnitario: '9600',
          },
        ]),
      );
      await intentar('delete', `/api/compras/presentaciones/${caja.id}`);
      const r = await intentar('post', `/api/compras/${compra.id}/confirmar`);
      expect(r.status).toBe(400);
      expect(r.message).toContain(nombreItem);
      expect(r.message).toContain('retirada');
      expect(await stockEn(item, bodegaId)).toBe(0);
      const detalle = await get<CompraDetalle>(`/api/compras/${compra.id}`);
      expect(detalle.estado).toBe('borrador');
    });

    it('presentación de otro proveedor o de otro producto: 400 al guardar', async () => {
      const item1 = await productoNuevo('unidad');
      const item2 = await productoNuevo('unidad');
      const cajaDeOtroProveedor = await crear({
        proveedorId: otroProveedorId,
        itemId: item1,
        nombre: nombreUnico('Caja'),
        contenido: '12',
        unidadCodigo: 'unidad',
      });
      const rProveedor = await intentar(
        'post',
        '/api/compras',
        borrador([
          {
            itemId: item1,
            cantidad: '10',
            presentacionId: cajaDeOtroProveedor.id,
            precioUnitario: '9600',
          },
        ]),
      );
      expect(rProveedor.status).toBe(400);
      expect(rProveedor.message).toContain('otro proveedor');

      const cajaDeItem2 = await crear({
        proveedorId,
        itemId: item2,
        nombre: nombreUnico('Caja'),
        contenido: '12',
        unidadCodigo: 'unidad',
      });
      const rProducto = await intentar(
        'post',
        '/api/compras',
        borrador([
          {
            itemId: item1,
            cantidad: '10',
            presentacionId: cajaDeItem2.id,
            precioUnitario: '9600',
          },
        ]),
      );
      expect(rProducto.status).toBe(400);
      expect(rProducto.message).toContain('no es de');
    });

    it('las dos (unidadCodigo y presentacionId) o ninguna: 400', async () => {
      const item = await productoNuevo('unidad');
      const caja = await crear({
        proveedorId,
        itemId: item,
        nombre: nombreUnico('Caja'),
        contenido: '12',
        unidadCodigo: 'unidad',
      });
      const rAmbas = await intentar(
        'post',
        '/api/compras',
        borrador([
          {
            itemId: item,
            cantidad: '10',
            unidadCodigo: 'unidad',
            presentacionId: caja.id,
            precioUnitario: '9600',
          },
        ]),
      );
      expect(rAmbas.status).toBe(400);
      const rNinguna = await intentar(
        'post',
        '/api/compras',
        borrador([{ itemId: item, cantidad: '10', precioUnitario: '9600' }]),
      );
      expect(rNinguna.status).toBe(400);
    });

    it('presentación de otro tenant en la línea: 400, igual que una que no existe', async () => {
      const otro = await loginSegundoTenant(app);
      const monedas = await get<{ monedaId: string; esOficial: boolean }[]>(
        '/api/monedas',
        200,
        otro,
      );
      const monedaOtro = monedas.find((m) => m.esOficial)!.monedaId;
      const provOtro = (
        await post<IdResponse>(
          '/api/terceros',
          { tipo: 'proveedor', nombre: nombreUnico('Prov otro tenant') },
          201,
          otro,
        )
      ).id;
      const itemOtro = (
        await post<IdResponse>(
          '/api/items',
          {
            nombre: nombreUnico('Item otro tenant'),
            precioBase: '1000',
            precioIncluyeImpuesto: true,
            monedaId: monedaOtro,
            tipo: 'producto',
            unidadMedida: 'unidad',
          },
          201,
          otro,
        )
      ).id;
      const cajaOtroTenant = await crear(
        {
          proveedorId: provOtro,
          itemId: itemOtro,
          nombre: 'Caja',
          contenido: '12',
          unidadCodigo: 'unidad',
        },
        201,
        otro,
      );

      const item = await productoNuevo('unidad');
      const r = await intentar(
        'post',
        '/api/compras',
        borrador([
          {
            itemId: item,
            cantidad: '10',
            presentacionId: cajaOtroTenant.id,
            precioUnitario: '9600',
          },
        ]),
      );
      expect(r.status).toBe(400);
      expect(r.message).toContain('ya no existe o fue retirada');
    });

    it('confirmada con 12, la caja pasa a 6, bajar a 8 cajas saca 24 unidades (usa el congelado)', async () => {
      const item = await productoNuevo('unidad');
      const caja = await crear({
        proveedorId,
        itemId: item,
        nombre: 'Caja',
        contenido: '12',
        unidadCodigo: 'unidad',
      });
      const compra = await post<CompraDetalle>(
        '/api/compras',
        borrador([
          {
            itemId: item,
            cantidad: '10',
            presentacionId: caja.id,
            precioUnitario: '9600',
          },
        ]),
      );
      await confirmar(compra.id);
      await request(app.getHttpServer())
        .patch(`/api/compras/presentaciones/${caja.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ contenido: '6' })
        .expect(200);
      const lineaId = (await get<CompraDetalle>(`/api/compras/${compra.id}`))
        .lineas[0].id;
      const r = await intentar(
        'patch',
        `/api/compras/${compra.id}/lineas/${lineaId}`,
        { cantidad: '8' },
      );
      expect(r.status).toBe(200);
      expect(await stockEn(item, bodegaId)).toBe(96); // 120 − 2 × 12, no 120 − 2 × 6
      const detalle = await get<CompraDetalle>(`/api/compras/${compra.id}`);
      expect(detalle.lineas[0].presentacion).toMatchObject({
        nombre: 'Caja',
        contenido: '12.0000',
      });
      // `valorAnterior` sale de `cl.cantidad` leído de Postgres (NUMERIC(18,4)
      // → '10.0000'), no del string tipeado; `valorNuevo` es `dto.cantidad!`
      // tal como lo mandó el cliente ('8'). Medido con este mismo e2e: el
      // molde de `compras.e2e-spec.ts:~1216` solo afirma `valorNuevo`.
      expect(
        detalle.cambios.map((c) => [c.campo, c.valorAnterior, c.valorNuevo]),
      ).toEqual([['cantidad', '10.0000', '8']]);
    });

    it('retirar la presentación no cambia el detalle de una confirmada', async () => {
      const item = await productoNuevo('unidad');
      const caja = await crear({
        proveedorId,
        itemId: item,
        nombre: 'Caja',
        contenido: '12',
        unidadCodigo: 'unidad',
      });
      const compra = await post<CompraDetalle>(
        '/api/compras',
        borrador([
          {
            itemId: item,
            cantidad: '10',
            presentacionId: caja.id,
            precioUnitario: '9600',
          },
        ]),
      );
      await confirmar(compra.id);
      await intentar('delete', `/api/compras/presentaciones/${caja.id}`);
      const detalle = await get<CompraDetalle>(`/api/compras/${compra.id}`);
      expect(detalle.lineas[0].presentacion).toMatchObject({ nombre: 'Caja' });
    });
  });
});
