import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
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
const MOSTRADOR_ID = '550e8400-e29b-41d4-a716-446655440281';
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
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  return (resTenant.body as TokenResponse).access_token;
}

async function abrirCaja(
  app: INestApplication<App>,
  token: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/caja/abrir')
    .set('Authorization', `Bearer ${token}`)
    .send({ saldoInicial: '10000.0000', comentario: 'Apertura E2E propinas' });
  return (res.body as { id: string }).id;
}

async function cerrarCaja(
  app: INestApplication<App>,
  token: string,
  cajaId: string,
): Promise<void> {
  await request(app.getHttpServer())
    .post(`/api/caja/${cajaId}/cerrar`)
    .set('Authorization', `Bearer ${token}`)
    .send({ montoContado: '10000.0000' });
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
    if (cajaId) await cerrarCaja(app, token, cajaId);
    await app.close();
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
  });
});
