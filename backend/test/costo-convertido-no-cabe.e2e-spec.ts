import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';

/**
 * Un costo que cabe por la unidad en que se tipea y no por la unidad base es
 * 400 antes de escribir, no 500 (`assertCostoConvertidoCabe`). El techo del DTO
 * mira el costo tal como llega, y el costo se guarda por unidad base: $99
 * billones por gramo caben, y por kilo son ×1000. Medido el 2026-10-13: el
 * ajuste de costo, el ajuste de stock, el cambio de unidad de un producto con
 * costo, la compra con una unidad o una presentación menor que la base y la
 * corrección de su precio daban 500 (`docs/agent/resueltos.md`, "Un costo que
 * cabe en su unidad y no por la unidad base").
 *
 * Decisión del owner (2026-10-13): "Sí, con aviso". El aviso dice cuánto
 * sería el costo por la unidad base; no cambia cómo se convierte ni qué se
 * guarda.
 *
 * ⚠️ Sin `eliminado_el IS NULL` en los conteos de "no escribió nada", a
 * propósito: lo que se cuenta es si el pedido escribió algo, y una fila borrada
 * también sería una escritura.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const FACTURA_COMPRA = '550e8400-e29b-41d4-a716-446655440420';

/** Cabe en `NUMERIC(18,4)` por gramo; por kilo, ×1000, no. */
const POR_GRAMO = '99999999999999';
const MENSAJE =
  'El costo por kg sería de $99.999.999.999.999.000: el sistema no puede guardar costos de $100.000.000.000.000 o más';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
type Respuesta = { status: number; body: unknown };
type Pedido = [string, () => Promise<Respuesta>];

describe('Un costo que no cabe por la unidad base es 400, no 500 (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let marca: string;
  let kiloId: string;
  let proveedorId: string;
  let ubicacionId: string;

  function pedir(
    metodo: 'post' | 'patch',
    ruta: string,
    body: object = {},
  ): Promise<Respuesta> {
    return request(app.getHttpServer())
      [metodo](`/api/${ruta}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  }

  async function crear<T = IdResponse>(ruta: string, body: object): Promise<T> {
    const res = await pedir('post', ruta, body);
    expect(res.status).toBe(201);
    return res.body as T;
  }

  /** Cada pedido, con su nombre en el error: un 500 dice cuál fue. */
  async function rechazados(pedidos: Pedido[]) {
    for (const [que, hacer] of pedidos) {
      const res = await hacer();
      const m = (res.body as { message?: string | string[] }).message ?? '';
      expect({
        que,
        status: res.status,
        mensaje: [m].flat().join(' '),
      }).toEqual({ que, status: 400, mensaje: MENSAJE });
    }
  }

  /** El costo vigente y los movimientos del producto: lo que no debe moverse. */
  async function estado(itemId: string) {
    const [fila]: { costo: string | null; movimientos: string }[] =
      await ds.query(
        // Sin `eliminado_el` en el conteo: ver el encabezado.
        `SELECT ip.costo_actual::text AS costo,
                (SELECT count(*) FROM movimientos_inventario mi
                  WHERE mi.item_id = ip.item_id)::text AS movimientos
           FROM item_producto ip
          WHERE ip.item_id = $1`,
        [itemId],
      );
    return fila;
  }

  const compra = (linea: object) => ({
    proveedorId,
    tipoDocumentoCompraId: FACTURA_COMPRA,
    folio: `F${randomUUID().slice(0, 8)}`,
    fechaDocumento: '2026-09-15',
    ubicacionId,
    totalDocumento: POR_GRAMO,
    lineas: [
      { itemId: kiloId, cantidad: '1', precioUnitario: POR_GRAMO, ...linea },
    ],
  });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_PARIS.email, password: ADMIN_PARIS.pass });
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

    marca = randomUUID().slice(0, 8);
    kiloId = (
      await crear('items', {
        nombre: `Harina por kilo E2E ${marca}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        clasificacionTributaria: 'exento',
        unidadMedida: 'kg',
        stock: '10',
        costo: '100',
      })
    ).id;
    proveedorId = (
      await crear('terceros', {
        tipo: 'proveedor',
        nombre: `Proveedor costo E2E ${marca}`,
      })
    ).id;
    const [local]: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones
        WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID],
    );
    ubicacionId = local.ubicacion_id;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('el ajuste de costo y el de stock, tipeados por gramo en un producto por kilo', async () => {
    const antes = await estado(kiloId);
    await rechazados([
      [
        'ajuste de costo',
        () =>
          pedir('post', 'inventario/ajustes-costo', {
            itemId: kiloId,
            costoNuevo: POR_GRAMO,
            comentario: 'Costo por gramo E2E',
            unidadCodigo: 'g',
          }),
      ],
      [
        'ajuste de stock',
        () =>
          pedir('patch', `items/${kiloId}/stock`, {
            ubicacionId,
            cantidad: '1',
            tipo: 'entrada',
            motivo: 'compra',
            costoUnitario: POR_GRAMO,
            unidadCodigo: 'g',
          }),
      ],
    ]);
    expect(await estado(kiloId)).toEqual(antes);
  });

  it('el cambio de unidad de un producto con costo: de gramo a kilo', async () => {
    // Sin stock no hay movimientos, y sin movimientos la unidad se puede
    // cambiar: el costo vigente se reconvierte a la unidad nueva.
    const gramo = await crear('items', {
      nombre: `Azafrán por gramo E2E ${marca}`,
      precioBase: '1000',
      monedaId: CLP_MONEDA_ID,
      tipo: 'producto',
      clasificacionTributaria: 'exento',
      unidadMedida: 'g',
      costo: POR_GRAMO,
    });
    const antes = await estado(gramo.id);
    expect(antes.costo).toBe('99999999999999.0000');

    await rechazados([
      [
        'cambiar la unidad',
        () =>
          pedir('patch', `items/${gramo.id}`, {
            unidadMedida: 'kg',
            precioBase: '1000000',
          }),
      ],
    ]);
    expect(await estado(gramo.id)).toEqual(antes);
    const [producto]: { unidad: string }[] = await ds.query(
      `SELECT unidad_medida AS unidad FROM item_producto WHERE item_id = $1`,
      [gramo.id],
    );
    expect(producto.unidad).toBe('g');
  });

  it('la compra con una unidad o una presentación menor que la base, al confirmar y al corregir', async () => {
    const sobre = await crear('compras/presentaciones', {
      proveedorId,
      itemId: kiloId,
      nombre: 'Sobre',
      contenido: '1',
      unidadCodigo: 'g',
    });
    const enGramos = await crear('compras', compra({ unidadCodigo: 'g' }));
    const porSobre = await crear(
      'compras',
      compra({ presentacionId: sobre.id }),
    );
    // Una confirmada a $1 por gramo, para corregirle el precio.
    const confirmada = await crear('compras', {
      ...compra({ unidadCodigo: 'g', precioUnitario: '1' }),
      totalDocumento: '1',
    });
    expect(
      (await pedir('post', `compras/${confirmada.id}/confirmar`)).status,
    ).toBe(201);
    const [linea]: { id: string; precio: string; costo: string }[] =
      await ds.query(
        `SELECT compra_linea_id AS id, precio_unitario::text AS precio,
                costo_unitario_base::text AS costo
           FROM compra_lineas WHERE compra_id = $1 AND eliminado_el IS NULL`,
        [confirmada.id],
      );
    expect(linea.costo).toBe('1000.0000');
    const antes = await estado(kiloId);

    await rechazados([
      [
        'confirmar la línea en gramos',
        () => pedir('post', `compras/${enGramos.id}/confirmar`),
      ],
      [
        'confirmar la línea por sobre de 1 g',
        () => pedir('post', `compras/${porSobre.id}/confirmar`),
      ],
      [
        'corregir el precio de la línea en gramos',
        () =>
          pedir('patch', `compras/${confirmada.id}/lineas/${linea.id}`, {
            precioUnitario: POR_GRAMO,
          }),
      ],
    ]);

    expect(await estado(kiloId)).toEqual(antes);
    const estados: { estado: string }[] = await ds.query(
      `SELECT estado FROM compras
        WHERE compra_id = ANY($1) AND eliminado_el IS NULL`,
      [[enGramos.id, porSobre.id]],
    );
    expect(estados).toEqual([{ estado: 'borrador' }, { estado: 'borrador' }]);
    const [despues]: { precio: string; costo: string }[] = await ds.query(
      `SELECT precio_unitario::text AS precio,
              costo_unitario_base::text AS costo
         FROM compra_lineas WHERE compra_linea_id = $1 AND eliminado_el IS NULL`,
      [linea.id],
    );
    expect(despues).toEqual({ precio: linea.precio, costo: linea.costo });
  });

  it('control: el costo que cabe por kilo entra, aunque se tipee por gramo', async () => {
    const res = await pedir('post', 'inventario/ajustes-costo', {
      itemId: kiloId,
      costoNuevo: '99999999999.9999',
      comentario: 'Costo máximo E2E',
      unidadCodigo: 'g',
    });
    expect(res.status).toBe(201);
    expect((await estado(kiloId)).costo).toBe('99999999999999.9000');
  });
});
