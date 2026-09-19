import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { AppModule } from '../src/app.module';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';
import { randomUUID } from 'node:crypto';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const BOLETA_ID = '550e8400-e29b-41d4-a716-446655440145';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface Resumen {
  pagosHoy: number;
  montoHoy: string;
}

/**
 * En pagos, "el día" es el día LOCAL del tenant: el "Hoy" de
 * `GET /pagos/resumen` y la fecha pura de `fechaDesde`/`fechaHasta` en
 * `GET /pagos`.
 *
 * Los bugs que fija: el resumen comparaba `p.fecha::date = CURRENT_DATE` y el
 * listado `p.fecha >= $n` con la fecha pura cruda. Los dos resuelven el día en
 * la zona de la SESIÓN de Postgres —UTC, nadie la fija—: en Chile el día
 * cortaba a las 21:00 (20:00 en invierno), y `fechaHasta` dejaba afuera el día
 * elegido entero. El contrato del listado es el de los demás filtros de fecha
 * (`filtros-fecha-zona.e2e-spec.ts`): fecha pura = medianoche local, `hasta`
 * inclusivo del día, timestamp respetado tal cual.
 *
 * Los dos pagos se crean por la API; el SQL solo les mueve la hora, que es lo
 * único que un test no puede esperar. Las dos horas quedan a 30 minutos de la
 * medianoche local, una de cada lado, y se calculan en Postgres con la zona de
 * la provincia del tenant — así el test discrimina a cualquier hora en que
 * corra: antes de las 21:00 locales el resumen viejo cuenta los dos, después no
 * cuenta ninguno; y el listado viejo mete el de ayer y saca el de hoy a
 * cualquier hora, porque la fecha que se le pasa es la local.
 *
 * Vale también el día del salto de septiembre, cuando la medianoche local no
 * existe: medido el 2026-09-18 sobre el 2026-09-06, los ±30 minutos de
 * `moverAMedianocheLocal` caen uno a cada lado del borde que arma el service.
 * En abril la hora que se repite es la de 23:00 a 23:59 del sábado, no la
 * medianoche, así que el borde del service nunca cae en ella.
 */
describe('Pagos: el día es el día local del tenant (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let itemId: string;
  let caja: CajaAbierta | undefined;
  const pagoIds: string[] = [];

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
    const { id, totalFinal } = venta.body as { id: string; totalFinal: string };

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

  async function resumen(): Promise<Resumen> {
    const res = await request(app.getHttpServer())
      .get('/api/pagos/resumen')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as Resumen;
  }

  /** Mueve el pago a `minutos` de la medianoche local de hoy (negativo = ayer). */
  async function moverAMedianocheLocal(
    pagoId: string,
    minutos: number,
  ): Promise<void> {
    await ds.query(
      `UPDATE pagos p
          SET fecha = ((NOW() AT TIME ZONE pr.zona_horaria)::date::timestamp
                       + make_interval(mins => $2)) AT TIME ZONE pr.zona_horaria
         FROM tenants t
         JOIN provincia pr ON pr.provincia_id = t.provincia_id
        WHERE p.pago_id = $1
          AND t.tenant_id = p.tenant_id`,
      [pagoId, minutos],
    );
  }

  /** Deja un pago a las 00:30 locales de hoy y el otro a las 23:30 de ayer. */
  async function ubicarAlrededorDeMedianoche(): Promise<void> {
    const [deHoy, deAyer] = pagoIds;
    await moverAMedianocheLocal(deHoy, 30);
    await moverAMedianocheLocal(deAyer, -30);
  }

  /** `YYYY-MM-DD` de hoy en la zona de la provincia del tenant. */
  async function hoyLocal(): Promise<string> {
    const [{ hoy }]: { hoy: string }[] = await ds.query(
      `SELECT to_char((NOW() AT TIME ZONE pr.zona_horaria)::date, 'YYYY-MM-DD') AS hoy
         FROM tenants t
         JOIN provincia pr ON pr.provincia_id = t.provincia_id
        WHERE t.tenant_id = $1`,
      [PARIS_TENANT_ID],
    );
    return hoy;
  }

  async function instanteDe(pagoId: string): Promise<Date> {
    const [{ fecha }]: { fecha: Date }[] = await ds.query(
      `SELECT fecha FROM pagos WHERE pago_id = $1`,
      [pagoId],
    );
    return fecha;
  }

  /** Ids de los pagos de ESTA suite que devuelve el listado con esos filtros. */
  async function listados(filtros: Record<string, string>): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .get('/api/pagos')
      .query({ ...filtros, cajaId: caja!.id, pageSize: '100' })
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as { data: { id: string }[] }).data
      .map((p) => p.id)
      .filter((id) => pagoIds.includes(id));
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

    // Servicio propio: sin stock, no depende de lo que otra suite agotó.
    const item = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `E2E Pagos Hoy ${Date.now()}`,
        precioBase: '5000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
      });
    expect(item.status).toBe(201);
    itemId = (item.body as { id: string }).id;

    caja = await abrirCaja(app, token);
    // Uno por vez: si la segunda venta falla, el primer pago ya está en
    // `pagoIds` y el `afterAll` le devuelve la hora.
    pagoIds.push(await venderEnEfectivo());
    pagoIds.push(await venderEnEfectivo());
  });

  afterAll(async () => {
    try {
      // La hora movida vuelve a "ahora": ningún reporte posterior ve un pago
      // de ayer en una caja que se abrió hoy.
      if (pagoIds.length > 0) {
        await ds.query(
          `UPDATE pagos SET fecha = NOW() WHERE pago_id = ANY($1)`,
          [pagoIds],
        );
      }
      if (caja) await cerrarCaja(app, token, caja);
      if (itemId) {
        await request(app.getHttpServer())
          .delete(`/api/items/${itemId}`)
          .set('Authorization', `Bearer ${token}`);
      }
    } finally {
      await app.close();
    }
  });

  it('cuenta el pago de las 00:30 locales y deja afuera el de las 23:30 de ayer', async () => {
    const [deHoy, deAyer] = pagoIds;

    // Línea de base: los dos fuera de cualquier "hoy".
    await ds.query(
      `UPDATE pagos SET fecha = '2000-01-01T12:00:00Z' WHERE pago_id = ANY($1)`,
      [pagoIds],
    );
    const antes = await resumen();

    await moverAMedianocheLocal(deHoy, 30);
    await moverAMedianocheLocal(deAyer, -30);
    const despues = await resumen();

    const [{ neto }]: { neto: string }[] = await ds.query(
      `SELECT (monto - vuelto)::text AS neto FROM pagos WHERE pago_id = $1`,
      [deHoy],
    );

    expect(despues.pagosHoy - antes.pagosHoy).toBe(1);
    expect(new Decimal(despues.montoHoy).minus(antes.montoHoy).toFixed(4)).toBe(
      new Decimal(neto).toFixed(4),
    );
  });

  describe('el listado filtra por el día local', () => {
    it('`fechaDesde` en fecha pura arranca a la medianoche local, no a la de UTC', async () => {
      await ubicarAlrededorDeMedianoche();
      const [deHoy, deAyer] = pagoIds;

      const ids = await listados({ fechaDesde: await hoyLocal() });

      expect(ids).toContain(deHoy);
      expect(ids).not.toContain(deAyer);
    });

    it('`fechaHasta` en fecha pura incluye el día elegido completo', async () => {
      await ubicarAlrededorDeMedianoche();
      const [deHoy, deAyer] = pagoIds;

      const ids = await listados({ fechaHasta: await hoyLocal() });

      expect(ids).toContain(deHoy);
      expect(ids).toContain(deAyer);
    });

    it('un timestamp en `fechaDesde` corta en el instante, sin ensancharse a la medianoche', async () => {
      await ubicarAlrededorDeMedianoche();
      const [deHoy] = pagoIds;
      const unSegundoDespues = new Date(
        (await instanteDe(deHoy)).getTime() + 1000,
      ).toISOString();

      const ids = await listados({ fechaDesde: unSegundoDespues });

      expect(ids).not.toContain(deHoy);
    });

    it('un timestamp en `fechaHasta` corta en el instante, no al final del día', async () => {
      await ubicarAlrededorDeMedianoche();
      const [deHoy, deAyer] = pagoIds;
      const unSegundoAntes = new Date(
        (await instanteDe(deHoy)).getTime() - 1000,
      ).toISOString();

      const ids = await listados({ fechaHasta: unSegundoAntes });

      expect(ids).not.toContain(deHoy);
      expect(ids).toContain(deAyer);
    });
  });
});
