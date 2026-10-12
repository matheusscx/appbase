import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';

/**
 * El porcentaje de un impuesto va de 0 (excluido) a 1 (incluido): 0.19 = 19%,
 * y un impuesto no puede superar el 100%. Decisión del owner (2026-10-12, por
 * AskUserQuestion de la orquestadora, con la escena y el costo de cada opción):
 * "Tope en 100%". Frena el tipeo de 19 por 0.19, que guardaba un 1900%.
 *
 * Medido el 2026-10-12 antes del tope, por POST y por PATCH: 1.0001, 1.5 y 10
 * daban 201/200 y quedaban guardados; 10^4 —que no cabe en
 * `impuestos.porcentaje`, `NUMERIC(7,4)`— daba 500. Ahora los cuatro son 400.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const MENSAJE_TOPE = 'El porcentaje no puede superar 1 (100%)';
const MENSAJE_POSITIVO = 'porcentaje debe ser mayor a cero';

interface TokenResponse {
  access_token: string;
}
interface ConId {
  id: string;
}
type Respuesta = { status: number; body: unknown };

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_PARIS.email, password: ADMIN_PARIS.pass });
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

function mensaje(res: Respuesta): string {
  const m = (res.body as { message?: string | string[] }).message ?? '';
  return [m].flat().join(' ');
}

/** Lo que no entra, con el mensaje que tiene que ver quien lo tipeó. */
const RECHAZADOS: [string, string][] = [
  ['1.0001', MENSAJE_TOPE],
  ['1.5', MENSAJE_TOPE],
  ['10', MENSAJE_TOPE],
  ['19', MENSAJE_TOPE],
  // 10^4: no cabe en `NUMERIC(7,4)`. Era el 500.
  ['10000', MENSAJE_TOPE],
  ['0', MENSAJE_POSITIVO],
  ['-0.1', MENSAJE_POSITIVO],
];

describe('El porcentaje de un impuesto tiene tope en 1 = 100% (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;

  const crear = (porcentaje: string): Promise<Respuesta> =>
    request(app.getHttpServer())
      .post('/api/impuestos')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `Tope E2E ${randomUUID()}`, porcentaje });

  const editar = (id: string, porcentaje: string): Promise<Respuesta> =>
    request(app.getHttpServer())
      .patch(`/api/impuestos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ porcentaje });

  async function porcentajeGuardado(id: string): Promise<string> {
    const filas: { porcentaje: string }[] = await ds.query(
      `SELECT porcentaje FROM impuestos
        WHERE impuesto_id = $1 AND eliminado_el IS NULL`,
      [id],
    );
    return filas[0].porcentaje;
  }

  async function contarTope(): Promise<number> {
    // Sin `eliminado_el IS NULL` a propósito: lo que se cuenta es si el pedido
    // escribió algo, y una fila borrada también sería una escritura.
    const filas: { n: string }[] = await ds.query(
      `SELECT COUNT(*) AS n FROM impuestos
        WHERE tenant_id = $1 AND nombre LIKE 'Tope E2E %'`,
      [PARIS_TENANT_ID],
    );
    return Number(filas[0].n);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);
    token = await login(app);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('POST /impuestos', () => {
    it('1 —el 100%, el borde— entra', async () => {
      const res = await crear('1');
      expect(res.status).toBe(201);
      expect(await porcentajeGuardado((res.body as ConId).id)).toBe('1.0000');
    });

    it.each(RECHAZADOS)('%s es 400 y no guarda nada', async (pct, esperado) => {
      const antes = await contarTope();
      const res = await crear(pct);
      expect({ pct, status: res.status }).toEqual({ pct, status: 400 });
      expect(mensaje(res)).toContain(esperado);
      expect(await contarTope()).toBe(antes);
    });
  });

  describe('PATCH /impuestos/:id', () => {
    let id: string;

    beforeAll(async () => {
      const res = await crear('0.05');
      expect(res.status).toBe(201);
      id = (res.body as ConId).id;
    });

    it('1 —el 100%, el borde— entra', async () => {
      const res = await editar(id, '1');
      expect(res.status).toBe(200);
      expect(await porcentajeGuardado(id)).toBe('1.0000');
      const vuelta = await editar(id, '0.05');
      expect(vuelta.status).toBe(200);
    });

    it.each(RECHAZADOS)(
      '%s es 400 y deja el porcentaje que tenía',
      async (pct, esperado) => {
        const res = await editar(id, pct);
        expect({ pct, status: res.status }).toEqual({ pct, status: 400 });
        expect(mensaje(res)).toContain(esperado);
        expect(await porcentajeGuardado(id)).toBe('0.0500');
      },
    );
  });
});
