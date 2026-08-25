import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import Decimal from 'decimal.js';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * `montoTolerancia` —la tolerancia de descuadre del arqueo— es el ÚNICO monto del
 * sistema sobre una columna `NUMERIC(18,6)`: todo el resto del libro de plata es
 * `(18,4)`. Y hasta acá su ruta no tenía ni un e2e.
 *
 * Lo que faltaba cubrir no es el formato —de eso se ocupa `@IsNumberString`, con
 * unit propio en `update-preferencias-financieras.dto.spec.ts`— sino las dos cosas
 * que solo existen en el borde HTTP:
 *
 *   1. `EscalaMonedaPipe` corre como `@Body(EscalaMonedaPipe)` en el controller.
 *      Un test de DTO con `plainToInstance` + `validate()` NO lo ejecuta: mandarle
 *      `'1.5'` a `validate()` pasa en verde sin haber probado nada del pipe.
 *   2. La regla **valor-vs-cadena**: el pipe mide el VALOR con Decimal, no la
 *      cadena, así que `'1000.00'` en CLP vale 1000 y entra. Estaba fijada solo a
 *      nivel unit, y es justo la que evita que el 400 castigue un formato en vez
 *      de un número.
 *
 * El spec RESTAURA las preferencias que encontró: la suite corre en serie
 * (`maxWorkers: 1`) pero comparte el tenant con otros specs, y dejar a Paris con
 * otra fórmula o con otro modo de redondeo rompería specs lejanas.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}

interface Preferencias {
  calculoDescuentos: string;
  calculoRecargos: string;
  formula: string[];
  escalaCalculo: number;
  modoRedondeo: string;
  nivelRedondeo: string;
  montoTolerancia: string;
}

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

describe('montoTolerancia (e2e) — el único monto sobre NUMERIC(18,6)', () => {
  let app: INestApplication<App>;
  let token: string;
  let originales: Preferencias;

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
    token = await login(app);

    const res = await request(app.getHttpServer())
      .get('/api/tenants/preferencias-financieras')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    originales = res.body as Preferencias;
  }, 60000);

  afterAll(async () => {
    // ⚠️ Esta limpieza es la más cara de las que fallan callado: restaura las
    // preferencias financieras del TENANT, que comparten todas las suites. Si
    // no vuelve a su valor, las que corran después calculan con la tolerancia
    // de este spec y fallan lejos de acá, sin nada que las apunte para acá.
    // Por eso el status se afirma; y se afirma DESPUÉS del `close`, que va en
    // un `finally`, porque afirmar antes deja la app viva con su `@Cron`
    // pegándole a la base. Ver `docs/agent/pendientes.md` § 1.
    let restauracion: number | string | null = null;
    try {
      if (originales) {
        restauracion = (
          await request(app.getHttpServer())
            .put('/api/tenants/preferencias-financieras')
            .set('Authorization', `Bearer ${token}`)
            .send(originales)
        ).status;
      }
    } catch (e) {
      restauracion = (e as Error).message;
    } finally {
      await app.close();
    }
    if (originales) expect(restauracion).toBe(200);
  });

  /** Cambia SOLO la tolerancia: el resto viaja tal como estaba. */
  const guardarTolerancia = (montoTolerancia: unknown) =>
    request(app.getHttpServer())
      .put('/api/tenants/preferencias-financieras')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...originales, montoTolerancia });

  const leer = async (): Promise<Preferencias> => {
    const res = await request(app.getHttpServer())
      .get('/api/tenants/preferencias-financieras')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as Preferencias;
  };

  it('una tolerancia entera se guarda y vuelve con el mismo valor', async () => {
    // El ancla positiva: sin ella los 400 de abajo pasarían igual con la ruta
    // rota para cualquier tolerancia.
    const res = await guardarTolerancia('1500');
    expect(res.status).toBe(200);

    const prefs = await leer();
    // Vuelve de una columna NUMERIC(18,6), así que el string trae los seis
    // decimales. Lo que tiene que coincidir es el VALOR, no el formato.
    expect(new Decimal(prefs.montoTolerancia).eq('1500')).toBe(true);
  });

  it('en CLP una tolerancia con decimales es 400 en el borde', async () => {
    // El peso no tiene centavos. Este es el caso que ningún test de DTO puede
    // cubrir: `validate()` no corre `EscalaMonedaPipe`.
    const res = await guardarTolerancia('1.5');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('decimales');
  });

  it('los ceros a la derecha NO son decimales: "1000.00" entra en CLP', async () => {
    // La regla valor-vs-cadena, ejercida por primera vez contra la API real.
    // Decimal normaliza, así que '1000.00' vale 1000 y es representable:
    // rechazarlo sería castigar un formato, no un número.
    const res = await guardarTolerancia('1000.00');
    expect(res.status).toBe(200);

    const prefs = await leer();
    expect(new Decimal(prefs.montoTolerancia).eq('1000')).toBe(true);
  });

  it('una tolerancia negativa sigue siendo 400', async () => {
    // No es del pipe sino de `@IsDecimalNoNegativo`, y va acá porque es la otra
    // puerta de la misma ruta: que el pipe nuevo no la haya desplazado.
    const res = await guardarTolerancia('-500');
    expect(res.status).toBe(400);
  });
});
