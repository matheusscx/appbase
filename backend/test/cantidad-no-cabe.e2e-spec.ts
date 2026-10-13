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
 * Una cantidad de kardex que no cabe en `NUMERIC(18,4)` es 400 antes de
 * escribir, no 500. Tres formas, medidas el 2026-10-13 por HTTP
 * (`docs/agent/resueltos.md`, "Una cantidad por body sin techo"):
 *
 * - el campo tal como llega (`IsDecimalPersistible(18, 4)` en el DTO);
 * - la cantidad ya convertida a la unidad del producto
 *   (`assertCantidadConvertidaCabe`): 10^12 kg caben y son 10^15 g;
 * - lo que se acumula: el stock del producto sumando todas las ubicaciones
 *   (`registrarMovimiento`, bajo su lock) y lo que entró a un lote
 *   (`cantidad_inicial`). Sin el primero, 9×10^13 en el local y otro tanto en
 *   la bodega dejaban `GET /items` en 500 para el tenant entero: este spec lo
 *   hizo con las suites que corrían después, en la primera versión.
 *
 * Decisión del owner (2026-10-13): "Sí, con aviso". El aviso dice la cantidad
 * ya convertida; no cambia qué se escribe ni cómo se convierte.
 *
 * ⚠️ Sin `eliminado_el IS NULL` en los conteos de "no escribió nada", a
 * propósito: lo que se cuenta es si el pedido escribió algo, y una fila borrada
 * también sería una escritura.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const FACTURA_COMPRA = '550e8400-e29b-41d4-a716-446655440420';

/** El primer valor que no cabe en `NUMERIC(18,4)`. */
const NO_CABE = '100000000000000';
/** Cabe sola; dos juntas, no. */
const CASI = '90000000000000';
const TECHO = '100.000.000.000.000';
const EN_EL_DTO = `no puede ser de ${TECHO} o más: el sistema no puede guardar valores así`;
const NO_GUARDA = `el sistema no puede guardar cantidades de ${TECHO} o más`;

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
type Respuesta = { status: number; body: unknown };
type Pedido = [string, () => Promise<Respuesta>, string];

describe('Una cantidad que no cabe en su columna es 400, no 500 (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let marca: string;
  let localId: string;
  let bodegaId: string;
  let proveedorId: string;
  let motivoTrasladoId: string;

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

  /**
   * Cada pedido, con su nombre, y todos antes de comparar: un rojo dice cuáles
   * fueron, no solo el primero.
   */
  async function rechazados(pedidos: Pedido[]) {
    const obtenido: { que: string; status: number; mensaje: string }[] = [];
    for (const [que, hacer] of pedidos) {
      const res = await hacer();
      const m = (res.body as { message?: string | string[] }).message ?? '';
      obtenido.push({ que, status: res.status, mensaje: [m].flat().join(' ') });
    }
    expect(obtenido).toEqual(
      pedidos.map(([que, , mensaje]) => ({ que, status: 400, mensaje })),
    );
  }

  const nombre = (base: string) =>
    `${base} E2E ${marca} ${randomUUID().slice(0, 4)}`;

  const producto = async (unidadMedida: string, extra: object = {}) =>
    (
      await crear('items', {
        nombre: nombre('Cantidad'),
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        clasificacionTributaria: 'exento',
        unidadMedida,
        ...extra,
      })
    ).id;

  const ingrediente = async (unidadMedida: string) =>
    (
      await crear('items', {
        nombre: nombre('Insumo'),
        precioBase: '10',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida,
        // Costo 0: con costo, 10^14 g en una receta los frena antes el techo
        // del costo de la receta, y el del DTO quedaría sin ejercer.
        costo: '0',
      })
    ).id;

  const ajuste = (itemId: string, body: object) =>
    pedir('patch', `items/${itemId}/stock`, {
      ubicacionId: localId,
      tipo: 'entrada',
      motivo: 'ajuste_manual',
      ...body,
    });

  const compra = (lineas: object[], totalDocumento: string) => ({
    proveedorId,
    tipoDocumentoCompraId: FACTURA_COMPRA,
    folio: `F${randomUUID().slice(0, 8)}`,
    fechaDocumento: '2026-09-15',
    ubicacionId: localId,
    totalDocumento,
    lineas,
  });

  /** El saldo por ubicación y los movimientos del producto: lo que no debe moverse. */
  async function estado(itemId: string) {
    const [fila]: { saldos: string | null; movimientos: string }[] =
      await ds.query(
        // Sin `eliminado_el` en el conteo: ver el encabezado.
        `SELECT (SELECT string_agg(su.ubicacion_id || '=' || su.stock::text, ','
                                   ORDER BY su.ubicacion_id)
                   FROM stock_ubicacion su WHERE su.item_id = $1) AS saldos,
                (SELECT count(*) FROM movimientos_inventario mi
                  WHERE mi.item_id = $1)::text AS movimientos`,
        [itemId],
      );
    return fila;
  }

  async function contar(sql: string, params: unknown[]): Promise<string> {
    const [fila]: { n: string }[] = await ds.query(sql, params);
    return String(fila.n);
  }

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
    const [local]: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones
        WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID],
    );
    localId = local.ubicacion_id;
    // Bodega PROPIA: el spec le carga saldos que no caben juntos.
    bodegaId = (
      await crear('ubicaciones', { nombre: nombre('Bodega'), tipo: 'bodega' })
    ).id;
    proveedorId = (
      await crear('terceros', {
        tipo: 'proveedor',
        nombre: nombre('Proveedor'),
      })
    ).id;
    const [motivo]: { id: string }[] = await ds.query(
      `SELECT motivo_traslado_id AS id FROM motivo_traslado
        WHERE tenant_id = $1 AND activo AND eliminado_el IS NULL
        ORDER BY motivo_traslado_id LIMIT 1`,
      [PARIS_TENANT_ID],
    );
    motivoTrasladoId = motivo.id;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('el campo tal como llega: ajuste, stock inicial, receta, compra, presentación, traslado y grupos', async () => {
    const unidad = await producto('unidad');
    const gramo = await producto('g');
    const harina = await ingrediente('g');
    const sobre = await crear('compras/presentaciones', {
      proveedorId,
      itemId: gramo,
      nombre: 'Sobre',
      contenido: '1',
      unidadCodigo: 'g',
    });
    // Un borrador y una confirmada, para editar y corregir la línea.
    const linea = {
      itemId: unidad,
      cantidad: '1',
      unidadCodigo: 'unidad',
      precioUnitario: '1',
    };
    const borrador = await crear('compras', compra([linea], '1'));
    const confirmada = await crear('compras', compra([linea], '1'));
    expect(
      (await pedir('post', `compras/${confirmada.id}/confirmar`)).status,
    ).toBe(201);
    const [lineaConfirmada]: { id: string }[] = await ds.query(
      `SELECT compra_linea_id AS id FROM compra_lineas
        WHERE compra_id = $1 AND eliminado_el IS NULL`,
      [confirmada.id],
    );
    const grupo = await crear<{
      grupoModificadorId: string;
      opciones: { grupoOpcionId: string }[];
    }>('grupos-modificadores', {
      nombre: nombre('Grupo'),
      opciones: [{ itemId: harina, precioExtra: '0' }],
    });
    const receta = await crear('items', {
      nombre: nombre('Receta'),
      precioBase: '1000',
      monedaId: CLP_MONEDA_ID,
      tipo: 'receta',
      ingredientes: [
        { ingredienteItemId: harina, cantidad: '1', unidadCodigo: 'g' },
      ],
      gruposModificadores: [
        { grupoModificadorId: grupo.grupoModificadorId, min: 1, max: 1 },
      ],
    });
    const [itemGrupo]: { id: string }[] = await ds.query(
      `SELECT item_grupo_id AS id FROM item_grupos_modificadores
        WHERE item_id = $1 AND eliminado_el IS NULL`,
      [receta.id],
    );
    const recetaCon = (extra: object) =>
      pedir('post', 'items', {
        nombre: nombre('Receta'),
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          { ingredienteItemId: harina, cantidad: '1', unidadCodigo: 'g' },
        ],
        ...extra,
      });

    const antes = {
      unidad: await estado(unidad),
      items: await contar(
        `SELECT count(*) AS n FROM items WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      ),
      compras: await contar(
        `SELECT count(*) AS n FROM compras WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      ),
      lineas: await ds.query(
        `SELECT compra_id, cantidad::text FROM compra_lineas
          WHERE compra_id = ANY($1) ORDER BY compra_id`,
        [[borrador.id, confirmada.id]],
      ),
      presentaciones: await ds.query(
        `SELECT count(*)::text AS n, max(contenido)::text AS max
           FROM presentaciones_compra WHERE item_id = $1`,
        [gramo],
      ),
      opciones: await ds.query(
        `SELECT count(*)::text AS n FROM grupo_modificador_opciones
          WHERE grupo_modificador_id = $1 AND cantidad IS NOT NULL`,
        [grupo.grupoModificadorId],
      ),
      overrides: await contar(
        `SELECT count(*) AS n FROM item_grupo_modificador_opciones
          WHERE item_grupo_id = $1`,
        [itemGrupo.id],
      ),
    };

    await rechazados([
      [
        'ajuste de stock',
        () => ajuste(unidad, { cantidad: NO_CABE }),
        `cantidad ${EN_EL_DTO}`,
      ],
      [
        'stock inicial de un producto nuevo',
        () =>
          pedir('post', 'items', {
            nombre: nombre('Inicial'),
            precioBase: '1000',
            monedaId: CLP_MONEDA_ID,
            tipo: 'producto',
            clasificacionTributaria: 'exento',
            unidadMedida: 'unidad',
            stock: NO_CABE,
          }),
        `stock ${EN_EL_DTO}`,
      ],
      [
        'ingrediente de una receta',
        () =>
          pedir('post', 'items', {
            nombre: nombre('Receta'),
            precioBase: '1000',
            monedaId: CLP_MONEDA_ID,
            tipo: 'receta',
            ingredientes: [
              {
                ingredienteItemId: harina,
                cantidad: NO_CABE,
                unidadCodigo: 'g',
              },
            ],
          }),
        `ingredientes.0.cantidad ${EN_EL_DTO}`,
      ],
      [
        'extra permitido de una receta',
        () =>
          recetaCon({
            extrasPermitidos: [
              {
                ingredienteItemId: harina,
                cantidad: NO_CABE,
                unidadCodigo: 'g',
                precioExtra: '0',
              },
            ],
          }),
        `extrasPermitidos.0.cantidad ${EN_EL_DTO}`,
      ],
      [
        'override de una opción al crear la receta',
        () =>
          recetaCon({
            gruposModificadores: [
              {
                grupoModificadorId: grupo.grupoModificadorId,
                min: 1,
                max: 1,
                opciones: [
                  {
                    grupoOpcionId: grupo.opciones[0].grupoOpcionId,
                    cantidad: NO_CABE,
                    unidadCodigo: 'g',
                  },
                ],
              },
            ],
          }),
        `gruposModificadores.0.opciones.0.cantidad ${EN_EL_DTO}`,
      ],
      [
        'aplicar un override a todos',
        () =>
          pedir(
            'patch',
            `grupos-modificadores/${grupo.grupoModificadorId}/overrides`,
            {
              itemGrupoIds: [itemGrupo.id],
              grupoOpcionId: grupo.opciones[0].grupoOpcionId,
              cantidad: NO_CABE,
              unidadCodigo: 'g',
            },
          ),
        `cantidad ${EN_EL_DTO}`,
      ],
      [
        'opción de un grupo nuevo',
        () =>
          pedir('post', 'grupos-modificadores', {
            nombre: nombre('Grupo'),
            opciones: [
              {
                itemId: harina,
                cantidad: NO_CABE,
                unidadCodigo: 'g',
                precioExtra: '0',
              },
            ],
          }),
        `opciones.0.cantidad ${EN_EL_DTO}`,
      ],
      [
        'opción al editar el grupo',
        () =>
          pedir('patch', `grupos-modificadores/${grupo.grupoModificadorId}`, {
            opciones: [
              {
                itemId: harina,
                cantidad: NO_CABE,
                unidadCodigo: 'g',
                precioExtra: '0',
              },
            ],
          }),
        `opciones.0.cantidad ${EN_EL_DTO}`,
      ],
      [
        'línea de una compra nueva',
        () =>
          pedir(
            'post',
            'compras',
            compra(
              [{ ...linea, cantidad: NO_CABE, precioUnitario: '0.0001' }],
              '10000000000',
            ),
          ),
        `lineas.0.cantidad ${EN_EL_DTO}`,
      ],
      [
        'línea al editar el borrador',
        () =>
          pedir(
            'patch',
            `compras/${borrador.id}`,
            compra(
              [{ ...linea, cantidad: NO_CABE, precioUnitario: '0.0001' }],
              '10000000000',
            ),
          ),
        `lineas.0.cantidad ${EN_EL_DTO}`,
      ],
      [
        'corrección de cantidad de una compra confirmada',
        () =>
          pedir(
            'patch',
            `compras/${confirmada.id}/lineas/${lineaConfirmada.id}`,
            {
              cantidad: NO_CABE,
            },
          ),
        `cantidad ${EN_EL_DTO}`,
      ],
      [
        'contenido de una presentación nueva',
        () =>
          pedir('post', 'compras/presentaciones', {
            proveedorId,
            itemId: gramo,
            nombre: 'Gigante',
            contenido: NO_CABE,
            unidadCodigo: 'g',
          }),
        `contenido ${EN_EL_DTO}`,
      ],
      [
        'contenido al editar la presentación',
        () =>
          pedir('patch', `compras/presentaciones/${sobre.id}`, {
            contenido: NO_CABE,
          }),
        `contenido ${EN_EL_DTO}`,
      ],
      [
        'línea de un traslado',
        () =>
          pedir('post', 'traslados', {
            origenId: localId,
            destinoId: bodegaId,
            motivoTrasladoId,
            lineas: [{ itemId: unidad, cantidad: NO_CABE }],
          }),
        `lineas.0.cantidad ${EN_EL_DTO}`,
      ],
    ]);

    expect({
      unidad: await estado(unidad),
      items: await contar(
        `SELECT count(*) AS n FROM items WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      ),
      compras: await contar(
        `SELECT count(*) AS n FROM compras WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      ),
      lineas: await ds.query(
        `SELECT compra_id, cantidad::text FROM compra_lineas
          WHERE compra_id = ANY($1) ORDER BY compra_id`,
        [[borrador.id, confirmada.id]],
      ),
      presentaciones: await ds.query(
        `SELECT count(*)::text AS n, max(contenido)::text AS max
           FROM presentaciones_compra WHERE item_id = $1`,
        [gramo],
      ),
      opciones: await ds.query(
        `SELECT count(*)::text AS n FROM grupo_modificador_opciones
          WHERE grupo_modificador_id = $1 AND cantidad IS NOT NULL`,
        [grupo.grupoModificadorId],
      ),
      overrides: await contar(
        `SELECT count(*) AS n FROM item_grupo_modificador_opciones
          WHERE item_grupo_id = $1`,
        [itemGrupo.id],
      ),
    }).toEqual(antes);
  });

  it('la cantidad ya convertida a la unidad del producto: ajuste y compra, por unidad y por presentación', async () => {
    const gramo = await producto('g');
    const saco = await crear('compras/presentaciones', {
      proveedorId,
      itemId: gramo,
      nombre: 'Saco',
      contenido: '1000',
      unidadCodigo: 'kg',
    });
    // 10^8 sacos de 1000 kg: la línea cabe y son 10^14 g.
    const porSaco = await crear(
      'compras',
      compra(
        [
          {
            itemId: gramo,
            cantidad: '100000000',
            presentacionId: saco.id,
            precioUnitario: '10000',
          },
        ],
        '1000000000000',
      ),
    );
    const antes = await estado(gramo);
    const comprasAntes = await contar(
      `SELECT count(*) AS n FROM compras WHERE tenant_id = $1`,
      [PARIS_TENANT_ID],
    );

    await rechazados([
      [
        'ajuste de stock en kg de un producto por gramo',
        () => ajuste(gramo, { cantidad: '1000000000000', unidadCodigo: 'kg' }),
        `La cantidad en g sería de 1.000.000.000.000.000: ${NO_GUARDA}`,
      ],
      [
        'borrador de compra en kg de un producto por gramo',
        () =>
          pedir(
            'post',
            'compras',
            compra(
              [
                {
                  itemId: gramo,
                  cantidad: '1000000000000',
                  unidadCodigo: 'kg',
                  precioUnitario: '1',
                },
              ],
              '1000000000000',
            ),
          ),
        `La cantidad en g sería de 1.000.000.000.000.000: ${NO_GUARDA}`,
      ],
      [
        'confirmar la compra por saco de 1000 kg',
        () => pedir('post', `compras/${porSaco.id}/confirmar`),
        `La cantidad en g sería de ${TECHO}: ${NO_GUARDA}`,
      ],
    ]);

    expect(await estado(gramo)).toEqual(antes);
    expect(
      await contar(`SELECT count(*) AS n FROM compras WHERE tenant_id = $1`, [
        PARIS_TENANT_ID,
      ]),
    ).toBe(comprasAntes);
    const [{ estado: estadoCompra }]: { estado: string }[] = await ds.query(
      `SELECT estado FROM compras WHERE compra_id = $1 AND eliminado_el IS NULL`,
      [porSaco.id],
    );
    expect(estadoCompra).toBe('borrador');
  });

  it('lo que se acumula: el stock de todas las ubicaciones y lo que entró a un lote', async () => {
    // Cada entrada cabe; la suma, no. En la misma ubicación y en otra.
    const enLocal = await producto('unidad');
    expect((await ajuste(enLocal, { cantidad: CASI })).status).toBe(200);
    const enCompra = await crear(
      'compras',
      compra(
        [
          {
            itemId: enLocal,
            cantidad: CASI,
            unidadCodigo: 'unidad',
            precioUnitario: '0.0001',
          },
        ],
        '9000000000',
      ),
    );
    // Lote: el saldo vuelve a 0 y `cantidad_inicial` sigue sumando.
    const loteado = await producto('unidad', { modoInventario: 'lote' });
    const lote = { lote: { codigoLote: `L${marca}` } };
    expect((await ajuste(loteado, { cantidad: CASI, ...lote })).status).toBe(
      200,
    );
    const [{ id: loteId }]: { id: string }[] = await ds.query(
      `SELECT lote_id AS id FROM item_lote WHERE item_id = $1 AND eliminado_el IS NULL`,
      [loteado],
    );
    expect(
      (await ajuste(loteado, { cantidad: CASI, tipo: 'salida', loteId }))
        .status,
    ).toBe(200);

    const [{ nombre }]: { nombre: string }[] = await ds.query(
      `SELECT nombre FROM items WHERE item_id = $1 AND eliminado_el IS NULL`,
      [enLocal],
    );
    const total = `El stock de "${nombre}" sumando todas las ubicaciones quedaría en 180.000.000.000.000 unidad: ${NO_GUARDA}`;
    const antes = await Promise.all([enLocal, loteado].map(estado));
    const [{ inicial }]: { inicial: string }[] = await ds.query(
      `SELECT cantidad_inicial::text AS inicial FROM item_lote WHERE lote_id = $1`,
      [loteId],
    );

    await rechazados([
      [
        'ajuste en la misma ubicación',
        () => ajuste(enLocal, { cantidad: CASI }),
        total,
      ],
      [
        'ajuste en otra ubicación',
        () => ajuste(enLocal, { cantidad: CASI, ubicacionId: bodegaId }),
        total,
      ],
      [
        'confirmar una compra',
        () => pedir('post', `compras/${enCompra.id}/confirmar`),
        total,
      ],
      [
        'volver a entrar el mismo lote',
        () => ajuste(loteado, { cantidad: CASI, ...lote }),
        `Lo que entró al lote L${marca} sumaría 180.000.000.000.000: ${NO_GUARDA}`,
      ],
    ]);

    expect(await Promise.all([enLocal, loteado].map(estado))).toEqual(antes);
    // Y el catálogo se sigue leyendo: el listado castea el total a
    // `numeric(18,4)`, y 9×10^13 en dos ubicaciones lo dejaban en 500.
    const listado = await request(app.getHttpServer())
      .get(`/api/items?search=${encodeURIComponent(nombre)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(listado.status).toBe(200);
    const [despues]: { inicial: string }[] = await ds.query(
      `SELECT cantidad_inicial::text AS inicial FROM item_lote WHERE lote_id = $1`,
      [loteId],
    );
    expect(despues.inicial).toBe(inicial);
    const [{ estado: estadoCompra }]: { estado: string }[] = await ds.query(
      `SELECT estado FROM compras WHERE compra_id = $1 AND eliminado_el IS NULL`,
      [enCompra.id],
    );
    expect(estadoCompra).toBe('borrador');

    // Un traslado no cambia el total: 9×10^13 del local a la bodega entran.
    const traslado = await pedir('post', 'traslados', {
      origenId: localId,
      destinoId: bodegaId,
      motivoTrasladoId,
      lineas: [{ itemId: enLocal, cantidad: CASI }],
    });
    expect(traslado.status).toBe(201);
  });

  it('control: el máximo que cabe entra, tipeado en la base y convertido', async () => {
    const unidad = await producto('unidad');
    expect(
      (await ajuste(unidad, { cantidad: '99999999999999.9999' })).status,
    ).toBe(200);
    const gramo = await producto('g');
    expect(
      (
        await ajuste(gramo, {
          cantidad: '99999999999.9999',
          unidadCodigo: 'kg',
        })
      ).status,
    ).toBe(200);
    const saldos: { stock: string }[] = await ds.query(
      `SELECT stock::text FROM stock_ubicacion
        WHERE item_id = ANY($1) AND ubicacion_id = $2 ORDER BY stock`,
      [[unidad, gramo], localId],
    );
    expect(saldos).toEqual([
      { stock: '99999999999999.9000' },
      { stock: '99999999999999.9999' },
    ]);
  });
});
