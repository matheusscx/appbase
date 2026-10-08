import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { MAX_UNIDADES_POR_PLATO } from '../src/common/utils/tope-unidades-venta.util';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

/**
 * La forma de lo que entra al motor por el body (2026-10-08).
 *
 * - **`personalizacion` es un objeto.** `@ValidateNested()` deja pasar un
 *   array, y medido por HTTP las tres puertas lo aceptaban con 201: la venta y
 *   la línea de cuenta guardaban `omitidos: []` y **descontaban el ingrediente
 *   omitido**, y `/calcular` previsualizaba sin los extras.
 * - **Un id en mayúsculas es el mismo id.** `@IsUUID` lo acepta y la base
 *   devuelve minúsculas, así que comparado en TypeScript no se encontraba:
 *   `metodoPagoId` cobraba **sin** el recargo por método de pago, los ids de
 *   reglas de venta daban 400 "no encontrado", y los de la personalización 400
 *   "no pertenece". Van a minúsculas en el borde (`IdEnMinusculas`), antes de
 *   que `@ArrayUnique` compare: `[D, D.toUpperCase()]` es un repetido.
 * - **Lo mismo con el método de cada pago** (`pagos[].metodoPagoId`), aunque no
 *   entra al motor: `PagosService.registrar` lo buscaba con el casing del
 *   cliente en el mapa de métodos del tenant, y en mayúsculas las tres puertas
 *   (venta, cierre de cuenta y abono) daban 400 "Método de pago no habilitado".
 * - **Un elemento de un array de la personalización es un objeto.** Con un
 *   `[]` adentro (`extras: [[]]`), `@ValidateNested({ each: true })` no tiene
 *   nada que validar y lo deja pasar: el service lo rechazaba con un 400 que
 *   mentía ("La opción undefined no pertenece…", "Extra no permitido").
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const TARJETA_CREDITO_ID = '550e8400-e29b-41d4-a716-446655440107';
const TIPO_RECARGO_METODO_PAGO = '550e8400-e29b-41d4-a716-446655440124';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
/** "Promo del total $5.000", nivel venta. */
const DESCUENTO_VENTA_ID = '550e8400-e29b-41d4-a716-446655440360';
/** "Recargo por pedido chico", nivel venta. */
const RECARGO_VENTA_ID = '550e8400-e29b-41d4-a716-446655440354';
/** "Combo Especial": su componente "Hamburguesa Especial" tiene el grupo "Proteína". */
const COMBO_ESPECIAL_ID = '550e8400-e29b-41d4-a716-446655440313';
const HAMBURGUESA_ESPECIAL_ID = '550e8400-e29b-41d4-a716-446655440294';
const PROTEINA_GRUPO_ID = '550e8400-e29b-41d4-a716-446655440290';
const CHULETA_ID = '550e8400-e29b-41d4-a716-446655440288';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface Calculo {
  totales: { totalRecargos: string; totalFinal: string };
}

describe('Lo que entra al motor por el body (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let caja: CajaAbierta | undefined;
  let garzon: { id: string; pin: string };
  let mesaId: string;
  /** Ingrediente no bloqueante de la receta: el que se omite. */
  let omitibleId: string;
  /** Ingrediente que la receta permite como extra, a $500. */
  let extraId: string;
  let recetaId: string;
  /** Sin stock: las ventas del spec no dependen de lo que otras suites vendieron. */
  let servicioId: string;
  /** Servicio de $1.000 con un recargo del 3% con tarjeta de crédito. */
  let itemTarjetaId: string;
  const cuentasAbiertas: string[] = [];

  function enviar(ruta: string, body: object) {
    return request(app.getHttpServer())
      .post(`/api/${ruta}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  }

  function mensajes(res: { body: unknown }): string[] {
    return [(res.body as { message?: string | string[] }).message ?? []].flat();
  }

  async function crear<T = IdResponse>(ruta: string, body: object): Promise<T> {
    const res = await enviar(ruta, body);
    expect(res.status).toBe(201);
    return res.body as T;
  }

  async function abrirCuenta(): Promise<string> {
    const { id } = await crear(`mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
    cuentasAbiertas.push(id);
    return id;
  }

  async function contar(sql: string, params: unknown[]): Promise<number> {
    const filas: { n: string }[] = await ds.query(sql, params);
    return Number(filas[0].n);
  }

  // Sin `eliminado_el IS NULL` a propósito, en los tres conteos: lo que se
  // cuenta es si el pedido escribió algo, y una fila borrada también sería una
  // escritura.
  const ventasDelTenant = () =>
    contar(`SELECT count(*) AS n FROM ventas WHERE tenant_id = $1`, [
      PARIS_TENANT_ID,
    ]);
  const movimientosDe = (itemId: string) =>
    contar(
      `SELECT count(*) AS n FROM movimientos_inventario WHERE item_id = $1`,
      [itemId],
    );
  const lineasDeCuenta = (cuentaId: string) =>
    contar(`SELECT count(*) AS n FROM cuenta_lineas WHERE cuenta_id = $1`, [
      cuentaId,
    ]);

  const pagoEfectivo = [{ metodoPagoId: EFECTIVO_ID, monto: '1000000.0000' }];

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

    const marca = randomUUID().slice(0, 8);
    const ingrediente = async (nombre: string) =>
      (
        await crear('items', {
          nombre: `${nombre} motor E2E ${marca}`,
          precioBase: '100',
          monedaId: CLP_MONEDA_ID,
          tipo: 'ingrediente',
          unidadMedida: 'unidad',
          stock: '1000',
          costo: '100',
        })
      ).id;
    omitibleId = await ingrediente('Cebolla');
    extraId = await ingrediente('Queso');
    recetaId = (
      await crear('items', {
        nombre: `Receta motor E2E ${marca}`,
        precioBase: '4000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: omitibleId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: false,
          },
        ],
        extrasPermitidos: [
          {
            ingredienteItemId: extraId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            precioExtra: '500',
          },
        ],
      })
    ).id;
    servicioId = (
      await crear('items', {
        nombre: `Servicio motor E2E ${marca}`,
        precioBase: '1000',
        precioIncluyeImpuesto: true,
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
      })
    ).id;
    const recargoTarjeta = await crear('recargos', {
      nombre: `Tarjeta motor E2E ${marca}`,
      tipoReglaId: TIPO_RECARGO_METODO_PAGO,
      modo: 'porcentaje',
      valorPorcentaje: '0.03',
      metodoPagoIds: [TARJETA_CREDITO_ID],
    });
    itemTarjetaId = (
      await crear('items', {
        nombre: `Servicio con tarjeta motor E2E ${marca}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
        recargosIds: [recargoTarjeta.id],
      })
    ).id;

    // Garzón PROPIO, no el del seed: la sesión es única por garzón y varias
    // suites comparten el sembrado (`maxWorkers: 1`).
    garzon = await crear<{ id: string; pin: string }>('garzones', {
      nombre: `Garzón motor E2E ${marca}`,
    });
    await crear('sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });
    const salon = await crear('salones', {
      nombre: `Salón motor E2E ${marca}`,
    });
    mesaId = (
      await crear(`salones/${salon.id}/mesas`, { nombre: 'Mesa motor' })
    ).id;
    caja = await abrirCaja(app, token, { comentario: 'Apertura E2E motor' });
  }, 60000);

  afterAll(async () => {
    try {
      for (const cuentaId of cuentasAbiertas) {
        await enviar(`cuentas/${cuentaId}/cancelar`, {});
      }
      await enviar('sesiones-garzon/cerrar', {
        garzonId: garzon.id,
        pin: garzon.pin,
      });
      if (caja) await cerrarCaja(app, token, caja);
    } finally {
      await app.close();
    }
  });

  describe('@IsObject: personalizacion como array es 400 y no escribe nada', () => {
    const ARRAYS = (): { nombre: string; valor: unknown[] }[] => [
      { nombre: 'con la omisión adentro', valor: [{ omitidos: [omitibleId] }] },
      { nombre: 'vacío', valor: [] },
    ];

    it('POST /ventas: 400, sin venta y sin descontar el ingrediente omitido', async () => {
      for (const { nombre, valor } of ARRAYS()) {
        const ventas = await ventasDelTenant();
        const movimientos = await movimientosDe(omitibleId);
        const res = await enviar('ventas', {
          lineas: [{ itemId: recetaId, cantidad: '1', personalizacion: valor }],
          pagos: pagoEfectivo,
        });
        expect({ nombre, status: res.status }).toEqual({ nombre, status: 400 });
        expect(mensajes(res)).toContain(
          'lineas.0.personalizacion must be an object',
        );
        expect(await ventasDelTenant()).toBe(ventas);
        expect(await movimientosDe(omitibleId)).toBe(movimientos);
      }

      // Control: el mismo pedido como objeto se vende y respeta la omisión.
      const movimientos = await movimientosDe(omitibleId);
      const ok = await enviar('ventas', {
        lineas: [
          {
            itemId: recetaId,
            cantidad: '1',
            personalizacion: { omitidos: [omitibleId] },
          },
        ],
        pagos: pagoEfectivo,
      });
      expect(ok.status).toBe(201);
      expect(await movimientosDe(omitibleId)).toBe(movimientos);

      // Y el conteo sí ve una venta que mueve el ingrediente: sin omitirlo, +1.
      const sinOmitir = await enviar('ventas', {
        lineas: [{ itemId: recetaId, cantidad: '1', personalizacion: {} }],
        pagos: pagoEfectivo,
      });
      expect(sinOmitir.status).toBe(201);
      expect(await movimientosDe(omitibleId)).toBe(movimientos + 1);
    });

    it('POST /cuentas/:id/lineas: 400, sin línea en la cuenta', async () => {
      const cuentaId = await abrirCuenta();
      for (const { nombre, valor } of ARRAYS()) {
        const res = await enviar(`cuentas/${cuentaId}/lineas`, {
          itemId: recetaId,
          cantidad: '1',
          personalizacion: valor,
        });
        expect({ nombre, status: res.status }).toEqual({ nombre, status: 400 });
        expect(mensajes(res)).toContain('personalizacion must be an object');
        expect(await lineasDeCuenta(cuentaId)).toBe(0);
      }

      const ok = await enviar(`cuentas/${cuentaId}/lineas`, {
        itemId: recetaId,
        cantidad: '1',
        personalizacion: { omitidos: [omitibleId] },
      });
      expect(ok.status).toBe(201);
      expect(await lineasDeCuenta(cuentaId)).toBe(1);
    });

    it('POST /calculo-precios/calcular: 400 en vez de previsualizar sin los extras', async () => {
      const linea = (personalizacion: unknown) => ({
        lineas: [{ itemId: recetaId, cantidad: '1', personalizacion }],
      });
      const res = await enviar(
        'calculo-precios/calcular',
        linea([{ extras: [{ ingredienteItemId: extraId }] }]),
      );
      expect(res.status).toBe(400);
      expect(mensajes(res)).toContain(
        'lineas.0.personalizacion must be an object',
      );

      const ok = await enviar(
        'calculo-precios/calcular',
        linea({ extras: [{ ingredienteItemId: extraId }] }),
      );
      expect(ok.status).toBe(201);
    });
  });

  describe('metodoPagoId en mayúsculas cobra el recargo por método de pago', () => {
    it('POST /calculo-precios/calcular: el mismo 3% que en minúsculas', async () => {
      const calcular = (metodoPagoId: string) =>
        enviar('calculo-precios/calcular', {
          lineas: [{ itemId: itemTarjetaId, cantidad: '1' }],
          metodoPagoId,
        });
      const minusculas = await calcular(TARJETA_CREDITO_ID);
      expect(minusculas.status).toBe(201);
      expect((minusculas.body as Calculo).totales.totalRecargos).toBe(
        '30.000000',
      );

      const mayusculas = await calcular(TARJETA_CREDITO_ID.toUpperCase());
      expect(mayusculas.status).toBe(201);
      expect((mayusculas.body as Calculo).totales).toEqual(
        (minusculas.body as Calculo).totales,
      );
    });

    it('POST /ventas: guarda el recargo de $30 y el total de $1.226', async () => {
      // $1.000 + 3% = $1.030, + 19% IVA = $1.226. Sin el recargo el total era
      // $1.190 y este pago exacto daba 400 "El pago supera el total".
      const res = await enviar('ventas', {
        lineas: [{ itemId: itemTarjetaId, cantidad: '1' }],
        metodoPagoId: TARJETA_CREDITO_ID.toUpperCase(),
        pagos: [{ metodoPagoId: TARJETA_CREDITO_ID, monto: '1226.0000' }],
      });
      expect(res.status).toBe(201);
      const [venta]: { total_recargos: string; total_final: string }[] =
        await ds.query(
          `SELECT total_recargos::text, total_final::text FROM ventas
            WHERE venta_id = $1 AND eliminado_el IS NULL`,
          [(res.body as IdResponse).id],
        );
      expect(venta).toEqual({
        total_recargos: '30.0000',
        total_final: '1226.0000',
      });
    });
  });

  describe('ids de reglas de venta: el mismo id en dos casings es un repetido', () => {
    // 200 unidades de $1.000: el descuento fijo de $5.000 no deja el total en 0.
    const FILAS = [
      { campo: 'descuentosVentaIds', ruta: 'ventas', id: DESCUENTO_VENTA_ID },
      { campo: 'recargosVentaIds', ruta: 'ventas', id: RECARGO_VENTA_ID },
      {
        campo: 'descuentosVentaIds',
        ruta: 'calculo-precios/calcular',
        id: DESCUENTO_VENTA_ID,
      },
      {
        campo: 'recargosVentaIds',
        ruta: 'calculo-precios/calcular',
        id: RECARGO_VENTA_ID,
      },
    ];

    const cuerpo = (ruta: string, campo: string, ids: string[]) => ({
      lineas: [{ itemId: servicioId, cantidad: '200' }],
      ...(ruta === 'ventas' ? { pagos: pagoEfectivo } : {}),
      [campo]: ids,
    });

    it.each(FILAS)(
      'POST /$ruta $campo: [id, ID] es 400 por repetido; ID solo, 201',
      async ({ campo, ruta, id }) => {
        const par = await enviar(
          ruta,
          cuerpo(ruta, campo, [id, id.toUpperCase()]),
        );
        expect(par.status).toBe(400);
        expect(mensajes(par)).toContain(
          `All ${campo}'s elements must be unique`,
        );

        const mayusculas = await enviar(
          ruta,
          cuerpo(ruta, campo, [id.toUpperCase()]),
        );
        expect(mensajes(mayusculas)).toEqual([]);
        expect(mayusculas.status).toBe(201);
      },
    );

    it('POST /calculo-precios/calcular: el descuento en mayúsculas cobra lo mismo que en minúsculas', async () => {
      const ruta = 'calculo-precios/calcular';
      const campo = 'descuentosVentaIds';
      const minusculas = await enviar(
        ruta,
        cuerpo(ruta, campo, [DESCUENTO_VENTA_ID]),
      );
      const mayusculas = await enviar(
        ruta,
        cuerpo(ruta, campo, [DESCUENTO_VENTA_ID.toUpperCase()]),
      );
      expect(minusculas.status).toBe(201);
      expect(mayusculas.status).toBe(201);
      expect((mayusculas.body as Calculo).totales).toEqual(
        (minusculas.body as Calculo).totales,
      );
    });
  });

  describe('ids de la personalización en mayúsculas', () => {
    const FILAS = (): {
      campo: string;
      itemId: string;
      personalizacion: (mayus: (id: string) => string) => object;
    }[] => [
      {
        campo: 'extras[].ingredienteItemId',
        itemId: recetaId,
        personalizacion: (m) => ({
          extras: [{ ingredienteItemId: m(extraId) }],
        }),
      },
      {
        campo: 'grupos[].grupoId',
        itemId: HAMBURGUESA_ESPECIAL_ID,
        personalizacion: (m) => ({
          grupos: [
            {
              grupoId: m(PROTEINA_GRUPO_ID),
              opciones: [{ itemId: CHULETA_ID }],
            },
          ],
        }),
      },
      {
        campo: 'grupos[].opciones[].itemId',
        itemId: HAMBURGUESA_ESPECIAL_ID,
        personalizacion: (m) => ({
          grupos: [
            {
              grupoId: PROTEINA_GRUPO_ID,
              opciones: [{ itemId: m(CHULETA_ID) }],
            },
          ],
        }),
      },
      {
        campo: 'componentes[].componenteItemId',
        itemId: COMBO_ESPECIAL_ID,
        personalizacion: (m) => ({
          componentes: [
            {
              componenteItemId: m(HAMBURGUESA_ESPECIAL_ID),
              unidad: 1,
              grupos: [
                {
                  grupoId: PROTEINA_GRUPO_ID,
                  opciones: [{ itemId: CHULETA_ID }],
                },
              ],
            },
          ],
        }),
      },
    ];

    it('POST /calculo-precios/calcular: cada id en mayúsculas cobra lo mismo que en minúsculas', async () => {
      for (const { campo, itemId, personalizacion } of FILAS()) {
        const calcular = (mayus: (id: string) => string) =>
          enviar('calculo-precios/calcular', {
            lineas: [
              {
                itemId,
                cantidad: '1',
                personalizacion: personalizacion(mayus),
              },
            ],
          });
        const minusculas = await calcular((id) => id);
        expect({ campo, status: minusculas.status }).toEqual({
          campo,
          status: 201,
        });
        const mayusculas = await calcular((id) => id.toUpperCase());
        expect({ campo, mensajes: mensajes(mayusculas) }).toEqual({
          campo,
          mensajes: [],
        });
        expect(mayusculas.status).toBe(201);
        expect((mayusculas.body as Calculo).totales).toEqual(
          (minusculas.body as Calculo).totales,
        );
      }
    });

    // `/calcular` no mira las omisiones (sacar no cobra), así que el omitido se
    // prueba donde se lee: la venta, que lo congela y no descuenta su stock.
    it('POST /ventas: el ingrediente omitido en mayúsculas se omite y no se descuenta', async () => {
      const movimientos = await movimientosDe(omitibleId);
      const res = await enviar('ventas', {
        lineas: [
          {
            itemId: recetaId,
            cantidad: '1',
            personalizacion: { omitidos: [omitibleId.toUpperCase()] },
          },
        ],
        pagos: pagoEfectivo,
      });
      expect(mensajes(res)).toEqual([]);
      expect(res.status).toBe(201);
      expect(await movimientosDe(omitibleId)).toBe(movimientos);
      const [detalle]: { personalizacion: { omitidos: string[] } }[] =
        await ds.query(
          `SELECT personalizacion FROM venta_detalles
            WHERE venta_id = $1 AND eliminado_el IS NULL`,
          [(res.body as IdResponse).id],
        );
      expect(detalle.personalizacion.omitidos).toEqual([omitibleId]);
    });

    // La línea de cuenta no pasa por `aliasarCasingDeIds`: el id del plato va
    // crudo a los resolvers y a la búsqueda del ítem vivo.
    it('POST /cuentas/:id/lineas: el plato en mayúsculas se agrega con su extra', async () => {
      const cuentaId = await abrirCuenta();
      const res = await enviar(`cuentas/${cuentaId}/lineas`, {
        itemId: recetaId.toUpperCase(),
        cantidad: '1',
        personalizacion: { extras: [{ ingredienteItemId: extraId }] },
      });
      expect(mensajes(res)).toEqual([]);
      expect(res.status).toBe(201);
      const lineas: { item_id: string; precio_unitario: string }[] =
        await ds.query(
          `SELECT item_id, precio_unitario::text FROM cuenta_lineas
            WHERE cuenta_id = $1 AND eliminado_el IS NULL`,
          [cuentaId],
        );
      expect(lineas).toEqual([
        { item_id: recetaId, precio_unitario: '4500.0000' },
      ]);
    });

    it('POST /ventas: el mismo omitido en dos casings es un repetido', async () => {
      const res = await enviar('ventas', {
        lineas: [
          {
            itemId: recetaId,
            cantidad: '1',
            personalizacion: {
              omitidos: [omitibleId, omitibleId.toUpperCase()],
            },
          },
        ],
        pagos: pagoEfectivo,
      });
      expect(res.status).toBe(400);
      expect(mensajes(res)).toContain(
        'Ingrediente omitido duplicado en la personalización',
      );
    });
  });
  describe('extras[].unidades: hasta MAX_UNIDADES_POR_PLATO veces por plato', () => {
    const conUnidades = (unidades: number) => ({
      extras: [{ ingredienteItemId: extraId, unidades }],
    });
    // El pipe antepone la ruta del campo a un mensaje anidado.
    const MENSAJE = `extras.0.Un extra se puede agregar hasta ${MAX_UNIDADES_POR_PLATO} veces por plato`;

    it('POST /calculo-precios/calcular: el tope pasa, uno más es 400', async () => {
      const calcular = (unidades: number) =>
        enviar('calculo-precios/calcular', {
          lineas: [
            {
              itemId: recetaId,
              cantidad: '1',
              personalizacion: conUnidades(unidades),
            },
          ],
        });
      const justo = await calcular(MAX_UNIDADES_POR_PLATO);
      expect(justo.status).toBe(201);
      const pasado = await calcular(MAX_UNIDADES_POR_PLATO + 1);
      expect(pasado.status).toBe(400);
      expect(mensajes(pasado)).toContain(`lineas.0.personalizacion.${MENSAJE}`);
    });

    it('POST /ventas: uno más que el tope es 400 y no escribe la venta', async () => {
      const ventas = await ventasDelTenant();
      const res = await enviar('ventas', {
        lineas: [
          {
            itemId: recetaId,
            cantidad: '1',
            personalizacion: conUnidades(MAX_UNIDADES_POR_PLATO + 1),
          },
        ],
        pagos: pagoEfectivo,
      });
      expect(res.status).toBe(400);
      expect(mensajes(res)).toContain(`lineas.0.personalizacion.${MENSAJE}`);
      expect(await ventasDelTenant()).toBe(ventas);
    });

    // Medido el 2026-10-08: 10^12 unidades de un extra de $500 daban 500 por
    // desborde de `cuenta_lineas.precio_unitario` NUMERIC(18,4).
    it('POST /cuentas/:id/lineas: 10^12 unidades es 400, no un 500', async () => {
      const cuentaId = await abrirCuenta();
      const res = await enviar(`cuentas/${cuentaId}/lineas`, {
        itemId: recetaId,
        cantidad: '1',
        personalizacion: conUnidades(1e12),
      });
      expect(res.status).toBe(400);
      expect(mensajes(res)).toContain(`personalizacion.${MENSAJE}`);
      expect(await lineasDeCuenta(cuentaId)).toBe(0);
    });
  });

  describe('pagos[].metodoPagoId en mayúsculas es el mismo método', () => {
    const EFECTIVO_MAYUSCULAS = EFECTIVO_ID.toUpperCase();

    const pagosDe = (ventaId: string) =>
      ds.query(
        `SELECT metodo_pago_id, monto::text, vuelto::text FROM pagos
          WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [ventaId],
      );

    // El servicio cuesta $1.000 con el IVA adentro: de $5.000 en efectivo
    // vuelven $4.000. El vuelto sale de `permite_vuelto` del método, que se lee
    // del mismo mapa que el gate: en mayúsculas tampoco se encontraba.
    it('POST /ventas: guarda el pago con su vuelto', async () => {
      const res = await enviar('ventas', {
        lineas: [{ itemId: servicioId, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_MAYUSCULAS, monto: '5000.0000' }],
      });
      expect(mensajes(res)).toEqual([]);
      expect(res.status).toBe(201);
      expect(await pagosDe((res.body as IdResponse).id)).toEqual([
        {
          metodo_pago_id: EFECTIVO_ID,
          monto: '5000.0000',
          vuelto: '4000.0000',
        },
      ]);
    });

    it('POST /cuentas/:id/cerrar: guarda el pago con su vuelto', async () => {
      const cuentaId = await abrirCuenta();
      await crear(`cuentas/${cuentaId}/lineas`, {
        itemId: servicioId,
        cantidad: '1',
      });
      const res = await enviar(`cuentas/${cuentaId}/cerrar`, {
        garzonId: garzon.id,
        pin: garzon.pin,
        pagos: [{ metodoPagoId: EFECTIVO_MAYUSCULAS, monto: '5000.0000' }],
      });
      expect(mensajes(res)).toEqual([]);
      expect(res.status).toBe(201);
      expect(await pagosDe((res.body as { ventaId: string }).ventaId)).toEqual([
        {
          metodo_pago_id: EFECTIVO_ID,
          monto: '5000.0000',
          vuelto: '4000.0000',
        },
      ]);
    });

    it('POST /pagos: el abono se guarda', async () => {
      const venta = await crear('ventas', {
        lineas: [{ itemId: servicioId, cantidad: '1' }],
      });
      const res = await enviar('pagos', {
        ventaId: venta.id,
        pagos: [{ metodoPagoId: EFECTIVO_MAYUSCULAS, monto: '400.0000' }],
      });
      expect(mensajes(res)).toEqual([]);
      expect(res.status).toBe(201);
      expect(await pagosDe(venta.id)).toEqual([
        { metodo_pago_id: EFECTIVO_ID, monto: '400.0000', vuelto: '0.0000' },
      ]);
    });
  });

  describe('un array como elemento de la personalización es 400 con su mensaje', () => {
    const grupoValido = () => ({
      grupoId: PROTEINA_GRUPO_ID,
      opciones: [{ itemId: CHULETA_ID }],
    });
    const componente = (grupos: unknown[]) => ({
      componenteItemId: HAMBURGUESA_ESPECIAL_ID,
      unidad: 1,
      grupos,
    });
    // `valida` es el control: la misma forma con un objeto donde va el `[]`.
    const FILAS = (): {
      campo: string;
      itemId: string;
      conArray: object;
      valida: object;
      mensaje: string;
    }[] => [
      {
        campo: 'extras',
        itemId: recetaId,
        conArray: { extras: [[]] },
        valida: { extras: [{ ingredienteItemId: extraId }] },
        mensaje: 'each value in extras must be an object',
      },
      {
        campo: 'grupos',
        itemId: HAMBURGUESA_ESPECIAL_ID,
        conArray: { grupos: [[]] },
        valida: { grupos: [grupoValido()] },
        mensaje: 'each value in grupos must be an object',
      },
      {
        campo: 'grupos[].opciones',
        itemId: HAMBURGUESA_ESPECIAL_ID,
        conArray: { grupos: [{ grupoId: PROTEINA_GRUPO_ID, opciones: [[]] }] },
        valida: { grupos: [grupoValido()] },
        mensaje: 'grupos.0.each value in opciones must be an object',
      },
      {
        campo: 'componentes',
        itemId: COMBO_ESPECIAL_ID,
        conArray: { componentes: [[]] },
        valida: { componentes: [componente([grupoValido()])] },
        mensaje: 'each value in componentes must be an object',
      },
      {
        campo: 'componentes[].grupos',
        itemId: COMBO_ESPECIAL_ID,
        conArray: { componentes: [componente([[]])] },
        valida: { componentes: [componente([grupoValido()])] },
        mensaje: 'componentes.0.each value in grupos must be an object',
      },
    ];

    it('POST /calculo-precios/calcular: 400 que nombra el campo; el objeto pasa', async () => {
      for (const { campo, itemId, conArray, valida, mensaje } of FILAS()) {
        const calcular = (personalizacion: object) =>
          enviar('calculo-precios/calcular', {
            lineas: [{ itemId, cantidad: '1', personalizacion }],
          });
        const res = await calcular(conArray);
        expect({ campo, status: res.status }).toEqual({ campo, status: 400 });
        expect({ campo, mensajes: mensajes(res) }).toEqual({
          campo,
          mensajes: [`lineas.0.personalizacion.${mensaje}`],
        });

        const ok = await calcular(valida);
        expect({ campo, status: ok.status }).toEqual({ campo, status: 201 });
      }
    });
  });
});
