import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { abrirCaja } from './helpers/caja';
import { bodyPreferencias } from './helpers/preferencias';

/**
 * Un monto suelto que no cabe en su columna es 400 en el borde, no 500 en el
 * `INSERT` (`IsMontoPersistible`). Medido el 2026-10-12 con 10^14: los 36
 * campos `@EsMontoCobrado`/`@EsCosto` de abajo daban 500 —salvo tres que ya
 * frenaba el service con su propio 400—, y el de la liquidación de propinas
 * daba 500 recién con un participante real. La tabla campo por campo está en
 * `docs/agent/resueltos.md`; que la marca y el techo no se separen lo cuida
 * `monto-persistible-cobertura.spec.ts`. Los seis que cerró el frente anterior
 * (caja, pagos, pago a proveedor) siguen en `caja-esperado-no-cabe.e2e-spec.ts`.
 *
 * Un bloque por módulo: el pedido mínimo que llega hasta la columna, con el
 * monto que no cabe en UN campo. Al final, controles: el máximo que cabe pasa,
 * y `tenants.monto_tolerancia`, que es `NUMERIC(18,6)`, tiene su techo en 10^12
 * y no en 10^14.
 *
 * ⚠️ Sin `eliminado_el IS NULL` en los conteos de "no escribió nada", a
 * propósito: lo que se cuenta es si el pedido escribió algo, y una fila borrada
 * también sería una escritura. Cada conteo lo recuerda donde está.
 *
 * ⚠️ Lo que este archivo deja en la base del seed —una caja contada, una
 * liquidación confirmada, una compra confirmada— es de sus propios ítems,
 * garzón y proveedor. Las preferencias de Paris se restauran en `afterAll`.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
const TIPO_DESCUENTO_DIRECTO = '550e8400-e29b-41d4-a716-446655440337';
const TIPO_DESCUENTO_POR_MONTO = '550e8400-e29b-41d4-a716-446655440119';
const TIPO_RECARGO_GENERAL = '550e8400-e29b-41d4-a716-446655440122';
const TIPO_RECARGO_POR_MONTO = '550e8400-e29b-41d4-a716-446655440353';
const FACTURA_COMPRA = '550e8400-e29b-41d4-a716-446655440420';

/** 10^14: el primer monto que no cabe en `NUMERIC(18,4)`. */
const NO_CABE = '100000000000000';
const MENSAJE = 'no puede ser de $100.000.000.000.000 o más';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
type Respuesta = { status: number; body: unknown };
type Pedido = [string, () => Promise<Respuesta>];

describe('Un monto suelto que no cabe en su columna es 400, no 500 (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let marca: string;
  let productoId: string;
  let ingredienteId: string;
  let proveedorId: string;
  let ubicacionId: string;
  let preferencias: object;
  let cajaId: string | undefined;
  let cuentaId: string | undefined;
  let garzon: { id: string; pin: string } | undefined;

  function pedir(
    metodo: 'post' | 'patch' | 'put',
    ruta: string,
    body: object,
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

  function mensaje(res: Respuesta): string {
    const m = (res.body as { message?: string | string[] }).message ?? '';
    return [m].flat().join(' ');
  }

  /** Cada pedido, con su nombre en el error: un 500 dice cuál fue. */
  async function rechazados(pedidos: Pedido[], esperado = MENSAJE) {
    for (const [que, hacer] of pedidos) {
      const res = await hacer();
      expect({ que, status: res.status }).toEqual({ que, status: 400 });
      expect({ que, mensaje: mensaje(res) }).toEqual({
        que,
        mensaje: expect.stringContaining(esperado) as string,
      });
    }
  }

  async function contar(sql: string, params: unknown[]): Promise<number> {
    const filas: { n: string }[] = await ds.query(sql, params);
    return Number(filas[0].n);
  }

  const compra = (extra: object = {}) => ({
    proveedorId,
    tipoDocumentoCompraId: FACTURA_COMPRA,
    folio: `F${randomUUID().slice(0, 8)}`,
    fechaDocumento: '2026-09-15',
    ubicacionId,
    lineas: [
      {
        itemId: productoId,
        cantidad: '2',
        unidadCodigo: 'unidad',
        precioUnitario: '100',
      },
    ],
    ...extra,
  });

  const receta = (extra: object = {}) => ({
    nombre: `Receta techo E2E ${randomUUID().slice(0, 8)}`,
    precioBase: '4000',
    monedaId: CLP_MONEDA_ID,
    tipo: 'receta',
    clasificacionTributaria: 'exento',
    ingredientes: [
      {
        ingredienteItemId: ingredienteId,
        cantidad: '1',
        unidadCodigo: 'unidad',
      },
    ],
    ...extra,
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
    productoId = (
      await crear('items', {
        nombre: `Producto techo E2E ${marca}`,
        precioBase: '1490',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        clasificacionTributaria: 'exento',
        unidadMedida: 'unidad',
        stock: '1000',
        costo: '100',
      })
    ).id;
    ingredienteId = (
      await crear('items', {
        nombre: `Ingrediente techo E2E ${marca}`,
        precioBase: '0',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'unidad',
        stock: '10',
        costo: '100',
      })
    ).id;
    proveedorId = (
      await crear('terceros', {
        tipo: 'proveedor',
        nombre: `Proveedor techo E2E ${marca}`,
      })
    ).id;
    const [local]: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones
        WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID],
    );
    ubicacionId = local.ubicacion_id;

    const prefs = await request(app.getHttpServer())
      .get('/api/tenants/preferencias-financieras')
      .set('Authorization', `Bearer ${token}`);
    expect(prefs.status).toBe(200);
    preferencias = bodyPreferencias(prefs.body as object);
  }, 60000);

  afterAll(async () => {
    try {
      if (cuentaId) await pedir('post', `cuentas/${cuentaId}/cancelar`, {});
      if (garzon) {
        await pedir('post', 'sesiones-garzon/cerrar', {
          garzonId: garzon.id,
          pin: garzon.pin,
        });
      }
      // La caja se cuenta exacta para que cierre: la suite siguiente que abra
      // una con este usuario toparía con un 409.
      if (cajaId) {
        const arqueo = await request(app.getHttpServer())
          .get(`/api/caja/${cajaId}/arqueo`)
          .set('Authorization', `Bearer ${token}`);
        expect(arqueo.status).toBe(200);
        const lineas = (
          arqueo.body as {
            lineas: { metodoPagoId: string | null; esperado: string | null }[];
          }
        ).lineas;
        const conteo = await pedir('post', `caja/${cajaId}/conteo`, {
          lineas: lineas.map((l) => ({
            metodoPagoId: l.metodoPagoId,
            montoContado: l.esperado,
          })),
        });
        expect(conteo.status).toBe(201);
        expect((conteo.body as { estado: string }).estado).toBe('cerrada');
      }
      expect(
        (await pedir('put', 'tenants/preferencias-financieras', preferencias))
          .status,
      ).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('descuentos, recargos y promociones: el importe y el mínimo de cada tramo, al crear y al editar', async () => {
    const regla = (tipoReglaId: string, extra: object) => ({
      nombre: `Regla techo E2E ${randomUUID().slice(0, 8)}`,
      tipoReglaId,
      modo: 'monto_fijo',
      ...extra,
    });
    const promo = (extra: object) => ({
      nombre: `Promo techo E2E ${randomUUID().slice(0, 8)}`,
      tipo: 'precio_fijo',
      fechaInicio: '2026-01-01',
      fechaFin: '2026-12-31',
      valorMonto: '9990',
      scopes: [{ tipoScope: 'items', itemIds: [productoId], cantidad: 1 }],
      ...extra,
    });
    // El `PATCH` usa los `Update*Dto` de `PartialType`, que heredan el techo
    // copiando la metadata del `Create*Dto`: se prueba por HTTP, no se supone.
    const editables = {
      descuentos: (
        await crear(
          'descuentos',
          regla(TIPO_DESCUENTO_DIRECTO, { valorMonto: '500' }),
        )
      ).id,
      recargos: (
        await crear(
          'recargos',
          regla(TIPO_RECARGO_GENERAL, { valorMonto: '500' }),
        )
      ).id,
      promociones: (await crear('promociones', promo({}))).id,
    };
    // Sin `eliminado_el`: ver el encabezado.
    const reglas = () =>
      contar(
        `SELECT (SELECT count(*) FROM descuentos WHERE tenant_id = $1)
              + (SELECT count(*) FROM recargos WHERE tenant_id = $1)
              + (SELECT count(*) FROM promociones WHERE tenant_id = $1) AS n`,
        [PARIS_TENANT_ID],
      );
    const antes = await reglas();

    const pedidos: Pedido[] = [];
    for (const [ruta, directo, porMonto] of [
      ['descuentos', TIPO_DESCUENTO_DIRECTO, TIPO_DESCUENTO_POR_MONTO],
      ['recargos', TIPO_RECARGO_GENERAL, TIPO_RECARGO_POR_MONTO],
    ]) {
      pedidos.push(
        [
          `${ruta}: valorMonto`,
          () => pedir('post', ruta, regla(directo, { valorMonto: NO_CABE })),
        ],
        [
          `${ruta}: minimoMonto del tramo`,
          () =>
            pedir(
              'post',
              ruta,
              regla(porMonto, {
                tramos: [{ minimoMonto: NO_CABE, valorMonto: '500' }],
              }),
            ),
        ],
        [
          `${ruta}: valorMonto del tramo`,
          () =>
            pedir(
              'post',
              ruta,
              regla(porMonto, {
                tramos: [{ minimoMonto: '1000', valorMonto: NO_CABE }],
              }),
            ),
        ],
      );
    }
    pedidos.push([
      'promoción a precio fijo',
      () => pedir('post', 'promociones', promo({ valorMonto: NO_CABE })),
    ]);
    for (const [ruta, id] of Object.entries(editables)) {
      pedidos.push([
        `${ruta}: editar el valorMonto`,
        () => pedir('patch', `${ruta}/${id}`, { valorMonto: NO_CABE }),
      ]);
    }

    await rechazados(pedidos);
    expect(await reglas()).toBe(antes);
  });

  it('compras: el documento, el descuento, el precio de la línea y la aplicación de un pago', async () => {
    // Sin `eliminado_el`: ver el encabezado.
    const compras = () =>
      contar(`SELECT count(*) AS n FROM compras WHERE proveedor_id = $1`, [
        proveedorId,
      ]);
    const antes = await compras();
    await rechazados([
      [
        'borrador: totalDocumento',
        () => pedir('post', 'compras', compra({ totalDocumento: NO_CABE })),
      ],
      [
        'borrador: descuentoTotal',
        () => pedir('post', 'compras', compra({ descuentoTotal: NO_CABE })),
      ],
      [
        'borrador: precioUnitario de la línea',
        () =>
          pedir(
            'post',
            'compras',
            compra({
              lineas: [
                {
                  itemId: productoId,
                  cantidad: '1',
                  unidadCodigo: 'unidad',
                  precioUnitario: NO_CABE,
                },
              ],
            }),
          ),
      ],
    ]);
    expect(await compras()).toBe(antes);

    // Las correcciones son sobre una compra confirmada.
    const confirmada = await crear(
      'compras',
      compra({ totalDocumento: '200' }),
    );
    expect(
      (await pedir('post', `compras/${confirmada.id}/confirmar`, {})).status,
    ).toBe(201);
    const [linea]: { compra_linea_id: string }[] = await ds.query(
      `SELECT compra_linea_id FROM compra_lineas
        WHERE compra_id = $1 AND eliminado_el IS NULL`,
      [confirmada.id],
    );
    const leerCompra = async () => {
      const [fila]: unknown[] = await ds.query(
        `SELECT c.total_documento, c.descuento_total, l.precio_unitario
           FROM compras c JOIN compra_lineas l ON l.compra_id = c.compra_id
          WHERE c.compra_id = $1
            AND c.eliminado_el IS NULL AND l.eliminado_el IS NULL`,
        [confirmada.id],
      );
      return fila;
    };
    const original = await leerCompra();

    await rechazados([
      [
        'corregir el totalDocumento',
        () =>
          pedir('patch', `compras/${confirmada.id}/documento`, {
            totalDocumento: NO_CABE,
          }),
      ],
      [
        'corregir el descuentoTotal',
        () =>
          pedir('patch', `compras/${confirmada.id}/descuento`, {
            descuentoTotal: NO_CABE,
          }),
      ],
      [
        'corregir el precioUnitario de la línea',
        () =>
          pedir(
            'patch',
            `compras/${confirmada.id}/lineas/${linea.compra_linea_id}`,
            { precioUnitario: NO_CABE },
          ),
      ],
      [
        'aplicar un pago a la compra',
        () =>
          pedir('post', 'compras/pagos', {
            proveedorId,
            monto: '100',
            metodoPagoId: EFECTIVO_ID,
            aplicaciones: [{ compraId: confirmada.id, monto: NO_CABE }],
          }),
      ],
    ]);
    expect(await leerCompra()).toEqual(original);
  });

  it('ítems, costos y modificadores: precio, costo y precio extra', async () => {
    const grupo = await crear<{ grupoModificadorId: string }>(
      'grupos-modificadores',
      {
        nombre: `Grupo techo E2E ${marca}`,
        opciones: [{ itemId: productoId, cantidad: '1', precioExtra: '0' }],
      },
    );
    const [opcion]: { grupo_opcion_id: string }[] = await ds.query(
      `SELECT grupo_opcion_id FROM grupo_modificador_opciones
        WHERE grupo_modificador_id = $1 AND eliminado_el IS NULL`,
      [grupo.grupoModificadorId],
    );
    const conGrupo = await crear(
      'items',
      receta({
        gruposModificadores: [
          { grupoModificadorId: grupo.grupoModificadorId, min: 0, max: 1 },
        ],
      }),
    );
    const [itemGrupo]: { item_grupo_id: string }[] = await ds.query(
      `SELECT item_grupo_id FROM item_grupos_modificadores
        WHERE item_id = $1 AND eliminado_el IS NULL`,
      [conGrupo.id],
    );
    // Sin `eliminado_el`, los dos: ver el encabezado.
    const items = () =>
      contar(`SELECT count(*) AS n FROM items WHERE tenant_id = $1`, [
        PARIS_TENANT_ID,
      ]);
    const movimientos = () =>
      contar(
        `SELECT count(*) AS n FROM movimientos_inventario WHERE item_id = $1`,
        [productoId],
      );
    const antes = { items: await items(), movimientos: await movimientos() };

    await rechazados([
      [
        'crear un ítem: precioBase',
        () =>
          pedir('post', 'items', {
            nombre: `Ítem caro E2E ${marca}`,
            precioBase: NO_CABE,
            monedaId: CLP_MONEDA_ID,
            tipo: 'producto',
            clasificacionTributaria: 'exento',
            unidadMedida: 'unidad',
          }),
      ],
      [
        'crear un ítem: costo',
        () =>
          pedir('post', 'items', {
            nombre: `Ítem costoso E2E ${marca}`,
            precioBase: '100',
            monedaId: CLP_MONEDA_ID,
            tipo: 'producto',
            clasificacionTributaria: 'exento',
            unidadMedida: 'unidad',
            stock: '1',
            costo: NO_CABE,
          }),
      ],
      [
        'crear una receta: precioExtra de un extra',
        () =>
          pedir(
            'post',
            'items',
            receta({
              extrasPermitidos: [
                {
                  ingredienteItemId: ingredienteId,
                  cantidad: '1',
                  unidadCodigo: 'unidad',
                  precioExtra: NO_CABE,
                },
              ],
            }),
          ),
      ],
      [
        'crear una receta: precioExtra de la opción de un grupo',
        () =>
          pedir(
            'post',
            'items',
            receta({
              gruposModificadores: [
                {
                  grupoModificadorId: grupo.grupoModificadorId,
                  min: 0,
                  max: 1,
                  opciones: [
                    {
                      grupoOpcionId: opcion.grupo_opcion_id,
                      precioExtra: NO_CABE,
                    },
                  ],
                },
              ],
            }),
          ),
      ],
      [
        'editar un ítem: precioBase',
        () => pedir('patch', `items/${conGrupo.id}`, { precioBase: NO_CABE }),
      ],
      [
        'aplicar un desfase: precioBase',
        () =>
          pedir('post', 'desfases/aplicar', {
            items: [
              {
                itemId: conGrupo.id,
                actualizarPrecio: true,
                precioBase: NO_CABE,
              },
            ],
          }),
      ],
      [
        'ajustar el stock: costoUnitario',
        () =>
          pedir('patch', `items/${productoId}/stock`, {
            ubicacionId,
            cantidad: '1',
            tipo: 'entrada',
            motivo: 'compra',
            costoUnitario: NO_CABE,
          }),
      ],
      [
        'ajustar el costo: costoNuevo',
        () =>
          pedir('post', 'inventario/ajustes-costo', {
            itemId: productoId,
            costoNuevo: NO_CABE,
            comentario: 'Ajuste techo E2E',
          }),
      ],
      [
        'crear un grupo: precioExtra de una opción',
        () =>
          pedir('post', 'grupos-modificadores', {
            nombre: `Grupo caro E2E ${marca}`,
            opciones: [
              { itemId: productoId, cantidad: '1', precioExtra: NO_CABE },
            ],
          }),
      ],
      [
        'aplicar overrides de un grupo: precioExtra',
        () =>
          pedir(
            'patch',
            `grupos-modificadores/${grupo.grupoModificadorId}/overrides`,
            {
              itemGrupoIds: [itemGrupo.item_grupo_id],
              grupoOpcionId: opcion.grupo_opcion_id,
              precioExtra: NO_CABE,
            },
          ),
      ],
    ]);
    expect({ items: await items(), movimientos: await movimientos() }).toEqual(
      antes,
    );
  });

  it('propinas de la venta y del cierre de cuenta, y el conteo de la caja', async () => {
    cajaId = (
      await abrirCaja(app, token, {
        saldoInicial: '1000',
        comentario: 'Apertura techo E2E',
      })
    ).id;
    // Garzón PROPIO: la sesión es única por garzón y las suites comparten seed.
    garzon = await crear<{ id: string; pin: string }>('garzones', {
      nombre: `Garzón techo E2E ${marca}`,
    });
    const { id: garzonId, pin } = garzon;
    await crear('sesiones-garzon/iniciar', {
      garzonId,
      pin,
      turnoId: TURNO_MANANA_ID,
    });
    const salon = await crear('salones', {
      nombre: `Salón techo E2E ${marca}`,
    });
    const mesaId = (
      await crear(`salones/${salon.id}/mesas`, { nombre: 'Mesa techo' })
    ).id;
    cuentaId = (await crear(`mesas/${mesaId}/cuentas`, { garzonId, pin })).id;
    await crear(`cuentas/${cuentaId}/lineas`, {
      itemId: productoId,
      cantidad: '1',
    });
    const venta = (propina: object) =>
      pedir('post', 'ventas', {
        lineas: [{ itemId: productoId, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '1490' }],
        ...propina,
      });
    const cerrar = (propina: object) =>
      pedir('post', `cuentas/${cuentaId}/cerrar`, {
        garzonId,
        pin,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '1490' }],
        ...propina,
      });
    // Sin `eliminado_el`: ver el encabezado.
    const ventas = () =>
      contar(`SELECT count(*) AS n FROM ventas WHERE caja_id = $1`, [cajaId]);

    // La sugerencia se guarda aunque no se cobre propina: va con 0 cobrado.
    await rechazados([
      [
        'venta: propinaDirecta.montoPagado',
        () => venta({ propinaDirecta: { montoPagado: NO_CABE } }),
      ],
      [
        'venta: propinaDirecta.montoSugerido',
        () =>
          venta({
            propinaDirecta: { montoPagado: '0', montoSugerido: NO_CABE },
          }),
      ],
      [
        'venta: propinaCierreMesa.montoPagado',
        () => venta({ propinaCierreMesa: { montoPagado: NO_CABE, garzonId } }),
      ],
      [
        'venta: propinaCierreMesa.montoSugerido',
        () =>
          venta({
            propinaCierreMesa: {
              montoPagado: '0',
              montoSugerido: NO_CABE,
              garzonId,
            },
          }),
      ],
      [
        'cierre de cuenta: propinaMonto',
        () => cerrar({ propinaMonto: NO_CABE }),
      ],
      [
        'cierre de cuenta: propinaSugerida',
        () => cerrar({ propinaMonto: '0', propinaSugerida: NO_CABE }),
      ],
      [
        'conteo de la caja: montoContado',
        () =>
          pedir('post', `caja/${cajaId}/conteo`, {
            lineas: [{ metodoPagoId: null, montoContado: NO_CABE }],
          }),
      ],
    ]);
    expect(await ventas()).toBe(0);
    const [cuenta]: { estado: string }[] = await ds.query(
      `SELECT estado FROM cuentas WHERE cuenta_id = $1 AND eliminado_el IS NULL`,
      [cuentaId],
    );
    expect(cuenta.estado).toBe('abierta');

    // Control: la propina que cabe se cobra y se guarda.
    expect(
      (
        await venta({
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2490' }],
          propinaDirecta: { montoPagado: '1000' },
        })
      ).status,
    ).toBe(201);
  });

  it('el reparto de propinas: el monto a mano, en el preview, al liquidar y al editar', async () => {
    // La propina del control de arriba deja un participante real en el
    // reparto de hoy: sin él, el monto manual no llega a ninguna columna y
    // liquidar contesta otro 400 ("no tiene propinas fuente").
    //
    // "Hoy" es el día de negocio del tenant (Paris, Chile, corte 0), que es como
    // el backend lee `fechaDesde`/`fechaHasta`. La fecha UTC del proceso pedía
    // mañana entre las 21:00 y las 24:00 de Chile y la propina quedaba afuera
    // (rojo de main el 2026-10-13 a las 00:02 UTC).
    const hoy = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const rango = { fechaDesde: hoy, fechaHasta: hoy };
    const preview = await pedir(
      'post',
      'propinas/liquidaciones/preview',
      rango,
    );
    expect(preview.status).toBe(201);
    const participante = (
      preview.body as { participantes: { garzonId: string }[] }
    ).participantes[0];
    const ajustes = {
      ajustes: {
        montosManuales: [{ garzonId: participante.garzonId, monto: NO_CABE }],
      },
    };
    // Sin `eliminado_el`: ver el encabezado.
    const liquidaciones = () =>
      contar(
        `SELECT count(*) AS n FROM liquidacion_propinas WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      );
    const antes = await liquidaciones();

    // Un rango sin ventas con un participante a mano: queda en borrador.
    const borrador = await pedir('post', 'propinas/liquidaciones', {
      fechaDesde: '2001-01-01',
      fechaHasta: '2001-01-02',
    });
    expect(borrador.status).toBe(201);
    const detalle = borrador.body as { id: string; grupos: { id: string }[] };
    const garzonManual = await crear('garzones', {
      nombre: `Garzón reparto techo E2E ${marca}`,
    });
    const conManual = await pedir(
      'patch',
      `propinas/liquidaciones/${detalle.id}`,
      {
        participantes: [
          {
            garzonId: garzonManual.id,
            grupoId: detalle.grupos[0].id,
            motivoAjuste: 'Techo E2E',
          },
        ],
        recalcular: false,
      },
    );
    expect(conManual.status).toBe(200);
    const participanteId = (
      conManual.body as { participantes: { id: string; garzonId: string }[] }
    ).participantes.find((p) => p.garzonId === garzonManual.id)!.id;

    await rechazados([
      [
        'preview con monto manual',
        () =>
          pedir('post', 'propinas/liquidaciones/preview', {
            ...rango,
            ...ajustes,
          }),
      ],
      [
        'liquidar con monto manual',
        () =>
          pedir('post', 'propinas/liquidaciones/liquidar', {
            ...rango,
            ...ajustes,
          }),
      ],
      [
        'editar el monto de un participante',
        () =>
          pedir('patch', `propinas/liquidaciones/${detalle.id}`, {
            participantes: [
              {
                id: participanteId,
                monto: NO_CABE,
                ajusteMotivoMonto: 'Techo',
              },
            ],
            recalcular: false,
          }),
      ],
    ]);
    // Solo el borrador de arriba: ni el preview ni el liquidar escribieron.
    expect(await liquidaciones()).toBe(antes + 1);
  });

  it('preferencias financieras: los umbrales con el techo de la plata, la tolerancia con el de NUMERIC(18,6)', async () => {
    const poner = (cambios: object) =>
      pedir('put', 'tenants/preferencias-financieras', {
        ...preferencias,
        ...cambios,
      });

    // Un solo umbral fuera por pedido, y su nombre en el mensaje: con los dos
    // en 10^14, el techo de uno tapaba la falta del otro. El aviso va sobre un
    // alto en 0: sin su techo, el service lo rechazaría con OTRO mensaje (el
    // alto tiene que ser >= al aviso).
    await rechazados(
      [
        [
          'umbralDescuadreAlto',
          () =>
            poner({ umbralDescuadreAviso: '0', umbralDescuadreAlto: NO_CABE }),
        ],
      ],
      `umbralDescuadreAlto ${MENSAJE}`,
    );
    await rechazados(
      [
        [
          'umbralDescuadreAviso',
          () =>
            poner({ umbralDescuadreAviso: NO_CABE, umbralDescuadreAlto: '0' }),
        ],
      ],
      `umbralDescuadreAviso ${MENSAJE}`,
    );
    // 10^12 ya no cabe en la tolerancia, aunque cabría en una columna de plata.
    await rechazados(
      [['montoTolerancia', () => poner({ montoTolerancia: '1000000000000' })]],
      'montoTolerancia no puede ser de $1.000.000.000.000 o más',
    );

    // Controles: el máximo de cada columna entra.
    const res = await poner({
      montoTolerancia: '999999999999',
      umbralDescuadreAviso: '99999999999998',
      umbralDescuadreAlto: '99999999999999',
    });
    expect(res.status).toBe(200);
    const [tenant]: { tolerancia: string; alto: string }[] = await ds.query(
      `SELECT monto_tolerancia::text AS tolerancia,
              umbral_descuadre_alto::text AS alto
         FROM tenants WHERE tenant_id = $1 AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID],
    );
    expect(tenant).toEqual({
      tolerancia: '999999999999.000000',
      alto: '99999999999999.0000',
    });
  });
});
