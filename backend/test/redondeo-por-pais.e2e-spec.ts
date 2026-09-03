import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

const PROV_RM = '550e8400-e29b-41d4-a716-446655440001'; // Chile
const PROV_PASCUA = '550e8400-e29b-41d4-a716-446655440002'; // Chile
const PROV_CABA = '550e8400-e29b-41d4-a716-446655440375'; // Argentina
const PROV_CDMX = '550e8400-e29b-41d4-a716-446655440377'; // México

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
const SUPERADMIN = { email: 'admin@sistema.com', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}

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

interface TenantCreado {
  id: string;
  modoRedondeo: string;
  nivelRedondeo: string;
  escalaCalculo: number;
}

describe('Redondeo por país (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let tokenSuper: string;

  /** Un tenant propio por test: tocar Paris le rompería el resto a las otras suites. */
  async function crearTenantEn(provinciaId: string): Promise<TenantCreado> {
    const sufijo = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const res = await request(app.getHttpServer())
      .post('/api/admin/tenants')
      .set('Authorization', `Bearer ${tokenSuper}`)
      .send({
        nombre: `E2E Redondeo ${sufijo}`,
        correo: `redondeo-${sufijo}@e2e.test`,
        provinciaId,
      });
    expect(res.status).toBe(201);
    return res.body as TenantCreado;
  }

  async function entrarA(tenantId: string): Promise<string> {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: SUPERADMIN.email, password: SUPERADMIN.pass });
    expect(login.status).toBe(200);
    const res = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
      .set(
        'Authorization',
        `Bearer ${(login.body as TokenResponse).access_token}`,
      )
      .send({ tenantId });
    expect(res.status).toBe(200);
    return (res.body as TokenResponse).access_token;
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
    token = await login(app);

    const superLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: SUPERADMIN.email, password: SUPERADMIN.pass });
    expect(superLogin.status).toBe(200);
    tokenSuper = (superLogin.body as TokenResponse).access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('el token del admin de Paris sigue sirviendo', () => {
    expect(token).toBeTruthy();
  });

  describe('lo que el seed carga', () => {
    it('Argentina y Colombia nacen con half-even, y es ley', async () => {
      const filas: {
        codigo_iso: string;
        modo_redondeo_sugerido: string | null;
        modo_redondeo_es_ley: boolean;
        modo_redondeo_norma: string | null;
      }[] = await ds.query(
        `SELECT codigo_iso, modo_redondeo_sugerido, modo_redondeo_es_ley,
                modo_redondeo_norma
           FROM pais
          WHERE codigo_iso IN ('AR', 'CO') AND eliminado_el IS NULL
          ORDER BY codigo_iso`,
      );
      expect(filas).toHaveLength(2);
      for (const f of filas) {
        expect(f.modo_redondeo_sugerido).toBe('HALF_EVEN');
        expect(f.modo_redondeo_es_ley).toBe(true);
        // La norma no puede faltar: es lo que la pantalla le muestra al tenant
        // cuando la perilla está cerrada.
        expect(f.modo_redondeo_norma).toBeTruthy();
      }
    });

    it('México fija el NIVEL y deja libre el modo — el candado es por perilla', async () => {
      const [mx]: {
        modo_redondeo_es_ley: boolean;
        nivel_redondeo_sugerido: string | null;
        nivel_redondeo_es_ley: boolean;
        nivel_redondeo_norma: string | null;
      }[] = await ds.query(
        `SELECT modo_redondeo_es_ley, nivel_redondeo_sugerido,
                nivel_redondeo_es_ley, nivel_redondeo_norma
           FROM pais WHERE codigo_iso = 'MX' AND eliminado_el IS NULL`,
      );
      expect(mx.nivel_redondeo_sugerido).toBe('documento');
      expect(mx.nivel_redondeo_es_ley).toBe(true);
      expect(mx.nivel_redondeo_norma).toBeTruthy();
      // La otra mitad, y es la que prueba que el candado NO es por país: si lo
      // fuera, México tendría también el modo bloqueado.
      expect(mx.modo_redondeo_es_ley).toBe(false);
    });

    it('Chile queda SIN candado: lo que tenemos es una inferencia, no una norma', async () => {
      const [cl]: {
        modo_redondeo_es_ley: boolean;
        nivel_redondeo_es_ley: boolean;
      }[] = await ds.query(
        `SELECT modo_redondeo_es_ley, nivel_redondeo_es_ley
           FROM pais WHERE codigo_iso = 'CL' AND eliminado_el IS NULL`,
      );
      expect(cl.modo_redondeo_es_ley).toBe(false);
      expect(cl.nivel_redondeo_es_ley).toBe(false);
    });

    it('cada país nuevo tiene SU oficial habilitada y una provincia', async () => {
      // Sin provincia no hay tenant posible en ese país, y sin tenant el país
      // no le empuja su regla a nadie: el catálogo quedaría de adorno.
      //
      // El `JOIN` va contra `moneda_oficial_id`, no contra cualquier
      // `pais_moneda`: con un `COUNT(*) >= 1` el seed podría haber habilitado
      // la moneda equivocada y el test pasaría igual. Y filtra `eliminado_el`
      // en las cuatro tablas porque `MonedasService` también lo hace — una
      // habilitación soft-deleted deja al tenant sin moneda oficial viva, que
      // es justo el estado que este test dice cubrir.
      const filas: {
        codigo_iso: string;
        oficial: string | null;
        provincias: string;
      }[] = await ds.query(
        `SELECT p.codigo_iso,
                  m.codigo_iso AS oficial,
                  COUNT(DISTINCT prov.provincia_id) AS provincias
             FROM pais p
             LEFT JOIN pais_moneda pm
                    ON pm.pais_id = p.pais_id
                   AND pm.moneda_id = p.moneda_oficial_id
                   AND pm.eliminado_el IS NULL
             LEFT JOIN moneda m
                    ON m.moneda_id = pm.moneda_id AND m.eliminado_el IS NULL
             LEFT JOIN provincia prov
                    ON prov.pais_id = p.pais_id AND prov.eliminado_el IS NULL
            WHERE p.codigo_iso IN ('AR', 'CO', 'MX') AND p.eliminado_el IS NULL
            GROUP BY p.codigo_iso, m.codigo_iso
            ORDER BY p.codigo_iso`,
      );
      expect(filas.map((f) => [f.codigo_iso, f.oficial])).toEqual([
        ['AR', 'ARS'],
        ['CO', 'COP'],
        ['MX', 'MXN'],
      ]);
      for (const f of filas) {
        expect(Number(f.provincias)).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('la regla que el país guarda', () => {
    it('un país no puede declarar "es ley" sin decir cuál es el valor que impone', async () => {
      // El CHECK es de la BASE, no del service: se prueba por SQL directo, que
      // es el único camino que lo puede violar. Un país mal cargado por el
      // futuro panel de superadmin dejaría el candado cerrado contra NULL y
      // ningún tenant de ese país podría guardar sus preferencias nunca más.
      await expect(
        ds.query(
          `INSERT INTO pais (pais_id, nombre, codigo_iso, zona_horaria_principal,
                             modo_redondeo_es_ley, creado_el, actualizado_el)
           VALUES ($1, 'Paisdeprueba', 'XX', 'UTC', true, NOW(), NOW())`,
          [randomUUID()],
        ),
      ).rejects.toThrow(/chk_pais_modo_redondeo_ley/);
    });

    it('el mismo CHECK existe para la otra perilla — el candado es por perilla', async () => {
      await expect(
        ds.query(
          `INSERT INTO pais (pais_id, nombre, codigo_iso, zona_horaria_principal,
                             nivel_redondeo_es_ley, creado_el, actualizado_el)
           VALUES ($1, 'Paisdeprueba', 'XY', 'UTC', true, NOW(), NOW())`,
          [randomUUID()],
        ),
      ).rejects.toThrow(/chk_pais_nivel_redondeo_ley/);
    });
  });

  describe('el país empuja el default al nacer el tenant', () => {
    it('un tenant nuevo en Argentina nace con HALF_EVEN, no con el default de sistema', async () => {
      // `HALF_EVEN` discrimina justamente porque NO es el default de sistema
      // (`HALF_UP`): con un país que sugiriera HALF_UP, un `create` que
      // ignorara el país pasaría igual y el test no probaría nada.
      const tenant = await crearTenantEn(PROV_CABA);
      expect(tenant.modoRedondeo).toBe('HALF_EVEN');
    });

    it('un tenant nuevo en Chile sigue naciendo con el default de sistema', async () => {
      const tenant = await crearTenantEn(PROV_RM);
      expect(tenant.modoRedondeo).toBe('HALF_UP');
      expect(tenant.nivelRedondeo).toBe('linea');
      expect(tenant.escalaCalculo).toBe(6);
    });

    it('el tenant mexicano nace con "documento" Y con la escala que ese nivel admite', async () => {
      // La escala baja a 4 y no es un detalle: con 'documento' las líneas se
      // persisten sin cuantizar, con `escalaCalculo` decimales, en columnas
      // NUMERIC(18,4). Con la escala 6 del default, el recorte lo terminaría
      // decidiendo el cast de Postgres — fuera del modo de redondeo del
      // tenant. Es la misma regla que ya valida `updatePreferenciasFinancieras`.
      const tenant = await crearTenantEn(PROV_CDMX);
      expect(tenant.nivelRedondeo).toBe('documento');
      expect(tenant.escalaCalculo).toBe(4);
    });

    it('un tenant recién nacido puede guardar sus propias preferencias sin cambiarlas', async () => {
      // El control que caza el nacimiento en un estado que la propia API
      // rechaza: sin la escala ajustada, este PUT vuelve 400 y el tenant
      // mexicano queda sin poder tocar su configuración nunca.
      const tenant = await crearTenantEn(PROV_CDMX);
      const tokenMX = await entrarA(tenant.id);
      const actual = await request(app.getHttpServer())
        .get('/api/tenants/preferencias-financieras')
        .set('Authorization', `Bearer ${tokenMX}`);
      expect(actual.status).toBe(200);

      const res = await request(app.getHttpServer())
        .put('/api/tenants/preferencias-financieras')
        .set('Authorization', `Bearer ${tokenMX}`)
        .send(actual.body as Record<string, unknown>);
      expect(res.status).toBe(200);
    });

    it('una provincia que no existe corta con 400, no con un 500 de Postgres', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/tenants')
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({
          nombre: `E2E Fantasma ${Date.now()}`,
          correo: `fantasma-${Date.now()}@e2e.test`,
          provinciaId: randomUUID(),
        });
      expect(res.status).toBe(400);
      // El mensaje, porque el 400 solo no distingue este corte del que tira el
      // `ValidationPipe` por un UUID mal formado — y ese ya existía.
      expect(JSON.stringify(res.body)).toContain('no existe');
    });
  });

  describe('mudarse de país por la API', () => {
    it('cambiar a una provincia de OTRO país corta con 400', async () => {
      // Hasta que este frente sembró AR/CO/MX, toda provincia era chilena y
      // este agujero era inerte. Con países nuevos en el catálogo, un
      // `provinciaId` validado solo como UUID le cambia al tenant su moneda
      // oficial (CLP sin decimales → ARS con dos) y lo deja sin métodos de
      // pago ni tipos de documento de su país nuevo.
      const tenant = await crearTenantEn(PROV_RM);
      const tokenCL = await entrarA(tenant.id);
      const res = await request(app.getHttpServer())
        .patch('/api/tenants/me')
        .set('Authorization', `Bearer ${tokenCL}`)
        .send({ provinciaId: PROV_CABA });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain('país');
    });

    it('la ruta de superadmin tampoco lo deja: la misma puerta, del otro lado', async () => {
      // `PATCH /admin/tenants/:id` toma el mismo `provinciaId` que el PATCH del
      // tenant. Cerrar una de las dos puertas y no la otra deja el frente
      // afirmando una garantía que no tiene: por acá se llega al mismo tenant
      // roto —moneda oficial que no es la suya, sin métodos de pago ni tipos
      // de documento del país nuevo—.
      const tenant = await crearTenantEn(PROV_CDMX);
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/tenants/${tenant.id}`)
        .set('Authorization', `Bearer ${tokenSuper}`)
        .send({ provinciaId: PROV_RM });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain('país');
    });

    it('mudarse DENTRO del mismo país sigue permitido', async () => {
      // El control que descarta el guard escrito "por presencia de la clave":
      // sin él, un guard que rechace todo `provinciaId` pasa el test de arriba
      // igual y rompe la pantalla de empresa.
      const tenant = await crearTenantEn(PROV_RM);
      const tokenCL = await entrarA(tenant.id);
      const res = await request(app.getHttpServer())
        .patch('/api/tenants/me')
        .set('Authorization', `Bearer ${tokenCL}`)
        .send({ provinciaId: PROV_PASCUA });
      expect(res.status).toBe(200);
    });
  });
});
