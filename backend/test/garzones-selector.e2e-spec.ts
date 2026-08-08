import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * El selector previo al teclado de PIN, contra Postgres real.
 *
 * ⚠️ **Existe por una lección concreta, no por completitud.** El unit test de
 * `listarParaSelector` mockea el query builder, así que puede afirmar que se usa
 * `EXISTS`/`NOT EXISTS` pero **no puede probar que el SQL compile**. Ese es
 * exactamente el agujero por el que el 2026-08-07 se commiteó un `SELECT` con
 * una columna inexistente con el gate entero en verde: la ruta no tenía e2e y el
 * unit mockeaba el `manager.query`.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };

// PINs de dev del seed.
const ANA = {
  id: '550e8400-e29b-41d4-a716-446655440238',
  nombre: 'Ana Torres',
  pin: '111111',
};
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

/**
 * Garzón **activo y válido de OTRO tenant**, sembrado justamente para esto
 * (`seeder.service.ts`: *"sin un garzón ajeno sembrado, esa distinción no la
 * ejerce nada y un bug de fuga pasa los gates"*). El único motivo por el que no
 * debe aparecer es el tenant.
 */
const AJENO_DE_FALABELLA = {
  id: '550e8400-e29b-41d4-a716-446655440332',
  nombre: 'Diego Soto (Falabella)',
};

interface TokenResponse {
  access_token: string;
}
interface GarzonSelector {
  garzonId: string;
  nombre: string;
}

async function login(
  app: INestApplication<App>,
  email: string,
  password: string,
  tenantId: string,
): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId });
  return (resTenant.body as TokenResponse).access_token;
}

describe('Selector de garzones (e2e) — las dos listas y la verificación', () => {
  let app: INestApplication<App>;
  let token: string;

  const pedir = (enTurno: boolean) =>
    request(app.getHttpServer())
      .get(`/api/garzones/para-selector?enTurno=${enTurno}`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    token = await login(
      app,
      ADMIN_PARIS.email,
      ADMIN_PARIS.pass,
      PARIS_TENANT_ID,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('las dos listas compilan y no se pisan', async () => {
    const [fuera, dentro] = await Promise.all([pedir(false), pedir(true)]);

    expect(fuera.status).toBe(200);
    expect(dentro.status).toBe(200);

    const ids = (r: { body: unknown }) =>
      (r.body as GarzonSelector[]).map((g) => g.garzonId);
    const enComun = ids(fuera).filter((id) => ids(dentro).includes(id));
    // Son complementarias por construcción (`EXISTS` / `NOT EXISTS` sobre la
    // misma condición): un solapamiento significa que una de las dos está mal.
    expect(enComun).toEqual([]);
  });

  it('devuelve SOLO garzonId y nombre', async () => {
    const res = await pedir(false);

    expect(res.status).toBe(200);
    const garzones = res.body as GarzonSelector[];
    expect(garzones.length).toBeGreaterThan(0);
    for (const g of garzones) {
      expect(Object.keys(g).sort()).toEqual(['garzonId', 'nombre']);
    }
  });

  // ⚠️ Es el test más importante del archivo. Medido: borrar el
  // `.where('g.tenant_id = :tenantId')` del service deja el gate ENTERO en verde
  // —1536 unit y 329 e2e— y el endpoint empieza a listar garzones de otros
  // tenants. Sin esta afirmación, la fuga se commitea sin que nada chille.
  it('NO filtra un garzón activo de otro tenant', async () => {
    const [fuera, dentro] = await Promise.all([pedir(false), pedir(true)]);
    const todos = [
      ...(fuera.body as GarzonSelector[]),
      ...(dentro.body as GarzonSelector[]),
    ];

    expect(todos.map((g) => g.garzonId)).not.toContain(AJENO_DE_FALABELLA.id);
    expect(todos.map((g) => g.nombre)).not.toContain(AJENO_DE_FALABELLA.nombre);
    // El fixture tiene que estar vivo para que la afirmación valga: si alguien
    // lo desactiva, este test pasaría por la razón equivocada.
    expect(todos.length).toBeGreaterThan(0);
  });

  // ⚠️ `Mostrador` está sembrado con `activo: false`, así que `g.activo = true`
  // ya lo excluye: este e2e **no** cubre el `es_placeholder = false` (borrarlo lo
  // deja verde). Quien lo fija es el unit test. Se conserva como control de que
  // el placeholder no se cuele por ningún otro camino.
  it('excluye al placeholder Mostrador de las dos listas', async () => {
    const [fuera, dentro] = await Promise.all([pedir(false), pedir(true)]);
    const nombres = [
      ...(fuera.body as GarzonSelector[]),
      ...(dentro.body as GarzonSelector[]),
    ].map((g) => g.nombre);

    expect(nombres).not.toContain('Mostrador');
  });

  it('sin `enTurno` responde 400, no una lista arbitraria', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/garzones/para-selector')
      .set('Authorization', `Bearer ${token}`);

    // El default silencioso era el riesgo: devolvería la lista equivocada sin
    // que nadie se entere.
    expect(res.status).toBe(400);
  });

  describe('abrir turno mueve al garzón de una lista a la otra', () => {
    let sesionCreada = false;

    afterAll(async () => {
      if (!sesionCreada) return;
      await request(app.getHttpServer())
        .post('/api/sesiones-garzon/cerrar')
        .set('Authorization', `Bearer ${token}`)
        .send({ garzonId: ANA.id, pin: ANA.pin });
    });

    it('está en la lista de "sin turno" antes y en la de "en turno" después', async () => {
      // ⚠️ Se cierra primero, ignorando el resultado. Sin esto el test se
      // auto-degradaba según el orden de las suites: `combos.e2e-spec.ts` abre
      // la sesión de Ana y no la cierra al final, así que este spec podía
      // encontrarla abierta y saltearse las tres afirmaciones que importan —
      // quedando verde sin haber probado nada.
      await request(app.getHttpServer())
        .post('/api/sesiones-garzon/cerrar')
        .set('Authorization', `Bearer ${token}`)
        .send({ garzonId: ANA.id, pin: ANA.pin });

      const antes = await pedir(false);
      expect((antes.body as GarzonSelector[]).map((g) => g.garzonId)).toContain(
        ANA.id,
      );

      const res = await request(app.getHttpServer())
        .post('/api/sesiones-garzon/iniciar')
        .set('Authorization', `Bearer ${token}`)
        .send({ garzonId: ANA.id, pin: ANA.pin, turnoId: TURNO_MANANA_ID });

      expect([200, 201]).toContain(res.status);
      sesionCreada = true;
      const dentro = await pedir(true);
      expect(
        (dentro.body as GarzonSelector[]).map((g) => g.garzonId),
      ).toContain(ANA.id);
      const fuera = await pedir(false);
      expect(
        (fuera.body as GarzonSelector[]).map((g) => g.garzonId),
      ).not.toContain(ANA.id);
    });
  });

  describe('verificar-pin', () => {
    it('acepta el PIN correcto del garzón elegido', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/garzones/verificar-pin')
        .set('Authorization', `Bearer ${token}`)
        .send({ garzonId: ANA.id, pin: ANA.pin });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ garzonId: ANA.id, nombre: ANA.nombre });
    });

    // El PIN de otro garzón: con la iteración vieja esto habría dado 200 con el
    // garzón equivocado, porque no había a quién comparar.
    it('rechaza el PIN de OTRO garzón', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/garzones/verificar-pin')
        .set('Authorization', `Bearer ${token}`)
        .send({ garzonId: ANA.id, pin: '222222' });

      expect(res.status).toBe(400);
    });

    it('sin garzonId responde 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/garzones/verificar-pin')
        .set('Authorization', `Bearer ${token}`)
        .send({ pin: ANA.pin });

      expect(res.status).toBe(400);
    });
  });
});
