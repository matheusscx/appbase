import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
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
 * 2026-09-18-hora-de-corte-dia-negocio-design.md); por ahora solo cubre la
 * Tarea 1 — el dato y su configuración vía `PATCH /tenants/me`.
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
});
