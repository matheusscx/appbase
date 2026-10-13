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

/**
 * Una cantidad, un peso, un porcentaje o una tasa que no cabe en su columna es
 * 400 en el borde, no 500 en el `INSERT` (`IsDecimalPersistible`). Medido el
 * 2026-10-13 campo por campo —la tabla está en `docs/agent/resueltos.md`,
 * "Decimales por body sin techo"—: la tasa del día, el conteo de un recuento, el
 * porcentaje y el peso del reparto de propinas, el peso a mano de una
 * liquidación, el porcentaje sugerido de una propina y el `valorPorcentaje` de
 * una promoción `nxm` daban 500. Que el techo sea el de cada columna lo cuida
 * `monto-persistible-cobertura.spec.ts`.
 *
 * El último bloque fija lo que NO lleva techo porque ya lo frena el service con
 * un tope más bajo: si ese tope se fuera, el campo necesitaría el suyo.
 *
 * ⚠️ Sin `eliminado_el IS NULL` en los conteos de "no escribió nada", a
 * propósito: lo que se cuenta es si el pedido escribió algo, y una fila borrada
 * también sería una escritura.
 *
 * ⚠️ La tasa del dólar y el reparto de propinas de Paris se restauran en
 * `afterAll`; lo demás que queda es de sus propios ítem, garzones y recuento,
 * más una liquidación en borrador del 2002, un rango sin ventas.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const USD_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440005';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
const TIPO_DESCUENTO_DIRECTO = '550e8400-e29b-41d4-a716-446655440337';
const TIPO_DESCUENTO_POR_MONTO = '550e8400-e29b-41d4-a716-446655440119';
const TIPO_DESCUENTO_POR_MAYOR = '550e8400-e29b-41d4-a716-446655440101';
const TIPO_RECARGO_GENERAL = '550e8400-e29b-41d4-a716-446655440122';
const TIPO_RECARGO_POR_MONTO = '550e8400-e29b-41d4-a716-446655440353';
const MOTIVO_VENCIMIENTO_ID = '550e8400-e29b-41d4-a716-446655440266';

/** El primer valor que no cabe en `NUMERIC(18,4)`, `(18,6)`, `(10,6)` y `(7,4)`. */
const NO_CABE_18_4 = '100000000000000';
const NO_CABE_18_6 = '1000000000000';
const NO_CABE_10_6 = '10000';
const NO_CABE_7_4 = '1000';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
type Respuesta = { status: number; body: unknown };
type Pedido = [string, () => Promise<Respuesta>];

interface Distribucion {
  porcentajeSugerido: string;
  habilitadoPos: boolean;
  habilitadoSalones: boolean;
  grupos: {
    tipoGarzon: string;
    nombre: string;
    porcentaje: string;
    criterio: string;
    baseVentas: string;
    manualModo: string | null;
    activo: boolean;
    orden: number;
    pesos: { garzonId: string; peso: string }[];
  }[];
}

describe('Un decimal que no es plata y no cabe en su columna es 400, no 500 (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let marca: string;
  let productoId: string;
  let ubicacionId: string;
  let tasaOriginal: string;
  let distribucion: Distribucion;
  let cajaId: string | undefined;
  let cuentaId: string | undefined;
  let recuentoId: string | undefined;
  let garzon: { id: string; pin: string } | undefined;

  function pedir(
    metodo: 'post' | 'patch' | 'put' | 'get',
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

  function mensaje(res: Respuesta): string {
    const m = (res.body as { message?: string | string[] }).message ?? '';
    return [m].flat().join(' ');
  }

  /** Cada pedido, con su nombre en el error: un 500 dice cuál fue. */
  async function rechazados(pedidos: Pedido[], esperado: string) {
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

  const bodyDistribucion = (d: Distribucion) => ({
    porcentajeSugerido: d.porcentajeSugerido,
    habilitadoPos: d.habilitadoPos,
    habilitadoSalones: d.habilitadoSalones,
    grupos: d.grupos.map((g) => ({
      tipoGarzon: g.tipoGarzon,
      nombre: g.nombre,
      porcentaje: g.porcentaje,
      criterio: g.criterio,
      baseVentas: g.baseVentas,
      manualModo: g.manualModo,
      activo: g.activo,
      orden: g.orden,
      pesos: g.pesos,
    })),
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
        nombre: `Producto decimal E2E ${marca}`,
        precioBase: '1490',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        clasificacionTributaria: 'exento',
        unidadMedida: 'unidad',
        stock: '1000',
        costo: '100',
      })
    ).id;
    const [local]: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones
        WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID],
    );
    ubicacionId = local.ubicacion_id;

    const [tasa]: { valor: string }[] = await ds.query(
      `SELECT valor_del_dia::text AS valor FROM tenant_moneda
        WHERE tenant_id = $1 AND moneda_id = $2 AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID, USD_MONEDA_ID],
    );
    tasaOriginal = tasa.valor;
    const dist = await pedir('get', 'propinas/distribucion');
    expect(dist.status).toBe(200);
    distribucion = dist.body as Distribucion;
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
      if (recuentoId) await pedir('post', `recuentos/${recuentoId}/cancelar`);
      // La caja se cuenta exacta para que cierre: la suite siguiente que abra
      // una con este usuario toparía con un 409.
      if (cajaId) {
        const arqueo = await pedir('get', `caja/${cajaId}/arqueo`);
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
        (
          await pedir('patch', `monedas/${USD_MONEDA_ID}`, {
            valorDelDia: tasaOriginal,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await pedir(
            'put',
            'propinas/distribucion',
            bodyDistribucion(distribucion),
          )
        ).status,
      ).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('la tasa del día: NUMERIC(18,6), techo en 10^12', async () => {
    await rechazados(
      [
        [
          'valorDelDia',
          () =>
            pedir('patch', `monedas/${USD_MONEDA_ID}`, {
              valorDelDia: NO_CABE_18_6,
            }),
        ],
      ],
      'valorDelDia no puede ser de 1.000.000.000.000 o más',
    );
    const leer = async () => {
      const [fila]: { valor: string }[] = await ds.query(
        `SELECT valor_del_dia::text AS valor FROM tenant_moneda
          WHERE tenant_id = $1 AND moneda_id = $2 AND eliminado_el IS NULL`,
        [PARIS_TENANT_ID, USD_MONEDA_ID],
      );
      return fila.valor;
    };
    expect(await leer()).toBe(tasaOriginal);

    // Control: el máximo de la columna entra.
    const res = await pedir('patch', `monedas/${USD_MONEDA_ID}`, {
      valorDelDia: '999999999999.999999',
    });
    expect(res.status).toBe(200);
    expect(await leer()).toBe('999999999999.999999');
  });

  it('el conteo de un recuento: NUMERIC(18,4), techo en 10^14', async () => {
    recuentoId = (
      await crear('recuentos', { ubicacionId, itemIds: [productoId] })
    ).id;
    const [linea]: { id: string }[] = await ds.query(
      `SELECT linea_id AS id FROM recuento_inventario_linea
        WHERE recuento_id = $1 AND eliminado_el IS NULL`,
      [recuentoId],
    );
    const cargarConteo = (cantidadContada: string) =>
      pedir('patch', `recuentos/${recuentoId}/lineas/${linea.id}`, {
        cantidadContada,
      });
    const leer = async () => {
      const [fila]: { contada: string | null }[] = await ds.query(
        `SELECT cantidad_contada::text AS contada FROM recuento_inventario_linea
          WHERE linea_id = $1 AND eliminado_el IS NULL`,
        [linea.id],
      );
      return fila.contada;
    };

    await rechazados(
      [['cantidadContada', () => cargarConteo(NO_CABE_18_4)]],
      'cantidadContada no puede ser de 100.000.000.000.000 o más',
    );
    expect(await leer()).toBeNull();

    expect((await cargarConteo('99999999999999.9999')).status).toBe(200);
    expect(await leer()).toBe('99999999999999.9999');
  });

  it('el reparto de propinas: el porcentaje y el peso de un grupo, y el peso a mano de una liquidación', async () => {
    const base = bodyDistribucion(distribucion);
    const version = async () => {
      const [fila]: { version: number }[] = await ds.query(
        `SELECT version FROM propina_configuracion
          WHERE tenant_id = $1 AND eliminado_el IS NULL`,
        [PARIS_TENANT_ID],
      );
      return fila.version;
    };
    const antes = await version();
    const garzonPeso = await crear('garzones', {
      nombre: `Garzón peso E2E ${marca}`,
    });

    // Un grupo apagado no entra en la suma del 100%: era el camino por el que
    // el porcentaje llegaba entero a la columna.
    await rechazados(
      [
        [
          'porcentaje de un grupo apagado',
          () =>
            pedir('put', 'propinas/distribucion', {
              ...base,
              grupos: [
                ...base.grupos,
                {
                  ...base.grupos[0],
                  nombre: `Apagado E2E ${marca}`,
                  porcentaje: NO_CABE_10_6,
                  activo: false,
                  orden: 99,
                },
              ],
            }),
        ],
      ],
      'porcentaje no puede ser de 10.000 o más',
    );
    await rechazados(
      [
        [
          'peso a mano de un grupo',
          () =>
            pedir('put', 'propinas/distribucion', {
              ...base,
              grupos: base.grupos.map((g, i) =>
                i === 0
                  ? {
                      ...g,
                      criterio: 'MANUAL',
                      manualModo: 'PESOS',
                      pesos: [{ garzonId: garzonPeso.id, peso: NO_CABE_18_4 }],
                    }
                  : g,
              ),
            }),
        ],
      ],
      'peso no puede ser de 100.000.000.000.000 o más',
    );
    expect(await version()).toBe(antes);

    // La liquidación en borrador de un rango sin ventas, con un participante
    // a mano.
    const borrador = await crear<{ id: string; grupos: { id: string }[] }>(
      'propinas/liquidaciones',
      { fechaDesde: '2002-01-01', fechaHasta: '2002-01-02' },
    );
    const conManual = await pedir(
      'patch',
      `propinas/liquidaciones/${borrador.id}`,
      {
        participantes: [
          {
            garzonId: garzonPeso.id,
            grupoId: borrador.grupos[0].id,
            motivoAjuste: 'Peso E2E',
          },
        ],
        recalcular: false,
      },
    );
    expect(conManual.status).toBe(200);
    const participanteId = (
      conManual.body as { participantes: { id: string; garzonId: string }[] }
    ).participantes.find((p) => p.garzonId === garzonPeso.id)!.id;

    await rechazados(
      [
        [
          'pesoManual de un participante',
          () =>
            pedir('patch', `propinas/liquidaciones/${borrador.id}`, {
              participantes: [{ id: participanteId, pesoManual: NO_CABE_18_4 }],
              recalcular: false,
            }),
        ],
      ],
      'pesoManual no puede ser de 100.000.000.000.000 o más',
    );
    const [participante]: { peso: string | null }[] = await ds.query(
      `SELECT peso_manual::text AS peso FROM liquidacion_propinas_participante
        WHERE liquidacion_propinas_participante_id = $1 AND eliminado_el IS NULL`,
      [participanteId],
    );
    expect(participante.peso).toBeNull();
  });

  it('el porcentaje sugerido de una propina: venta y cierre de cuenta, NUMERIC(10,6)', async () => {
    cajaId = (
      await abrirCaja(app, token, {
        saldoInicial: '1000',
        comentario: 'Apertura decimal E2E',
      })
    ).id;
    // Garzón PROPIO: la sesión es única por garzón y las suites comparten seed.
    garzon = await crear<{ id: string; pin: string }>('garzones', {
      nombre: `Garzón decimal E2E ${marca}`,
    });
    const { id: garzonId, pin } = garzon;
    await crear('sesiones-garzon/iniciar', {
      garzonId,
      pin,
      turnoId: TURNO_MANANA_ID,
    });
    const salon = await crear('salones', {
      nombre: `Salón decimal E2E ${marca}`,
    });
    const mesaId = (
      await crear(`salones/${salon.id}/mesas`, { nombre: 'Mesa decimal' })
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
    // Sin `eliminado_el`: ver el encabezado.
    const ventas = () =>
      contar(`SELECT count(*) AS n FROM ventas WHERE caja_id = $1`, [cajaId]);

    await rechazados(
      [
        [
          'venta: propinaDirecta.porcentajeSugerido',
          () =>
            venta({
              propinaDirecta: {
                montoPagado: '0',
                porcentajeSugerido: NO_CABE_10_6,
              },
            }),
        ],
        [
          'venta: propinaCierreMesa.porcentajeSugerido',
          () =>
            venta({
              propinaCierreMesa: {
                montoPagado: '0',
                porcentajeSugerido: NO_CABE_10_6,
                garzonId,
              },
            }),
        ],
      ],
      'porcentajeSugerido no puede ser de 10.000 o más',
    );
    await rechazados(
      [
        [
          'cierre de cuenta: propinaPorcentajeSugerido',
          () =>
            pedir('post', `cuentas/${cuentaId}/cerrar`, {
              garzonId,
              pin,
              pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '1490' }],
              propinaMonto: '0',
              propinaPorcentajeSugerido: NO_CABE_10_6,
            }),
        ],
      ],
      'propinaPorcentajeSugerido no puede ser de 10.000 o más',
    );
    expect(await ventas()).toBe(0);
    const [cuenta]: { estado: string }[] = await ds.query(
      `SELECT estado FROM cuentas WHERE cuenta_id = $1 AND eliminado_el IS NULL`,
      [cuentaId],
    );
    expect(cuenta.estado).toBe('abierta');

    // Control: el máximo de la columna se guarda.
    const res = await venta({
      propinaDirecta: { montoPagado: '0', porcentajeSugerido: '9999.999999' },
    });
    expect(res.status).toBe(201);
    const [propina]: { pct: string }[] = await ds.query(
      `SELECT porcentaje_sugerido::text AS pct FROM venta_propina
        WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [(res.body as IdResponse).id],
    );
    expect(propina.pct).toBe('9999.999999');
  });

  it('el valorPorcentaje de una promoción nxm, al crear y al editar: NUMERIC(7,4)', async () => {
    // Vencida: no le cambia el precio a nadie mientras corre el resto.
    const nxm = (extra: object) => ({
      nombre: `Promo nxm E2E ${randomUUID().slice(0, 8)}`,
      tipo: 'nxm',
      cadaN: 2,
      pagaM: 1,
      fechaInicio: '2020-01-01',
      fechaFin: '2020-12-31',
      scopes: [{ tipoScope: 'items', itemIds: [productoId] }],
      ...extra,
    });
    const editable = await crear('promociones', nxm({ valorPorcentaje: '1' }));
    // Sin `eliminado_el`: ver el encabezado.
    const promociones = () =>
      contar(`SELECT count(*) AS n FROM promociones WHERE tenant_id = $1`, [
        PARIS_TENANT_ID,
      ]);
    const antes = await promociones();

    await rechazados(
      [
        [
          'crear',
          () =>
            pedir('post', 'promociones', nxm({ valorPorcentaje: NO_CABE_7_4 })),
        ],
        [
          'editar',
          () =>
            pedir('patch', `promociones/${editable.id}`, {
              valorPorcentaje: NO_CABE_7_4,
            }),
        ],
      ],
      'valorPorcentaje no puede ser de 1.000 o más',
    );
    expect(await promociones()).toBe(antes);
    const [promo]: { pct: string }[] = await ds.query(
      `SELECT valor_porcentaje::text AS pct FROM promociones
        WHERE promocion_id = $1 AND eliminado_el IS NULL`,
      [editable.id],
    );
    expect(promo.pct).toBe('1.0000');
  });

  it('el minimoCantidad de un tramo por_mayor, al crear y al editar: NUMERIC(18,4)', async () => {
    // Inactiva y vencida: no le cambia el precio a nadie mientras corre el resto.
    const porMayor = (minimoCantidad: string) => ({
      nombre: `Por mayor E2E ${randomUUID().slice(0, 8)}`,
      tipoReglaId: TIPO_DESCUENTO_POR_MAYOR,
      modo: 'porcentaje',
      activo: false,
      fechaInicio: '2020-01-01',
      fechaFin: '2020-12-31',
      tramos: [{ minimoCantidad, valorPorcentaje: '0.1' }],
    });
    const editable = await crear('descuentos', porMayor('10'));
    // Sin `eliminado_el`: ver el encabezado.
    const tramos = () =>
      contar(
        `SELECT count(*) AS n FROM descuento_tramos t
           JOIN descuentos d ON d.descuento_id = t.descuento_id
          WHERE d.tenant_id = $1`,
        [PARIS_TENANT_ID],
      );
    const minimos = async (descuentoId: string) => {
      const filas: { minimo: string }[] = await ds.query(
        `SELECT minimo_cantidad::text AS minimo FROM descuento_tramos
          WHERE descuento_id = $1 AND eliminado_el IS NULL`,
        [descuentoId],
      );
      return filas.map((f) => f.minimo);
    };
    const antes = await tramos();

    // `99999999999999.99995` cabe en el campo, que no tiene techo, y Postgres
    // la redondea a 10^14 al guardar.
    const pedidos: Pedido[] = [];
    for (const valor of [NO_CABE_18_4, '99999999999999.99995']) {
      pedidos.push(
        [
          `crear con ${valor}`,
          () => pedir('post', 'descuentos', porMayor(valor)),
        ],
        [
          `editar con ${valor}`,
          () =>
            pedir('patch', `descuentos/${editable.id}`, {
              tramos: [{ minimoCantidad: valor, valorPorcentaje: '0.1' }],
            }),
        ],
      );
    }
    await rechazados(
      pedidos,
      'minimoCantidad no puede ser de 100.000.000.000.000 o más',
    );
    expect(await tramos()).toBe(antes);
    expect(await minimos(editable.id)).toEqual(['10.0000']);

    const maximo = '99999999999999.9999';
    const creado = await crear('descuentos', porMayor(maximo));
    expect(await minimos(creado.id)).toEqual([maximo]);
    const editado = await pedir('patch', `descuentos/${editable.id}`, {
      tramos: [{ minimoCantidad: maximo, valorPorcentaje: '0.1' }],
    });
    expect(editado.status).toBe(200);
    expect(await minimos(editable.id)).toEqual([maximo]);
  });

  it('lo que no lleva techo porque el service ya lo frena antes, con un tope más bajo', async () => {
    const regla = (tipoReglaId: string, extra: object) => ({
      nombre: `Regla decimal E2E ${randomUUID().slice(0, 8)}`,
      tipoReglaId,
      modo: 'porcentaje',
      ...extra,
    });
    const pedidos: [string, () => Promise<Respuesta>, string][] = [];
    for (const [ruta, directo, porMonto] of [
      ['descuentos', TIPO_DESCUENTO_DIRECTO, TIPO_DESCUENTO_POR_MONTO],
      ['recargos', TIPO_RECARGO_GENERAL, TIPO_RECARGO_POR_MONTO],
    ]) {
      pedidos.push(
        [
          `${ruta}: valorPorcentaje`,
          () =>
            pedir(
              'post',
              ruta,
              regla(directo, { valorPorcentaje: NO_CABE_7_4 }),
            ),
          'ser menor a 1',
        ],
        [
          `${ruta}: valorPorcentaje del tramo`,
          () =>
            pedir(
              'post',
              ruta,
              regla(porMonto, {
                tramos: [{ minimoMonto: '1000', valorPorcentaje: NO_CABE_7_4 }],
              }),
            ),
          'ser menor a 1',
        ],
      );
    }
    // Un recargo no tiene tipo que mida cantidad: con o sin tramos, el service
    // rechaza el campo entero, al crear y al editar. El recargo editable va
    // inactivo y vencido: no le cambia el precio a nadie.
    const recargo = await crear(
      'recargos',
      regla(TIPO_RECARGO_GENERAL, {
        valorPorcentaje: '0.1',
        activo: false,
        fechaInicio: '2020-01-01',
        fechaFin: '2020-12-31',
      }),
    );
    const tramoQueNoCabe = {
      tramos: [{ minimoCantidad: NO_CABE_18_4, valorPorcentaje: '0.1' }],
    };
    pedidos.push(
      [
        'recargos: minimoCantidad de un tramo por monto',
        () =>
          pedir(
            'post',
            'recargos',
            regla(TIPO_RECARGO_POR_MONTO, tramoQueNoCabe),
          ),
        'mide monto de venta',
      ],
      [
        'recargos: minimoCantidad en un tipo sin tramos',
        () =>
          pedir(
            'post',
            'recargos',
            regla(TIPO_RECARGO_GENERAL, {
              valorPorcentaje: '0.1',
              ...tramoQueNoCabe,
            }),
          ),
        'no admite escalones',
      ],
      [
        'recargos: minimoCantidad al editar',
        () => pedir('patch', `recargos/${recargo.id}`, tramoQueNoCabe),
        'no admite escalones',
      ],
    );
    pedidos.push(
      [
        'el porcentaje sugerido del reparto',
        () =>
          pedir('put', 'propinas/distribucion', {
            ...bodyDistribucion(distribucion),
            porcentajeSugerido: NO_CABE_10_6,
          }),
        'no porcentaje entero',
      ],
      // El stock de un producto cabe en su columna, y una merma no puede
      // sacar más que el stock.
      [
        'la cantidad de una merma',
        () =>
          pedir('post', 'mermas', {
            itemId: productoId,
            ubicacionId,
            motivoBajaId: MOTIVO_VENCIMIENTO_ID,
            cantidad: NO_CABE_18_4,
          }),
        'Stock insuficiente',
      ],
    );
    for (const [que, hacer, esperado] of pedidos) {
      await rechazados([[que, hacer]], esperado);
    }
  });
});
