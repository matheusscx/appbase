import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { AppModule } from '../src/app.module';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const BOLETA_ID = '550e8400-e29b-41d4-a716-446655440145';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const PASS = 'admin';

interface TokenResponse {
  access_token: string;
}

/**
 * El día del negocio: la hora de corte (`tenants.hora_corte`) configurable de
 * 0 a 6 y cómo la usan los reportes que dependen de "qué día es hoy". Esta
 * suite crece por tarea del plan (docs/superpowers/specs/
 * 2026-09-18-hora-de-corte-dia-negocio-design.md): Tarea 1 — el dato y su
 * configuración vía `PATCH /tenants/me`; Tarea 2 — los filtros por fecha de
 * `rango-fecha.util.ts` y sus lectores; Tarea 3 — el "hoy" de pagos y del
 * dashboard, `GET /tenants/me` y la serie diaria de propinas.
 */
describe('Día del negocio: hora de corte (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;

  /** Fija el corte del tenant y espera 200. */
  async function fijarCorte(horaCorte: number): Promise<void> {
    const res = await request(app.getHttpServer())
      .patch('/api/tenants/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ horaCorte });
    expect(res.status).toBe(200);
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

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: PASS });
    expect(resLogin.status).toBe(200);
    const resSwitch = await request(app.getHttpServer())
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
    expect(resSwitch.status).toBe(200);
    token = (resSwitch.body as TokenResponse).access_token;
  });

  afterAll(async () => {
    try {
      // El corte vuelve a 0: ningún reporte posterior de otra suite hereda un
      // corte distinto de medianoche.
      await fijarCorte(0);
    } finally {
      await app.close();
    }
  });

  describe('configuración', () => {
    it('PATCH guarda el corte y GET lo devuelve', async () => {
      await fijarCorte(5);
      const res = await request(app.getHttpServer())
        .get('/api/tenants/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect((res.body as { horaCorte: number }).horaCorte).toBe(5);
      await fijarCorte(0);
    });

    it.each([7, -1, 2.5])('rechaza %p con 400', async (horaCorte) => {
      const res = await request(app.getHttpServer())
        .patch('/api/tenants/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ horaCorte });
      expect(res.status).toBe(400);
    });
  });

  /**
   * Task 2: `rango-fecha.util.ts` y sus lectores cortan en el día del NEGOCIO
   * (zona + `hora_corte`), no en el calendario. Dos pagos fijos, siempre en el
   * mismo fin de semana **sin** cambio de horario (2026-09-12/13, sábado a
   * domingo): A cae domingo 01:30 local —antes del corte 5, así que es del
   * SÁBADO— y B domingo 05:30 —después del corte, del DOMINGO—. Con corte 0
   * (control) los dos son simplemente domingo, que es su fecha de calendario.
   */
  describe('filtro por fecha', () => {
    let itemId: string;
    let caja: CajaAbierta | undefined;
    let pagoA: string;
    let pagoB: string;

    /** Mueve el pago a esa hora LOCAL del tenant (zona de su provincia). */
    async function moverAHoraLocal(
      pagoId: string,
      local: string,
    ): Promise<void> {
      await ds.query(
        `UPDATE pagos p
            SET fecha = ($2::timestamp AT TIME ZONE pr.zona_horaria)
           FROM tenants t
           JOIN provincia pr ON pr.provincia_id = t.provincia_id
          WHERE p.pago_id = $1 AND t.tenant_id = p.tenant_id`,
        [pagoId, local],
      );
    }

    async function venderEnEfectivo(): Promise<string> {
      const venta = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${token}`)
        .send({
          tipoDocumentoId: BOLETA_ID,
          lineas: [{ itemId, cantidad: '1' }],
        });
      expect(venta.status).toBe(201);
      const { id, totalFinal } = venta.body as {
        id: string;
        totalFinal: string;
      };

      const pago = await request(app.getHttpServer())
        .post('/api/pagos')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${token}`)
        .send({
          ventaId: id,
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: totalFinal }],
        });
      expect([200, 201]).toContain(pago.status);

      const filas: { pago_id: string }[] = await ds.query(
        `SELECT pago_id FROM pagos WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [id],
      );
      expect(filas).toHaveLength(1);
      return filas[0].pago_id;
    }

    /** Ids de los pagos de ESTA suite que devuelve el listado con esos filtros. */
    async function idsListados(
      filtros: Record<string, string>,
    ): Promise<string[]> {
      const res = await request(app.getHttpServer())
        .get('/api/pagos')
        .query({ ...filtros, cajaId: caja!.id, pageSize: '100' })
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      return (res.body as { data: { id: string }[] }).data
        .map((p) => p.id)
        .filter((id) => id === pagoA || id === pagoB);
    }

    beforeAll(async () => {
      // Item de servicio propio: sin stock, no depende de lo que otra suite
      // agotó.
      const item = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `E2E Día Negocio Filtro ${Date.now()}`,
          precioBase: '5000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'servicio',
        });
      expect(item.status).toBe(201);
      itemId = (item.body as { id: string }).id;

      caja = await abrirCaja(app, token);
      // Uno por vez: si la segunda venta falla, el primer pago ya está
      // identificado y el `afterAll` le devuelve la hora.
      pagoA = await venderEnEfectivo();
      pagoB = await venderEnEfectivo();

      // A = domingo 01:30 (del sábado con corte 5); B = domingo 05:30 (del
      // domingo). Fin de semana SIN cambio de horario, a propósito: ese caso
      // ya lo cubre `rango-fecha.util.spec.ts` → `diaNegocioEnZona`.
      await moverAHoraLocal(pagoA, '2026-09-13 01:30:00');
      await moverAHoraLocal(pagoB, '2026-09-13 05:30:00');
    });

    afterAll(async () => {
      try {
        // La hora movida vuelve a "ahora": ningún reporte posterior ve un
        // pago fijado en septiembre de 2026 en una caja que se abrió hoy.
        await ds.query(
          `UPDATE pagos SET fecha = NOW() WHERE pago_id = ANY($1)`,
          [[pagoA, pagoB].filter(Boolean)],
        );
        if (caja) await cerrarCaja(app, token, caja);
        if (itemId) {
          await request(app.getHttpServer())
            .delete(`/api/items/${itemId}`)
            .set('Authorization', `Bearer ${token}`);
        }
      } finally {
        // El corte queda en 0 para no heredarlo a un test posterior de esta
        // misma suite (ver el `afterAll` de arriba, que hace lo mismo al
        // final de TODA la suite; acá es entre bloques `describe`).
        await fijarCorte(0);
      }
    });

    it('corte 5: el 12 trae A (sábado del negocio) y no B', async () => {
      await fijarCorte(5);
      const ids = await idsListados({
        fechaDesde: '2026-09-12',
        fechaHasta: '2026-09-12',
      });
      expect(ids).toContain(pagoA);
      expect(ids).not.toContain(pagoB);
    });

    it('corte 5: el 13 trae B (domingo del negocio) y no A', async () => {
      await fijarCorte(5);
      const ids = await idsListados({
        fechaDesde: '2026-09-13',
        fechaHasta: '2026-09-13',
      });
      expect(ids).toContain(pagoB);
      expect(ids).not.toContain(pagoA);
    });

    it('control, corte 0: el 13 trae los dos (mismo día de calendario) y el 12 ninguno', async () => {
      await fijarCorte(0);
      const idsDel13 = await idsListados({
        fechaDesde: '2026-09-13',
        fechaHasta: '2026-09-13',
      });
      expect(idsDel13).toEqual(expect.arrayContaining([pagoA, pagoB]));

      const idsDel12 = await idsListados({
        fechaDesde: '2026-09-12',
        fechaHasta: '2026-09-12',
      });
      expect(idsDel12).not.toContain(pagoA);
      expect(idsDel12).not.toContain(pagoB);
    });

    it('con corte 5, un timestamp explícito no se ensancha al corte: trae A y B', async () => {
      // Domingo 01:00 local = 04:00Z. Si el corte se le aplicara igual que a
      // una fecha pura, A (domingo 01:30 local) quedaría afuera por caer
      // "antes" del corte de las 05:00 — pero un timestamp pidió ESE
      // instante, no el día del negocio.
      await fijarCorte(5);
      const ids = await idsListados({ fechaDesde: '2026-09-13T04:00:00Z' });
      expect(ids).toContain(pagoA);
      expect(ids).toContain(pagoB);
    });
  });

  /**
   * Task 3: el "hoy" de `GET /pagos/resumen` y de `cobrado.hoy` del
   * dashboard (`GET /resumen-negocio/hoy`) cortan en el día del NEGOCIO
   * (zona + `hora_corte`), no a medianoche calendario. Molde de
   * `pagos-dia-local.e2e-spec.ts`: deltas contra una lectura previa, para no
   * depender de qué haya dejado otra suite.
   *
   * `cobrado.hoy` del dashboard lee `p.creado_el` (`resumen-negocio.service.ts`
   * → `condHoyPago`), no `p.fecha` como `/pagos/resumen` — así que el helper
   * mueve las dos columnas.
   */
  describe('"hoy" del dashboard y de pagos', () => {
    let itemId: string;
    let caja: CajaAbierta | undefined;
    let pagoAntes: string;
    let pagoDespues: string;

    /** El borde (inicio) del día del negocio de HOY, con `horaCorte`. */
    async function bordeDelDia(horaCorte: number): Promise<Date> {
      const [{ borde }]: { borde: Date }[] = await ds.query(
        `SELECT (
            ((NOW() AT TIME ZONE pr.zona_horaria) - make_interval(hours => $2::int))::date::timestamp
            + make_interval(hours => $2::int)
          ) AT TIME ZONE pr.zona_horaria AS borde
           FROM tenants t
           JOIN provincia pr ON pr.provincia_id = t.provincia_id
          WHERE t.tenant_id = $1`,
        [PARIS_TENANT_ID, horaCorte],
      );
      return borde;
    }

    async function moverARelativoAlBorde(
      pagoId: string,
      minutos: number,
      horaCorte: number,
    ): Promise<void> {
      const borde = await bordeDelDia(horaCorte);
      const nuevaFecha = new Date(borde.getTime() + minutos * 60_000);
      await ds.query(
        `UPDATE pagos SET fecha = $2, creado_el = $2 WHERE pago_id = $1`,
        [pagoId, nuevaFecha],
      );
    }

    async function venderEnEfectivo(): Promise<string> {
      const venta = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${token}`)
        .send({
          tipoDocumentoId: BOLETA_ID,
          lineas: [{ itemId, cantidad: '1' }],
        });
      expect(venta.status).toBe(201);
      const { id, totalFinal } = venta.body as {
        id: string;
        totalFinal: string;
      };

      const pago = await request(app.getHttpServer())
        .post('/api/pagos')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${token}`)
        .send({
          ventaId: id,
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: totalFinal }],
        });
      expect([200, 201]).toContain(pago.status);

      const filas: { pago_id: string }[] = await ds.query(
        `SELECT pago_id FROM pagos WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [id],
      );
      expect(filas).toHaveLength(1);
      return filas[0].pago_id;
    }

    async function resumenPagos(): Promise<{
      pagosHoy: number;
      montoHoy: string;
    }> {
      const res = await request(app.getHttpServer())
        .get('/api/pagos/resumen')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      return res.body as { pagosHoy: number; montoHoy: string };
    }

    async function cobradoHoyDashboard(): Promise<string> {
      const res = await request(app.getHttpServer())
        .get('/api/resumen-negocio/hoy')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      return (res.body as { ventas: { cobrado: { hoy: string } } }).ventas
        .cobrado.hoy;
    }

    beforeAll(async () => {
      // Servicio propio: sin stock, no depende de lo que otra suite agotó.
      const item = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `E2E Día Negocio Resumen ${Date.now()}`,
          precioBase: '5000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'servicio',
        });
      expect(item.status).toBe(201);
      itemId = (item.body as { id: string }).id;

      caja = await abrirCaja(app, token);
      // Uno por vez: si el segundo falla, el primero ya está identificado y
      // el `afterAll` le devuelve la hora.
      pagoAntes = await venderEnEfectivo();
      pagoDespues = await venderEnEfectivo();

      // Línea de base: los dos MUY lejos de cualquier "hoy".
      await ds.query(
        `UPDATE pagos SET fecha = '2000-01-01T12:00:00Z', creado_el = '2000-01-01T12:00:00Z'
          WHERE pago_id = ANY($1)`,
        [[pagoAntes, pagoDespues]],
      );
    });

    afterAll(async () => {
      try {
        await ds.query(
          `UPDATE pagos SET fecha = NOW(), creado_el = NOW() WHERE pago_id = ANY($1)`,
          [[pagoAntes, pagoDespues].filter(Boolean)],
        );
        if (caja) await cerrarCaja(app, token, caja);
        if (itemId) {
          await request(app.getHttpServer())
            .delete(`/api/items/${itemId}`)
            .set('Authorization', `Bearer ${token}`);
        }
      } finally {
        await fijarCorte(0);
      }
    });

    it('con corte 5, cuenta el pago de después del borde y no el de antes — en /pagos/resumen y en cobrado.hoy del dashboard', async () => {
      await fijarCorte(5);
      const antesResumen = await resumenPagos();
      const antesDashboard = await cobradoHoyDashboard();

      await moverARelativoAlBorde(pagoAntes, -30, 5);
      await moverARelativoAlBorde(pagoDespues, 30, 5);

      const despuesResumen = await resumenPagos();
      const despuesDashboard = await cobradoHoyDashboard();

      const [{ neto }]: { neto: string }[] = await ds.query(
        `SELECT (monto - vuelto)::text AS neto FROM pagos WHERE pago_id = $1`,
        [pagoDespues],
      );

      expect(despuesResumen.pagosHoy - antesResumen.pagosHoy).toBe(1);
      expect(
        new Decimal(despuesResumen.montoHoy)
          .minus(antesResumen.montoHoy)
          .toFixed(4),
      ).toBe(new Decimal(neto).toFixed(4));
      expect(
        new Decimal(despuesDashboard).minus(antesDashboard).toFixed(4),
      ).toBe(new Decimal(neto).toFixed(4));
    });
  });

  describe('GET /api/tenants/me', () => {
    afterAll(async () => {
      await fijarCorte(0);
    });

    it('diaNegocioHoy coincide con el día del negocio calculado en SQL', async () => {
      await fijarCorte(5);

      const [{ dia }]: { dia: string }[] = await ds.query(
        `SELECT to_char(
            ((NOW() AT TIME ZONE pr.zona_horaria) - make_interval(hours => t.hora_corte::int))::date,
            'YYYY-MM-DD'
          ) AS dia
           FROM tenants t
           JOIN provincia pr ON pr.provincia_id = t.provincia_id
          WHERE t.tenant_id = $1`,
        [PARIS_TENANT_ID],
      );

      const res = await request(app.getHttpServer())
        .get('/api/tenants/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect((res.body as { diaNegocioHoy: string }).diaNegocioHoy).toBe(dia);
    });
  });

  /**
   * Task 3: `tendencia()` de `GET /propinas/reportes/resumen` agrupa por el
   * día del NEGOCIO de `venta_propina.creado_el`, no por su fecha de
   * calendario. Ítem de SERVICIO propio: el producto demo `…116` que usa
   * `crearVentaConPropina` en `liquidacion-propinas.e2e-spec.ts:123` (el
   * molde de este helper) consume stock que otras suites también usan.
   */
  describe('serie de propinas: tendencia() por el día del negocio', () => {
    let itemId: string;
    let caja: CajaAbierta | undefined;
    let garzonId: string;
    let turnoId: string;
    let sesionGarzonId: string;
    let tipId: string;
    let montoTip: string;
    let antesDeMover: Array<{ fecha: string; conPropina: number }>;
    // Línea de base del `poolTotal` de la Task 4 (liquidación), una por
    // combinación fecha × corte que usan sus tests: el borde de un período
    // de un solo día es sensible al corte, así que una sola línea de base no
    // sirve para las dos —a diferencia de `tendenciaEntre`, cuya ventana
    // 12-14 es tan ancha que el corte no le mueve la inclusión, solo el
    // bucket—.
    let poolAntes12Corte5: string;
    let poolAntes13Corte5: string;
    let poolAntes12Corte0: string;
    let poolAntes13Corte0: string;

    /**
     * `propinaCierreMesa`, no `propinaDirecta`: esta última la atribuye
     * `ventas.service.ts` SIEMPRE al placeholder "Mostrador", con
     * `tipoGarzon: null` (ver `PropinaDirectaDto`) — y `computarReparto`
     * corta con 400 ("ningún participante puede recibirlas") si el pool del
     * período es > 0 y ningún grupo cubre ese `tipoGarzon`, que el
     * "Mostrador" nunca hace por diseño.
     *
     * `garzonId`, `sesionGarzonId`, `turnoId` y `tipoGarzon` van los CUATRO
     * juntos: `ventas.service.ts` exige que `sesionGarzonId`/`turnoId`/
     * `tipoGarzon` sean todos `null` o todos presentes ("Sesión, turno y
     * tipo de propina deben ir juntos o ser todos null" — medido: con solo
     * `garzonId` + `tipoGarzon` explícitos, esa guarda corta con 400 antes
     * de llegar a la de arriba). Por eso el `beforeAll` abre una sesión de
     * trabajo real para el garzón propio de este describe, en vez de solo
     * crearlo.
     *
     * Con la sesión y el tipo puestos, el propio tip vuelve al garzón
     * receptor elegible del grupo "Garzones" (los receptores de un grupo son
     * los garzones que APARECEN en tips/sesiones de ese tipo, no un roster
     * fijo).
     */
    async function crearVentaConPropina(monto: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50000.0000' }],
          propinaCierreMesa: {
            garzonId,
            sesionGarzonId,
            turnoId,
            tipoGarzon: 'garzon',
            montoPagado: monto,
            porcentajeSugerido: '0.10',
          },
        })
        .expect(201);
      return (res.body as { id: string }).id;
    }

    async function tendenciaEntre(
      desde: string,
      hasta: string,
    ): Promise<Array<{ fecha: string; conPropina: number }>> {
      const res = await request(app.getHttpServer())
        .get('/api/propinas/reportes/resumen')
        .query({ desde, hasta })
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      return (
        res.body as { tendencia: Array<{ fecha: string; conPropina: number }> }
      ).tendencia;
    }

    function filaDe(
      lista: Array<{ fecha: string; conPropina: number }>,
      fecha: string,
    ): number {
      return lista.find((f) => f.fecha === fecha)?.conPropina ?? 0;
    }

    /** `poolTotal` del preview de liquidación para ese período. */
    async function previewPool(
      fechaDesde: string,
      fechaHasta: string,
    ): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/api/propinas/liquidaciones/preview')
        .set('Authorization', `Bearer ${token}`)
        .send({ fechaDesde, fechaHasta });
      expect(res.status).toBe(201);
      return (res.body as { poolTotal: string }).poolTotal;
    }

    beforeAll(async () => {
      const item = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `E2E Día Negocio Propina ${Date.now()}`,
          precioBase: '5000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'servicio',
        });
      expect(item.status).toBe(201);
      itemId = (item.body as { id: string }).id;

      // Garzón propio: no reusar uno del seed compartido por otras suites
      // (ver `docs/agent/...` — la sesión/atribución de un garzón del seed
      // se pisa entre specs).
      const garzon = await request(app.getHttpServer())
        .post('/api/garzones')
        .set('Authorization', `Bearer ${token}`)
        .send({ nombre: `E2E Día Negocio Garzón ${Date.now()}` });
      expect(garzon.status).toBe(201);
      garzonId = (garzon.body as { id: string }).id;
      const pin = (garzon.body as { pin: string }).pin;

      // Un turno cualquiera del tenant sembrado, no uno propio: mismo molde
      // que `sembrarSesionCerrada` en liquidacion-propinas.e2e-spec.ts.
      const [{ turno_id }]: { turno_id: string }[] = await ds.query(
        `SELECT turno_id FROM turnos
          WHERE tenant_id = $1 AND eliminado_el IS NULL
          LIMIT 1`,
        [PARIS_TENANT_ID],
      );
      turnoId = turno_id;

      const sesion = await request(app.getHttpServer())
        .post('/api/sesiones-garzon/iniciar')
        .set('Authorization', `Bearer ${token}`)
        .send({ turnoId, garzonId, pin });
      expect(sesion.status).toBe(201);
      sesionGarzonId = (sesion.body as { id: string }).id;

      caja = await abrirCaja(app, token);
      const ventaId = await crearVentaConPropina('700');
      const [{ venta_propina_id, monto_pagado }]: {
        venta_propina_id: string;
        monto_pagado: string;
      }[] = await ds.query(
        `SELECT venta_propina_id, monto_pagado FROM venta_propina
            WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [ventaId],
      );
      tipId = venta_propina_id;
      montoTip = monto_pagado;

      // Con el corte en 0 (el default entre bloques de esta suite), "ahora"
      // no cae en la ventana 12-14 de septiembre de 2026: la línea de base
      // es cero en las dos filas.
      antesDeMover = await tendenciaEntre('2026-09-12', '2026-09-14');

      // Línea de base del pool de liquidación, ANTES de mover el tip y con
      // los dos cortes que usan los tests de Task 4 — tiene que capturarse
      // acá, antes del UPDATE de abajo, porque un `it` ya no puede volver a
      // un "antes".
      await fijarCorte(5);
      poolAntes12Corte5 = await previewPool('2026-09-12', '2026-09-12');
      poolAntes13Corte5 = await previewPool('2026-09-13', '2026-09-13');
      await fijarCorte(0);
      poolAntes12Corte0 = await previewPool('2026-09-12', '2026-09-12');
      poolAntes13Corte0 = await previewPool('2026-09-13', '2026-09-13');

      await ds.query(
        `UPDATE venta_propina p
            SET creado_el = ($2::timestamp AT TIME ZONE pr.zona_horaria)
           FROM tenants t
           JOIN provincia pr ON pr.provincia_id = t.provincia_id
          WHERE p.venta_propina_id = $1 AND t.tenant_id = p.tenant_id`,
        [tipId, '2026-09-13 01:30:00'],
      );
    });

    /**
     * Este cierre deja estado COMPARTIDO en el tenant Paris (garzón + su
     * sesión) si algo falla a mitad de camino: sin garantía de que cada paso
     * corra, un garzón vivo con sesión abierta queda para la próxima suite
     * que use `sesiones-garzon` en Paris. Por eso cada paso va en su propio
     * `try/catch` — uno que revienta no aborta los siguientes — y los
     * errores se juntan para un solo `throw` al final, que sí hace fallar el
     * test aunque cada paso haya corrido. Medido 2026-09-19: antes, un
     * `expect` fallido a mitad del `afterAll` original cortaba en seco y
     * dejaba sin ejecutar el borrado del garzón y el cierre de su sesión.
     */
    afterAll(async () => {
      const errores: string[] = [];

      async function paso(nombre: string, fn: () => Promise<void>) {
        try {
          await fn();
        } catch (e) {
          errores.push(
            `${nombre}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }

      await paso('borrar la propina de prueba', async () => {
        if (tipId) {
          await ds.query(
            `UPDATE venta_propina SET eliminado_el = NOW()
              WHERE venta_propina_id = $1`,
            [tipId],
          );
        }
      });

      await paso('cerrar la caja', async () => {
        if (caja) await cerrarCaja(app, token, caja);
      });

      await paso('borrar el ítem', async () => {
        if (itemId) {
          const res = await request(app.getHttpServer())
            .delete(`/api/items/${itemId}`)
            .set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(200);
        }
      });

      await paso('cerrar la sesión del garzón', async () => {
        if (sesionGarzonId) {
          const res = await request(app.getHttpServer())
            .post(`/api/sesiones-garzon/${sesionGarzonId}/cerrar`)
            .set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(201);
        }
      });

      await paso('borrar el garzón', async () => {
        if (garzonId) {
          const res = await request(app.getHttpServer())
            .delete(`/api/garzones/${garzonId}`)
            .set('Authorization', `Bearer ${token}`);
          expect(res.status).toBe(200);
        }
      });

      // No basta con que las llamadas hayan devuelto 200/201: el estado
      // compartido que le importa a la próxima suite es el que queda en la
      // fila, así que se verifica con una consulta directa (mismo criterio
      // que el resto del archivo).
      await paso(
        'verificar que el garzón quedó borrado y su sesión cerrada',
        async () => {
          if (garzonId) {
            const [fila]: { eliminado_el: Date | null }[] = await ds.query(
              `SELECT eliminado_el FROM garzones WHERE garzon_id = $1`,
              [garzonId],
            );
            expect(fila?.eliminado_el).not.toBeNull();
          }
          if (sesionGarzonId) {
            const [fila]: { estado: string }[] = await ds.query(
              `SELECT estado FROM sesiones_garzon WHERE sesion_garzon_id = $1`,
              [sesionGarzonId],
            );
            expect(fila?.estado).toBe('cerrada');
          }
        },
      );

      await paso('devolver el corte a 0', async () => {
        await fijarCorte(0);
      });

      if (errores.length) {
        throw new Error(
          `afterAll dejó pasos sin verificar:\n${errores.join('\n')}`,
        );
      }
    });

    it('con corte 5, domingo 01:30 local cae en la fila del sábado 12 (antes del corte)', async () => {
      await fijarCorte(5);
      const despues = await tendenciaEntre('2026-09-12', '2026-09-14');

      expect(
        filaDe(despues, '2026-09-12') - filaDe(antesDeMover, '2026-09-12'),
      ).toBe(1);
      expect(
        filaDe(despues, '2026-09-13') - filaDe(antesDeMover, '2026-09-13'),
      ).toBe(0);
    });

    it('con corte 0, la misma hora local cae en la fila del domingo 13 (su calendario)', async () => {
      await fijarCorte(0);
      const despues = await tendenciaEntre('2026-09-12', '2026-09-14');

      expect(
        filaDe(despues, '2026-09-13') - filaDe(antesDeMover, '2026-09-13'),
      ).toBe(1);
      expect(
        filaDe(despues, '2026-09-12') - filaDe(antesDeMover, '2026-09-12'),
      ).toBe(0);
    });

    /**
     * Task 4: la liquidación de propinas (`POST .../liquidaciones/preview`)
     * usa el mismo período de negocio que `tendencia()` arriba — reusa el
     * mismo tip, ya movido al domingo 01:30 local con corte 5.
     */
    it('con corte 5, el preview del 12 incluye la propina en el pool y el del 13 no', async () => {
      await fijarCorte(5);
      const despues12 = await previewPool('2026-09-12', '2026-09-12');
      const despues13 = await previewPool('2026-09-13', '2026-09-13');

      expect(new Decimal(despues12).minus(poolAntes12Corte5).toFixed(4)).toBe(
        new Decimal(montoTip).toFixed(4),
      );
      expect(new Decimal(despues13).minus(poolAntes13Corte5).toFixed(4)).toBe(
        '0.0000',
      );
    });

    it('control, corte 0: el preview del 13 incluye la propina (su calendario) y el del 12 no', async () => {
      await fijarCorte(0);
      const despues12 = await previewPool('2026-09-12', '2026-09-12');
      const despues13 = await previewPool('2026-09-13', '2026-09-13');

      expect(new Decimal(despues13).minus(poolAntes13Corte0).toFixed(4)).toBe(
        new Decimal(montoTip).toFixed(4),
      );
      expect(new Decimal(despues12).minus(poolAntes12Corte0).toFixed(4)).toBe(
        '0.0000',
      );
    });

    it('2026-09-13 → 2026-09-12 (orden invertido) da 400, incluso con fechas puras que requieren día del negocio', async () => {
      await fijarCorte(5);
      const res = await request(app.getHttpServer())
        .post('/api/propinas/liquidaciones/preview')
        .set('Authorization', `Bearer ${token}`)
        .send({ fechaDesde: '2026-09-13', fechaHasta: '2026-09-12' });

      expect(res.status).toBe(400);
    });
  });
});
