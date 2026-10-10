import { randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { CobrosService } from '../src/modules/pasarela/services/cobros.service';
import { InscripcionesService } from '../src/modules/pasarela/services/inscripciones.service';
import { TenantPasarelaService } from '../src/modules/pasarela/services/tenant-pasarela.service';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };
const PLAN_MENSUAL_DEMO = '550e8400-e29b-41d4-a716-446655440352'; // seedSuscripcionDemo

/**
 * Medición, no arreglo: dos `POST /suscripciones` iguales cobran dos veces.
 *
 * La escena es la de ADR-026: el alta entra, la respuesta se corta, el cliente
 * ve "No se pudo activar la suscripción" y vuelve a confirmar. `crear` cobra por
 * Oneclick (paso 7, por HTTP y fuera de toda transacción) y recién después crea
 * la venta y la suscripción, sin reclamar ninguna clave y sin una restricción
 * única que frene la segunda. Los dos POST llevan además la **misma**
 * `Idempotency-Key`, para fijar que hoy el endpoint la ignora: no alcanza con
 * que la pantalla la mande.
 *
 * No hay mock de Oneclick en `backend/test/` (`pasarela-oneclick.e2e-spec.ts` va
 * contra Transbank detrás de `RUN_TRANSBANK_E2E`), así que se sobrescriben los
 * tres servicios de la pasarela que `crear` toca. `cobrar` cuenta llamadas.
 * Venta y suscripción son reales.
 *
 * ⚠️ El segundo `it` afirma **el bug** con los números de hoy, y no es un
 * `it.failing` a propósito: `it.failing` pasa con cualquier excepción, y el
 * control solo cubre el primer POST. Si el segundo empezara a dar 500, o el alta
 * se arreglara a medias (un cobro pero dos suscripciones), seguiría verde. Este
 * se pone rojo con cualquier cambio; cuando se arregle, se invierte la
 * afirmación. El arreglo ya está decidido (owner, 2026-10-09: como ADR-029):
 * `docs/agent/pendientes.md` § 3.
 */
describe('Suscripciones: dos altas iguales (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let usuarioId: string;

  const cobros: { monto: string; inscripcionId: string }[] = [];
  const cobrosFalso = {
    cobrar: (
      _tenantId: string,
      dto: { monto: string; inscripcionId: string },
    ) => {
      // El monto llega con la escala de la columna (`35700.000000`): se
      // normaliza para comparar el valor y no el formato.
      cobros.push({
        monto: new Decimal(dto.monto).toString(),
        inscripcionId: dto.inscripcionId,
      });
      return Promise.resolve({ ordenId: randomUUID(), estado: 'pagada' });
    },
    vincularVenta: () => Promise.resolve({}),
  };

  const alta = (inscripcionId: string, clave: string) =>
    request(app.getHttpServer())
      .post('/api/suscripciones')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', clave)
      .send({ itemId: PLAN_MENSUAL_DEMO, diaMes: 5, inscripcionId });

  const suscripcionesDelPlan = async (): Promise<number> => {
    const [fila] = await ds.query<{ n: string }[]>(
      `SELECT count(*)::text AS n FROM suscripciones
       WHERE tenant_id = $1 AND usuario_id = $2 AND item_id = $3
         AND eliminado_el IS NULL`,
      [TENANT_ID, usuarioId, PLAN_MENSUAL_DEMO],
    );
    return Number(fila.n);
  };

  const ventasExistentes = async (ids: string[]): Promise<number> => {
    const [fila] = await ds.query<{ n: string }[]>(
      `SELECT count(*)::text AS n FROM ventas
       WHERE venta_id = ANY($1::uuid[]) AND eliminado_el IS NULL`,
      [ids],
    );
    return Number(fila.n);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CobrosService)
      .useValue(cobrosFalso)
      .overrideProvider(InscripcionesService)
      .useValue({
        resolverMedioDeUsuario: () =>
          Promise.resolve({ marca: 'Visa', ultimos4: '6623' }),
      })
      .overrideProvider(TenantPasarelaService)
      .useValue({ resolverConfiguracionActiva: () => Promise.resolve({}) })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send(ADMIN);
    expect(resLogin.status).toBe(200);
    const resTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set(
        'Cookie',
        (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
      )
      .set(
        'Authorization',
        `Bearer ${(resLogin.body as { access_token: string }).access_token}`,
      )
      .send({ tenantId: TENANT_ID });
    expect(resTenant.status).toBe(200);
    token = (resTenant.body as { access_token: string }).access_token;

    const [usuario] = await ds.query<{ usuario_id: string }[]>(
      `SELECT usuario_id FROM usuarios WHERE correo = $1 AND eliminado_el IS NULL`,
      [ADMIN.email],
    );
    usuarioId = usuario.usuario_id;
  });

  beforeEach(() => {
    cobros.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it('control: un alta cobra una vez y deja una venta y una suscripción', async () => {
    const antes = await suscripcionesDelPlan();

    const res = await alta(randomUUID(), randomUUID());

    expect(res.status).toBe(201);
    expect(cobros).toHaveLength(1);
    // 30.000 neto + IVA 19% (el ítem del seed no incluye impuesto).
    expect(cobros[0].monto).toBe('35700');
    expect(await suscripcionesDelPlan()).toBe(antes + 1);
    const { ventaInicialId } = res.body as { ventaInicialId: string };
    expect(await ventasExistentes([ventaInicialId])).toBe(1);
  });

  it('HOY (bug): el mismo alta dos veces cobra dos veces, con dos ventas y dos suscripciones', async () => {
    const antes = await suscripcionesDelPlan();
    const inscripcionId = randomUUID();
    const clave = randomUUID();

    const primera = await alta(inscripcionId, clave);
    const segunda = await alta(inscripcionId, clave);

    expect(primera.status).toBe(201);
    expect(segunda.status).toBe(201);
    expect(cobros).toEqual([
      { monto: '35700', inscripcionId },
      { monto: '35700', inscripcionId },
    ]);
    expect(await suscripcionesDelPlan()).toBe(antes + 2);
    const ventas = [primera, segunda].map(
      (r) => (r.body as { ventaInicialId: string }).ventaInicialId,
    );
    expect(new Set(ventas).size).toBe(2);
    expect(await ventasExistentes(ventas)).toBe(2);
    // Y nada en la segunda respuesta avisa que ya existía una igual.
    expect(segunda.body).not.toHaveProperty('repetida');
  });
});
