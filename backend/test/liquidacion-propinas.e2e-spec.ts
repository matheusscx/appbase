import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { AppModule } from '../src/app.module';

// Seed PARIS (docs/features/liquidacion-propinas-motor.md + seeder.service.ts):
// config de distribución 0.10 con un único grupo "Garzones" (tipo_garzon=garzon,
// PARTES_IGUALES, 100%). Regla del motor: el pool = suma de TODOS los tips
// elegibles del período; los RECEPTORES de un grupo = garzones que aparecen en
// tips con ese tipo_garzon (∪ sesiones), no la tabla de garzones. Por eso el
// "Mostrador" del POS (tipo_garzon=null) suma al pool pero nunca recibe, y los
// garzones reales solo reciben si trabajaron (acá se siembran con tips propios).
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
const ITEM_ID = '550e8400-e29b-41d4-a716-446655440116'; // Producto demo (unidad · CLP, stock 50)
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105'; // permite_vuelto = true
const MOSTRADOR_ID = '550e8400-e29b-41d4-a716-446655440339';
const ANA_ID = '550e8400-e29b-41d4-a716-446655440238';
const BRUNO_ID = '550e8400-e29b-41d4-a716-446655440239';
const CARLA_ID = '550e8400-e29b-41d4-a716-446655440240';
const GARZON_IDS = [ANA_ID, BRUNO_ID, CARLA_ID];

interface TokenResponse {
  access_token: string;
}
interface Participante {
  garzonId: string;
  grupoId: string;
  tipoGarzon: string | null;
  incluido: boolean;
  ventasBase: string;
  horas: string;
  monto: string;
}
interface GrupoPreview {
  id: string;
  tipoGarzon: string | null;
  porcentaje: string;
  criterio: string;
  montoGrupo: string;
}
interface PreviewReparto {
  poolTotal: string;
  grupos: GrupoPreview[];
  participantes: Participante[];
  advertencias: unknown[];
}
interface AjustesReparto {
  exclusiones?: string[];
  montosManuales?: Array<{ garzonId: string; monto: string }>;
}
interface GrupoDistribucion {
  tipoGarzon: string;
  nombre: string;
  porcentaje: string;
  criterio: string;
  baseVentas?: string;
  activo?: boolean;
  orden?: number;
}
// Config default sembrada para PARIS (seeder.service.ts): un único grupo
// Garzones al 100% PARTES_IGUALES. Se restaura en afterAll tras mutar la config.
const DISTRIBUCION_DEFAULT: GrupoDistribucion[] = [
  {
    tipoGarzon: 'garzon',
    nombre: 'Garzones',
    porcentaje: '1',
    criterio: 'PARTES_IGUALES',
    baseVentas: 'TOTAL_FINAL',
    activo: true,
    orden: 0,
  },
];

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  expect(resLogin.status).toBe(200);
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  expect(resTenant.status).toBe(200);
  return (resTenant.body as TokenResponse).access_token;
}

async function abrirCaja(
  app: INestApplication<App>,
  token: string,
): Promise<string> {
  const disp = await request(app.getHttpServer())
    .get('/api/caja/cajones-disponibles')
    .set('Authorization', `Bearer ${token}`);
  const cajonId = (disp.body as Array<{ cajonId: string }>)[0]?.cajonId;
  const res = await request(app.getHttpServer())
    .post('/api/caja/abrir')
    .set('Authorization', `Bearer ${token}`)
    .send({
      cajonId,
      saldoInicial: '10000.0000',
      comentario: 'Apertura E2E propinas',
    });
  return (res.body as { id: string }).id;
}

/**
 * El cierre es en DOS fases: `POST /:id/conteo` congela el arqueo y auto-cierra
 * si cuadra; si descuadra pasa a `en_conciliacion` y hay que resolver la fase 2
 * con `POST /:id/cerrar`, que exige un motivo por línea descuadrada. Esta suite
 * vende en efectivo por montos grandes, así que SIEMPRE descuadra contra el
 * conteo del saldo inicial. Llamar solo a `cerrar` —y encima con el body de la
 * fase 1— no cerraba nada: el cajón quedaba ocupado y la suite siguiente que
 * intentaba abrir se llevaba un 409 críptico. El teardown **asevera** el cierre.
 */
async function cerrarCaja(
  app: INestApplication<App>,
  token: string,
  cajaId: string,
): Promise<void> {
  const conteo = await request(app.getHttpServer())
    .post(`/api/caja/${cajaId}/conteo`)
    .set('Authorization', `Bearer ${token}`)
    .send({ lineas: [{ metodoPagoId: null, montoContado: '10000' }] });
  expect([200, 201]).toContain(conteo.status);

  if ((conteo.body as { estado?: string }).estado === 'en_conciliacion') {
    const motivos = await request(app.getHttpServer())
      .get('/api/motivos-diferencia?soloActivas=true')
      .set('Authorization', `Bearer ${token}`);
    const motivoId = (motivos.body as { id: string }[])[0]?.id;
    const cierre = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/cerrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ metodoPagoId: null, motivoDiferenciaId: motivoId }] });
    expect([200, 201]).toContain(cierre.status);
  }
}

describe('Liquidación de propinas — reparto (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let cajaId: string;

  // Rango amplio que cubre "ahora": el pool selecciona por creado_el. Las
  // aserciones son por reconciliación (suma == pool) y por deltas relativos,
  // robustas ante tips que otras suites hayan dejado en el mismo rango.
  const fechaDesde = new Date('2020-01-01T00:00:00.000Z').toISOString();
  const fechaHasta = new Date(Date.now() + 3_600_000).toISOString();

  async function crearVentaSinPropina(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000000.0000' }],
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  async function crearVentaConPropina(monto: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000000.0000' }],
        propinaDirecta: { montoPagado: monto, porcentajeSugerido: '0.10' },
      })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  // Siembra un tip de un garzón REAL, como haría el cierre de mesa: lo vuelve
  // receptor del grupo de su tipo_garzon y suma su monto al pool. La venta
  // (cantidad 1) satisface el JOIN a ventas; `baseVentas`, si se da, fija por SQL
  // la base de esa venta (peso del criterio VENTAS_NETAS) sin consumir más stock
  // del producto demo. `tipoGarzon` decide a qué grupo pertenece.
  async function sembrarTipGarzon(
    garzonId: string,
    monto: string,
    opts: { baseVentas?: string; tipoGarzon?: string } = {},
  ): Promise<void> {
    const ventaId = await crearVentaSinPropina();
    if (opts.baseVentas) {
      await ds.query(
        `UPDATE ventas
           SET base_ventas_total_final = $1, base_ventas_sin_impuestos = $1
         WHERE venta_id = $2`,
        [opts.baseVentas, ventaId],
      );
    }
    await ds.query(
      `INSERT INTO venta_propina
         (tenant_id, venta_id, garzon_id, porcentaje_sugerido, monto_sugerido,
          monto_pagado, tipo, estado, sesion_garzon_id, turno_id, tipo_garzon,
          liquidacion_id, creado_el)
       VALUES ($1,$2,$3,'0.100000',$4,$4,'manual','pagada',NULL,NULL,$5,NULL,NOW())`,
      [PARIS_TENANT_ID, ventaId, garzonId, monto, opts.tipoGarzon ?? 'garzon'],
    );
  }

  /**
   * Una sesión de trabajo YA CERRADA, de `horas` horas, terminada hace un
   * minuto — o sea dentro del rango de liquidación.
   *
   * Cerrada a propósito: una sesión abierta es única por garzón, y dejarla así
   * le rompería el `iniciar` al spec que corra después (`jest-e2e.json` va con
   * `maxWorkers: 1`, así que el estado se filtra hacia adelante).
   */
  /** Ids de las sesiones sembradas, para poder borrarlas después. */
  const sesionesSembradas: string[] = [];

  async function sembrarSesionCerrada(
    garzonId: string,
    horas: number,
  ): Promise<void> {
    const fin = new Date(Date.now() - 60_000);
    const inicio = new Date(fin.getTime() - horas * 3_600_000);
    const filas: { sesion_garzon_id: string }[] = await ds.query(
      `INSERT INTO sesiones_garzon
         (tenant_id, garzon_id, turno_id, tipo_garzon, inicio_el, fin_el,
          estado, creado_el, actualizado_el)
       SELECT $1, $2, t.turno_id, 'garzon', $3, $4, 'cerrada', NOW(), NOW()
         FROM turnos t
        WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL
        LIMIT 1
       RETURNING sesion_garzon_id`,
      [PARIS_TENANT_ID, garzonId, inicio.toISOString(), fin.toISOString()],
    );
    if (filas[0]) sesionesSembradas.push(filas[0].sesion_garzon_id);
  }

  async function preview(ajustes?: AjustesReparto): Promise<PreviewReparto> {
    const res = await request(app.getHttpServer())
      .post('/api/propinas/liquidaciones/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ fechaDesde, fechaHasta, ...(ajustes ? { ajustes } : {}) })
      .expect(201);
    return res.body as PreviewReparto;
  }

  async function putDistribucion(
    grupos: GrupoDistribucion[],
    porcentajeSugerido = '0.10',
    flags: { habilitadoPos?: boolean; habilitadoSalones?: boolean } = {},
  ): Promise<void> {
    await request(app.getHttpServer())
      .put('/api/propinas/distribucion')
      .set('Authorization', `Bearer ${token}`)
      .send({ porcentajeSugerido, grupos, ...flags })
      .expect(200);
  }

  async function contarPropinasDeVenta(ventaId: string): Promise<number> {
    const rows: { n: number }[] = await ds.query(
      `SELECT COUNT(*)::int AS n FROM venta_propina
       WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    return rows[0]?.n ?? 0;
  }

  const incluidos = (p: Participante[]): Participante[] =>
    p.filter((x) => x.incluido);

  const suma = (p: Participante[]): string =>
    p.reduce((acc, x) => acc.plus(x.monto), new Decimal(0)).toFixed(4);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `switch-tenant` y `refresh` leen `req.cookies`, y `cookieParser` vive en
    // `main.ts`, que el e2e no ejecuta. Sin esto los dos cortan con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    ds = app.get(DataSource);
    token = await login(app);
    cajaId = await abrirCaja(app, token);

    // Receptores del período: Ana, Bruno y Carla trabajaron (tip propio).
    await sembrarTipGarzon(ANA_ID, '1000');
    await sembrarTipGarzon(BRUNO_ID, '1000');
    await sembrarTipGarzon(CARLA_ID, '1000');
  }, 60000);

  afterAll(async () => {
    // `close` en un `finally`: `cerrarCaja` afirma sus status adentro, así que
    // si la caja no cierra **tira**, y sin esto la app de Nest quedaba viva con
    // su `@Cron` escribiéndole a la base durante las suites siguientes. El
    // fallo sigue propagando; lo que cambia es que ya no se lleva el cierre
    // puesto. Ver `docs/agent/pendientes.md` § 1.
    try {
      if (cajaId) await cerrarCaja(app, token, cajaId);
    } finally {
      await app.close();
    }
  });

  it('reparte el pool en partes iguales entre los garzones receptores', async () => {
    const prev = await preview();

    expect(prev.grupos).toHaveLength(1);
    expect(prev.grupos[0].criterio).toBe('PARTES_IGUALES');

    const ids = incluidos(prev.participantes).map((p) => p.garzonId);
    // Los tres garzones que trabajaron reciben; el Mostrador nunca.
    for (const g of GARZON_IDS) expect(ids).toContain(g);
    expect(ids).not.toContain(MOSTRADOR_ID);

    // Reconciliación: lo repartido a los incluidos iguala el pool.
    expect(suma(incluidos(prev.participantes))).toBe(
      new Decimal(prev.poolTotal).toFixed(4),
    );

    // PARTES_IGUALES: los garzones difieren a lo sumo en 1 (mayores restos, CLP sin decimales).
    const montos = prev.participantes
      .filter((p) => GARZON_IDS.includes(p.garzonId))
      .map((p) => new Decimal(p.monto));
    for (const m of montos) expect(m.gt(0)).toBe(true);
    expect(
      Decimal.max(...montos)
        .minus(Decimal.min(...montos))
        .lte(1),
    ).toBe(true);
  });

  it('la propina del POS entra al pool pero el Mostrador nunca recibe', async () => {
    const antes = await preview();
    const receptoresAntes = incluidos(antes.participantes)
      .map((p) => p.garzonId)
      .sort();

    await crearVentaConPropina('3000');

    const despues = await preview();

    // El pool crece exactamente en la propina del Mostrador.
    expect(
      new Decimal(despues.poolTotal).minus(antes.poolTotal).toString(),
    ).toBe('3000');
    // El Mostrador aportó pero no se volvió receptor: el set de receptores no cambia.
    expect(despues.participantes.map((p) => p.garzonId)).not.toContain(
      MOSTRADOR_ID,
    );
    expect(
      incluidos(despues.participantes)
        .map((p) => p.garzonId)
        .sort(),
    ).toEqual(receptoresAntes);
    // La propina del POS se reparte entre los garzones: la reconciliación se mantiene.
    expect(suma(incluidos(despues.participantes))).toBe(
      new Decimal(despues.poolTotal).toFixed(4),
    );
  });

  it('la propina de una venta anulada no entra al pool', async () => {
    const antes = await preview();

    const ventaId = await crearVentaConPropina('7000');
    const conPropina = await preview();
    // Control: mientras la venta está viva, su propina SÍ suma al pool. Sin este
    // paso el test pasaría igual aunque la propina nunca hubiera entrado.
    expect(
      new Decimal(conPropina.poolTotal).minus(antes.poolTotal).toString(),
    ).toBe('7000');

    await ds.query(
      `UPDATE ventas SET estado = 'cancelada' WHERE venta_id = $1`,
      [ventaId],
    );

    const despues = await preview();
    expect(despues.poolTotal).toBe(antes.poolTotal);
    expect(suma(incluidos(despues.participantes))).toBe(
      new Decimal(despues.poolTotal).toFixed(4),
    );
  });

  /**
   * El caso hermano del de arriba, y el que estaba abierto: ahí la venta se
   * anula ANTES de que exista el borrador, así que `buscarTipsElegibles` —que sí
   * filtraba `estado <> 'cancelada'`— la deja afuera sola. Acá se anula **con el
   * borrador ya creado**, y el recálculo de config pasa por
   * `buscarTipsPorFuentes`, que trabaja sobre las fuentes ya congeladas.
   *
   * Filtrar solo el peso no alcanzaba: le sacaba el peso al garzón y dejaba su
   * plata en el `poolTotal` congelado, o sea que la redistribuía entre los
   * demás. Por eso este caso mira **el pool**, que es la mitad que faltaba.
   */
  it('anular una venta con el borrador ABIERTO le saca la propina del pool, no la redistribuye', async () => {
    const ventaId = await crearVentaConPropina('9000');

    const resCrear = await request(app.getHttpServer())
      .post('/api/propinas/liquidaciones')
      .set('Authorization', `Bearer ${token}`)
      .send({ fechaDesde, fechaHasta })
      .expect(201);
    const liquidacionId = (resCrear.body as { id: string }).id;
    const poolConLaVenta = (resCrear.body as { poolTotal: string }).poolTotal;

    await ds.query(
      `UPDATE ventas SET estado = 'cancelada' WHERE venta_id = $1`,
      [ventaId],
    );

    const resConfig = await request(app.getHttpServer())
      .post(`/api/propinas/liquidaciones/${liquidacionId}/actualizar-config`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const detalle = resConfig.body as {
      poolTotal: string;
      participantes: Participante[];
    };

    // El pool baja exactamente la propina de la venta anulada.
    expect(
      new Decimal(poolConLaVenta).minus(detalle.poolTotal).toString(),
    ).toBe('9000');

    // Y lo repartido sigue cuadrando con el pool nuevo: la plata no se quedó
    // colgada ni se repartió entre los demás.
    expect(suma(incluidos(detalle.participantes))).toBe(
      new Decimal(detalle.poolTotal).toFixed(4),
    );
  });

  it('excluir un garzón lo saca del reparto y redistribuye el pool entre el resto', async () => {
    const base = await preview();
    const conExclusion = await preview({ exclusiones: [ANA_ID] });

    const ana = conExclusion.participantes.find((p) => p.garzonId === ANA_ID);
    expect(ana?.incluido).toBe(false);

    // Bruno y Carla siguen incluidos y absorben la parte de Ana (reciben más que sin exclusión).
    const montoBase = (p: PreviewReparto, g: string): Decimal =>
      new Decimal(p.participantes.find((x) => x.garzonId === g)!.monto);
    for (const g of [BRUNO_ID, CARLA_ID]) {
      const p = conExclusion.participantes.find((x) => x.garzonId === g);
      expect(p?.incluido).toBe(true);
      expect(montoBase(conExclusion, g).gt(montoBase(base, g))).toBe(true);
    }

    // Reconciliación con exclusión: la suma de los INCLUIDOS iguala el pool (no se pierde dinero).
    expect(suma(incluidos(conExclusion.participantes))).toBe(
      new Decimal(conExclusion.poolTotal).toFixed(4),
    );
  });

  it('liquidar persiste, confirma y saca las propinas del pool de futuros repartos', async () => {
    const ventaId = await crearVentaConPropina('7000');
    const [{ venta_propina_id: tipId }]: Array<{ venta_propina_id: string }> =
      await ds.query(
        `SELECT venta_propina_id FROM venta_propina
         WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [ventaId],
      );

    await request(app.getHttpServer())
      .post('/api/propinas/liquidaciones/liquidar')
      .set('Authorization', `Bearer ${token}`)
      .send({ fechaDesde, fechaHasta })
      .expect(201);

    // La propina quedó asignada a una liquidación (bloqueada).
    const [tip]: Array<{ liquidacion_id: string | null }> = await ds.query(
      `SELECT liquidacion_id FROM venta_propina WHERE venta_propina_id = $1`,
      [tipId],
    );
    expect(tip.liquidacion_id).not.toBeNull();

    // Un nuevo reparto ya no ve esas propinas: el pool queda en cero.
    const despues = await preview();
    expect(new Decimal(despues.poolTotal).toNumber()).toBe(0);
  });

  // Estos casos mutan la config de distribución de PARIS por la API real
  // (PUT /propinas/distribucion, versionada) y la restauran en afterAll. Cada
  // test parte de pool 0 (resetPool liquida cualquier remanente) y siembra sus
  // propios tips, así el resultado es determinista sin importar el orden.
  describe('config alternativa de distribución', () => {
    async function resetPool(): Promise<void> {
      const prev = await preview();
      if (new Decimal(prev.poolTotal).lte(0)) return;
      await request(app.getHttpServer())
        .post('/api/propinas/liquidaciones/liquidar')
        .set('Authorization', `Bearer ${token}`)
        .send({ fechaDesde, fechaHasta })
        .expect(201);
    }

    afterAll(async () => {
      await putDistribucion(DISTRIBUCION_DEFAULT);
    });

    it('VENTAS_NETAS reparte proporcional a las ventas de cada garzón', async () => {
      await resetPool();
      // Mismo aporte al pool (1000 c/u) pero base de ventas 3000:2000:1000 → el
      // peso de VENTAS_NETAS difiere aunque el dinero puesto sea igual.
      await sembrarTipGarzon(ANA_ID, '1000', { baseVentas: '3000' });
      await sembrarTipGarzon(BRUNO_ID, '1000', { baseVentas: '2000' });
      await sembrarTipGarzon(CARLA_ID, '1000', { baseVentas: '1000' });

      await putDistribucion([
        {
          tipoGarzon: 'garzon',
          nombre: 'Garzones',
          porcentaje: '1',
          criterio: 'VENTAS_NETAS',
          baseVentas: 'TOTAL_FINAL',
          activo: true,
          orden: 0,
        },
      ]);

      const prev = await preview();
      expect(prev.grupos).toHaveLength(1);
      expect(prev.grupos[0].criterio).toBe('VENTAS_NETAS');

      const porId = (g: string): Participante =>
        prev.participantes.find((p) => p.garzonId === g)!;
      const [ana, bruno, carla] = [ANA_ID, BRUNO_ID, CARLA_ID].map(porId);

      // La base de ventas quedó 3:2:1 (precondición del criterio).
      expect(new Decimal(ana.ventasBase).gt(bruno.ventasBase)).toBe(true);
      expect(new Decimal(bruno.ventasBase).gt(carla.ventasBase)).toBe(true);

      // El reparto sigue esa base: quien vendió más recibe más.
      expect(new Decimal(ana.monto).gt(bruno.monto)).toBe(true);
      expect(new Decimal(bruno.monto).gt(carla.monto)).toBe(true);

      // No es un reparto parejo (así se distingue de PARTES_IGUALES).
      const montos = [ana, bruno, carla].map((p) => new Decimal(p.monto));
      expect(
        Decimal.max(...montos)
          .minus(Decimal.min(...montos))
          .gt(1),
      ).toBe(true);

      // Reconciliación: lo repartido iguala el pool.
      expect(suma(incluidos(prev.participantes))).toBe(
        new Decimal(prev.poolTotal).toFixed(4),
      );
    });

    /**
     * `HORAS_TRABAJADAS`: el peso sale de las sesiones de trabajo que caen
     * dentro del rango, no de la plata.
     *
     * Las sesiones se siembran por SQL —**cerradas**, con `fin_el`— por la
     * misma razón que `sembrarTipGarzon` inserta el tip directo: no hay forma
     * de que un test haga durar una sesión tres horas. Cerradas y no abiertas
     * a propósito: una sesión abierta es única por garzón y le rompería el
     * `iniciar` al spec que corra después.
     */
    /**
     * En su propio `describe` por el `afterAll`: las sesiones sembradas son
     * estado del tenant, no de la venta, y si quedaran vivas pondrían a Carla
     * en dos grupos del período siguiente —`garzon` por la sesión, `cocina` por
     * su tip— y el test de dos grupos cortaría con un 400 que no es suyo.
     * Medido: así se cayó la primera versión.
     */
    describe('HORAS_TRABAJADAS', () => {
      afterAll(async () => {
        // ⚠️ El ORDEN importa, y las dos formas de equivocarse ya se midieron.
        // Drenar el pool ANTES de borrar las sesiones: con este criterio el
        // peso son las horas, así que borrarlas primero deja tips sin ningún
        // participante que pueda recibirlos y el `resetPool` del test siguiente
        // corta con un 400 que no es suyo. Y borrarlas hay que borrarlas: si
        // quedan vivas, Carla pertenece a "Garzones" por la sesión y a "Cocina"
        // por su tip, y el test de dos grupos corta con otro 400 ajeno.
        await resetPool();
        if (sesionesSembradas.length) {
          await ds.query(
            `DELETE FROM sesiones_garzon WHERE sesion_garzon_id = ANY($1::uuid[])`,
            [sesionesSembradas],
          );
          sesionesSembradas.length = 0;
        }
      });

      it('reparte proporcional a las horas de cada garzón', async () => {
        await resetPool();
        // Aporte IGUAL al pool: si el reparto saliera distinto por la plata y no
        // por las horas, este test no distinguiría nada.
        await sembrarTipGarzon(ANA_ID, '1000');
        await sembrarTipGarzon(BRUNO_ID, '1000');
        await sembrarTipGarzon(CARLA_ID, '1000');
        // 4 h, 2 h y 1 h dentro del rango.
        await sembrarSesionCerrada(ANA_ID, 4);
        await sembrarSesionCerrada(BRUNO_ID, 2);
        await sembrarSesionCerrada(CARLA_ID, 1);

        await putDistribucion([
          {
            tipoGarzon: 'garzon',
            nombre: 'Garzones',
            porcentaje: '1',
            criterio: 'HORAS_TRABAJADAS',
            baseVentas: 'TOTAL_FINAL',
            activo: true,
            orden: 0,
          },
        ]);

        const prev = await preview();
        expect(prev.grupos[0].criterio).toBe('HORAS_TRABAJADAS');

        const porId = (g: string): Participante =>
          prev.participantes.find((p) => p.garzonId === g)!;
        const [ana, bruno, carla] = [ANA_ID, BRUNO_ID, CARLA_ID].map(porId);

        // Precondición del criterio: las horas quedaron 4:2:1.
        expect(new Decimal(ana.horas).gt(bruno.horas)).toBe(true);
        expect(new Decimal(bruno.horas).gt(carla.horas)).toBe(true);

        // Y el reparto las sigue.
        expect(new Decimal(ana.monto).gt(bruno.monto)).toBe(true);
        expect(new Decimal(bruno.monto).gt(carla.monto)).toBe(true);

        // Reconciliación: lo repartido iguala el pool.
        expect(suma(incluidos(prev.participantes))).toBe(
          new Decimal(prev.poolTotal).toFixed(4),
        );
      });
    });

    it('dos grupos parten el pool por porcentaje y reparten internamente', async () => {
      await resetPool();
      // Ana y Bruno al grupo Garzones; Carla al grupo Cocina (por el tipo_garzon
      // del tip, no por garzon.tipo). Aportes iguales → pool 3000.
      await sembrarTipGarzon(ANA_ID, '1000');
      await sembrarTipGarzon(BRUNO_ID, '1000');
      await sembrarTipGarzon(CARLA_ID, '1000', { tipoGarzon: 'cocina' });

      await putDistribucion([
        {
          tipoGarzon: 'garzon',
          nombre: 'Garzones',
          porcentaje: '0.70',
          criterio: 'PARTES_IGUALES',
          activo: true,
          orden: 0,
        },
        {
          tipoGarzon: 'cocina',
          nombre: 'Cocina',
          porcentaje: '0.30',
          criterio: 'PARTES_IGUALES',
          activo: true,
          orden: 1,
        },
      ]);

      const prev = await preview();
      expect(prev.grupos).toHaveLength(2);

      const grupoGarzon = prev.grupos.find((g) => g.tipoGarzon === 'garzon')!;
      const grupoCocina = prev.grupos.find((g) => g.tipoGarzon === 'cocina')!;
      const pool = new Decimal(prev.poolTotal);

      // El pool se parte por porcentaje entre grupos (±1 por mayores restos).
      expect(
        new Decimal(grupoGarzon.montoGrupo)
          .minus(pool.times('0.70'))
          .abs()
          .lte(1),
      ).toBe(true);
      expect(
        new Decimal(grupoCocina.montoGrupo)
          .minus(pool.times('0.30'))
          .abs()
          .lte(1),
      ).toBe(true);
      // Los dos grupos juntos suman el pool: no se pierde dinero.
      expect(
        new Decimal(grupoGarzon.montoGrupo)
          .plus(grupoCocina.montoGrupo)
          .toFixed(4),
      ).toBe(pool.toFixed(4));

      // Cada persona recibe solo de su grupo.
      const porId = (g: string): Participante =>
        prev.participantes.find((p) => p.garzonId === g)!;
      expect(porId(ANA_ID).grupoId).toBe(grupoGarzon.id);
      expect(porId(BRUNO_ID).grupoId).toBe(grupoGarzon.id);
      expect(porId(CARLA_ID).grupoId).toBe(grupoCocina.id);
      expect(porId(CARLA_ID).tipoGarzon).toBe('cocina');

      // Carla es la única de Cocina: recibe todo el monto del grupo Cocina.
      expect(porId(CARLA_ID).monto).toBe(
        new Decimal(grupoCocina.montoGrupo).toFixed(4),
      );

      // Reconciliación global.
      expect(suma(incluidos(prev.participantes))).toBe(pool.toFixed(4));
    });
  });

  describe('enforcement de propina por canal', () => {
    afterAll(async () => {
      await putDistribucion(DISTRIBUCION_DEFAULT, '0.10', {
        habilitadoPos: true,
        habilitadoSalones: true,
      });
    });

    it('POS deshabilitado: la venta con propinaDirecta se crea SIN venta_propina', async () => {
      await putDistribucion(DISTRIBUCION_DEFAULT, '0.10', {
        habilitadoPos: false,
      });

      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000000.0000' }],
          propinaDirecta: { montoPagado: '5000', porcentajeSugerido: '0.10' },
        })
        .expect(201);

      const ventaId = (res.body as { id: string }).id;
      expect(await contarPropinasDeVenta(ventaId)).toBe(0);
    });

    it('Salones deshabilitado: la venta con propinaCierreMesa se crea SIN venta_propina', async () => {
      await putDistribucion(DISTRIBUCION_DEFAULT, '0.10', {
        habilitadoSalones: false,
      });

      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000000.0000' }],
          propinaCierreMesa: {
            garzonId: ANA_ID,
            montoPagado: '5000',
            porcentajeSugerido: '0.10',
          },
        })
        .expect(201);

      const ventaId = (res.body as { id: string }).id;
      expect(await contarPropinasDeVenta(ventaId)).toBe(0);
    });

    it('POS habilitado (default): la propinaDirecta SÍ crea venta_propina', async () => {
      await putDistribucion(DISTRIBUCION_DEFAULT, '0.10', {
        habilitadoPos: true,
      });

      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000000.0000' }],
          propinaDirecta: { montoPagado: '5000', porcentajeSugerido: '0.10' },
        })
        .expect(201);

      const ventaId = (res.body as { id: string }).id;
      expect(await contarPropinasDeVenta(ventaId)).toBe(1);
    });

    // La propina es del canal presencial: el POS y el cierre de mesa. Con ambos
    // flags encendidos, lo único que la corta acá es el canal.
    it('canal online: la propina se ignora aunque los dos flags estén encendidos', async () => {
      await putDistribucion(DISTRIBUCION_DEFAULT, '0.10', {
        habilitadoPos: true,
        habilitadoSalones: true,
      });

      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          canal: 'online',
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000000.0000' }],
          propinaDirecta: { montoPagado: '5000', porcentajeSugerido: '0.10' },
        })
        .expect(201);

      const ventaId = (res.body as { id: string }).id;
      expect(await contarPropinasDeVenta(ventaId)).toBe(0);
    });
  });

  /**
   * La capa SQL de `propina-reportes`, que no tenía **ningún** e2e.
   *
   * Es el mismo perfil que ya nos mordió en `fusionarCuentas`: sus dos queries
   * —con CTEs, `generate_series` y agregaciones— solo se ejercitaban en unit
   * con el `dataSource` mockeado, así que ningún error de SQL llegaba a
   * aparecer hasta producción. Lo que se afirma es el **delta** contra una fila
   * recién sembrada; el porqué está en el docblock de cada test.
   */
  interface ResumenReporte {
    periodo: { desde: string; hasta: string };
    cobranza: { conPropina: number; montoCobrado: string };
  }
  interface TrabajadoresReporte {
    data: { garzonId: string; origen: { monto: string } }[];
    totales: { trabajadores: number; montoOriginado: string };
  }

  describe('reportes (la capa SQL, contra Postgres)', () => {
    const dia = 24 * 60 * 60 * 1000;
    const soloFecha = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const desde = soloFecha(Date.now() - dia);
    const hasta = soloFecha(Date.now() + dia);

    const pedir = (ruta: string) =>
      request(app.getHttpServer())
        .get(`/api/propinas/reportes/${ruta}?desde=${desde}&hasta=${hasta}`)
        .set('Authorization', `Bearer ${token}`);

    /**
     * ⚠️ Se afirma sobre el **delta**, no sobre el valor absoluto, y tampoco
     * sobre "los totales son la suma de las filas".
     *
     * Lo segundo sería tautológico: `totales` se calcula en JS recorriendo
     * `data` (`propina-reportes.service.ts` → `sum(...)`), así que compararlos
     * no dice nada del SQL. Y el valor absoluto depende de lo que dejaron los
     * tests de arriba. El delta contra una fila recién sembrada sí prueba lo
     * que importa: que la query la ve, la suma y se la atribuye a quien
     * corresponde.
     */
    it('resumen: la propina recién sembrada entra en la cobranza', async () => {
      const antes = (await pedir('resumen')).body as ResumenReporte;

      await sembrarTipGarzon(ANA_ID, '1500');

      const res = await pedir('resumen');
      expect(res.status).toBe(200);
      const despues = res.body as ResumenReporte;

      expect(despues.periodo).toEqual({ desde, hasta });
      expect(despues.cobranza.conPropina - antes.cobranza.conPropina).toBe(1);
      expect(
        new Decimal(despues.cobranza.montoCobrado)
          .minus(antes.cobranza.montoCobrado)
          .toFixed(4),
      ).toBe('1500.0000');
    });

    it('trabajadores: la atribuye al garzón correcto y la suma al total', async () => {
      const montoDe = (r: TrabajadoresReporte, garzonId: string) =>
        new Decimal(
          r.data.find((t) => t.garzonId === garzonId)?.origen.monto ?? '0',
        );

      const antes = (await pedir('trabajadores')).body as TrabajadoresReporte;

      await sembrarTipGarzon(BRUNO_ID, '2500');

      const res = await pedir('trabajadores');
      expect(res.status).toBe(200);
      const despues = res.body as TrabajadoresReporte;

      // A Bruno, no a otro: un `GROUP BY` por la columna equivocada rompe acá.
      expect(
        montoDe(despues, BRUNO_ID).minus(montoDe(antes, BRUNO_ID)).toFixed(4),
      ).toBe('2500.0000');
      expect(
        montoDe(despues, ANA_ID).minus(montoDe(antes, ANA_ID)).toFixed(4),
      ).toBe('0.0000');
      expect(
        new Decimal(despues.totales.montoOriginado)
          .minus(antes.totales.montoOriginado)
          .toFixed(4),
      ).toBe('2500.0000');
    });

    it('un rango invertido lo corta el DTO, no la base', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/propinas/reportes/resumen?desde=${hasta}&hasta=${desde}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(400);
    });
  });

  /**
   * Las tres guardas de entrada que no tocaba ningún test. Ninguna calcula
   * plata: cortan antes, con un 400 accionable. Van al final del archivo a
   * propósito — la del grupo inactivo deja al tenant sin distribución válida
   * por un instante, y así no hay nadie después a quien romperle el escenario.
   */
  describe('guardas de entrada', () => {
    afterAll(async () => {
      await putDistribucion(DISTRIBUCION_DEFAULT);
    });

    /**
     * ⚠️ Este test **no** valía lo que decía hasta el 2026-08-09: la guarda de
     * orden estaba duplicada —una en `rangoLiquidacionDesde` y otra dentro de
     * `computarReparto`, con el mismo mensaje— así que apagar cualquiera de las
     * dos lo dejaba en verde y no se sabía cuál estaba viva. Lo midió la
     * revisión independiente. La duplicada se borró (era inalcanzable: todos
     * los llamadores normalizan antes), y ahora esto apunta a una sola.
     *
     * Se prueban los **tres** puntos de entrada del período, no solo el
     * preview: son tres llamadas distintas a la misma función y nada garantiza
     * que las tres sigan llamándola.
     */
    it.each([
      ['preview', '/api/propinas/liquidaciones/preview'],
      ['crear', '/api/propinas/liquidaciones'],
      ['liquidar', '/api/propinas/liquidaciones/liquidar'],
    ])(
      '%s: un rango invertido corta antes de calcular nada',
      async (_, ruta) => {
        const res = await request(app.getHttpServer())
          .post(ruta)
          .set('Authorization', `Bearer ${token}`)
          .send({ fechaDesde: fechaHasta, fechaHasta: fechaDesde });

        expect(res.status).toBe(400);
        expect((res.body as { message: string }).message).toBe(
          'La fecha hasta debe ser posterior a desde',
        );
      },
    );

    // El otro borde que solo cierra `rangoLiquidacionDesde`: una fecha ISO 8601
    // legítima que `new Date` no sabe leer. La guarda de orden NO la frena
    // —compara `NaN <= NaN`, siempre `false`— y antes llegaba a Postgres como
    // un 500.
    it('una fecha ISO que `new Date` no sabe leer da 400, no 500', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/propinas/liquidaciones/preview')
        .set('Authorization', `Bearer ${token}`)
        .send({ fechaDesde: '2026-W32-1', fechaHasta });

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe(
        'Las fechas del período deben ser fechas ISO 8601 reales',
      );
    });

    it('un peso manual en cero se rechaza al guardar la config', async () => {
      // El peso es un divisor: un cero convierte el reparto en una división por
      // la suma de pesos que puede quedar en cero, y ahí no hay reparto que
      // valga. Se corta en la config, no en el reparto.
      const res = await request(app.getHttpServer())
        .put('/api/propinas/distribucion')
        .set('Authorization', `Bearer ${token}`)
        .send({
          porcentajeSugerido: '0.10',
          grupos: [
            {
              tipoGarzon: 'garzon',
              nombre: 'Garzones',
              porcentaje: '1',
              criterio: 'MANUAL',
              manualModo: 'PESOS',
              baseVentas: 'TOTAL_FINAL',
              activo: true,
              orden: 0,
              pesos: [{ garzonId: ANA_ID, peso: '0' }],
            },
          ],
        });

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe(
        'El peso debe ser mayor a cero',
      );
    });

    /**
     * ⚠️ Este test NO es el que la entrada del backlog pedía, y el cambio es el
     * hallazgo.
     *
     * Se pedía cubrir la guarda `gruposConfig.length === 0` del servicio de
     * liquidación ("No hay grupos activos para liquidar"). **Es inalcanzable
     * por la API**, medido: guardar la config con todos los grupos apagados ya
     * corta antes, porque los activos tienen que sumar 100% y cero grupos suman
     * 0%. Montar ese estado exigiría SQL directo, o sea escribir un test de un
     * escenario que en producción no existe.
     *
     * Lo que sí se puede afirmar —y es lo que protege al tenant— es que la
     * puerta de entrada no lo deja sin grupos. La guarda del servicio queda
     * como defensa en profundidad, no como código muerto.
     */
    it('la config no deja al tenant sin ningún grupo activo', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/propinas/distribucion')
        .set('Authorization', `Bearer ${token}`)
        .send({
          porcentajeSugerido: '0.10',
          grupos: [{ ...DISTRIBUCION_DEFAULT[0], activo: false }],
        });

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain(
        'La suma de porcentajes de grupos activos debe ser 100%',
      );
    });
  });
});
