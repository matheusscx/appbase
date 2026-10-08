import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { CredencialesService } from '../src/modules/pasarela/services/credenciales.service';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris: Webpay Plus MALL (seed)
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };
const WEBPAY_PLUS_ID = '550e8400-e29b-41d4-a716-446655440216';
const HOST_PLATAFORMA = 'https://webpay3gint.transbank.cl/';
const LADRON = 'http://127.0.0.1:9/robo';

/**
 * La configuración de la pasarela del tenant (`tenant_pasarela.configuracion`).
 *
 * Medido el 2026-10-08: era un `@IsObject()` libre, y
 * `CredencialesService.resolver` esparcía lo guardado encima de las credenciales
 * de la plataforma. Con `{"commerceCodeHijo":…,"baseUrl":"http://127.0.0.1:3990"}`
 * el PATCH contestaba 200, y el siguiente cobro le mandaba a ese host el
 * `Tbk-Api-Key-Id` y el `Tbk-Api-Key-Secret` del mall de la plataforma. Los
 * no-string se guardaban y viajaban tal cual a Transbank, y un secreto de 90 kB o
 * un `{}` daban 500 al cobrar.
 *
 * Son dos defensas, y cada una tiene su mitad acá. La escritura (POST y PATCH de
 * admin, las únicas rutas que escriben la columna) rechaza lo que no sea una de
 * las tres claves de texto. El cobro, con un `baseUrl` ya guardado —escrito
 * directo en la base, como lo estaría de antes del DTO o por otra puerta—, sigue
 * yendo al host de la plataforma. Para eso `fetch` se intercepta: el provider es
 * el real y no sale nada a la red.
 */
describe('Pasarela: la configuración del tenant (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let credenciales: CredencialesService;
  let token: string;
  let apiKey: string;
  let propia: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });

  // Por PK y sin `eliminado_el IS NULL`: es la fila del propio test, y se lee
  // si el pedido escribió.
  const blobDe = async (id: string): Promise<string | null> => {
    const [fila]: { configuracion: string | null }[] = await ds.query(
      `SELECT configuracion FROM tenant_pasarela WHERE tenant_pasarela_id = $1`,
      [id],
    );
    return fila.configuracion;
  };

  const contarConfigs = async (): Promise<string> => {
    // Sin `eliminado_el IS NULL` a propósito: se cuenta si el pedido escribió.
    const filas: { n: string }[] = await ds.query(
      `SELECT count(*) AS n FROM tenant_pasarela WHERE tenant_id = $1`,
      [TENANT_ID],
    );
    return filas[0].n;
  };

  const alta = (configuracion: unknown) =>
    request(app.getHttpServer())
      .post('/api/pasarela/admin/config')
      .set(auth())
      .send({
        pasarelaId: WEBPAY_PLUS_ID,
        ambiente: 'pruebas',
        modoIntegracion: 'mall',
        // Apagada: que no compita con la del seed en los cobros de otras suites.
        activo: false,
        prioridad: 9,
        configuracion,
      });

  const edicion = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/api/pasarela/admin/config/${propia}`)
      .set(auth())
      .send(body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);
    credenciales = app.get(CredencialesService);

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

    const resKey = await request(app.getHttpServer())
      .post('/api/pasarela/admin/api-keys')
      .set(auth())
      .send({ nombre: `configuracion e2e ${Date.now()}` });
    expect(resKey.status).toBe(201);
    apiKey = (resKey.body as { apiKey: string }).apiKey;

    // Lo que manda la pantalla en MALL: es el control de las filas de abajo.
    const res = await alta({ commerceCodeHijo: '597055555536' });
    expect(res.status).toBe(201);
    propia = (res.body as { tenantPasarelaId: string }).tenantPasarelaId;
  });

  afterAll(async () => {
    if (propia) {
      const res = await request(app.getHttpServer())
        .delete(`/api/pasarela/admin/config/${propia}`)
        .set(auth());
      expect(res.status).toBe(200);
    }
    await app.close();
  });

  it('el alta guarda exactamente lo que mandó la pantalla', async () => {
    const blob = await blobDe(propia);
    expect(credenciales.descifrarJson(blob!)).toStrictEqual({
      commerceCodeHijo: '597055555536',
    });
  });

  const INVALIDAS: [string, unknown][] = [
    [
      'una clave que no es credencial (baseUrl)',
      { commerceCodeHijo: '597055555536', baseUrl: LADRON },
    ],
    ['commerceCodeHijo número', { commerceCodeHijo: 597055555536 }],
    ['commerceCodeHijo objeto', { commerceCodeHijo: { a: 1 } }],
    ['commerceCodeHijo null', { commerceCodeHijo: null }],
    ['commerceCodeHijo vacío', { commerceCodeHijo: '' }],
    ['commerceCodeHijo solo espacios', { commerceCodeHijo: '   ' }],
    ['commerceCodeHijo de 256', { commerceCodeHijo: '9'.repeat(256) }],
    [
      'apiKeySecret enorme',
      { commerceCodeHijo: '597055555536', apiKeySecret: 'A'.repeat(90000) },
    ],
    ['un array', ['597055555536']],
  ];

  it.each(INVALIDAS)('POST con %s: 400 y no escribe', async (_caso, config) => {
    const antes = await contarConfigs();
    const res = await alta(config);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('configuracion');
    expect(await contarConfigs()).toBe(antes);
  });

  it.each(INVALIDAS)(
    'PATCH con %s: 400 y el blob no cambia',
    async (_caso, config) => {
      const antes = await blobDe(propia);
      const res = await edicion({ configuracion: config });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('configuracion');
      expect(await blobDe(propia)).toBe(antes);
    },
  );

  it('el vacío llega en español y nombra el campo, como lo muestra el toast', async () => {
    const res = await edicion({ configuracion: { commerceCodeHijo: '' } });
    expect(res.status).toBe(400);
    expect(
      [(res.body as { message?: string | string[] }).message ?? []].flat(),
    ).toContain(
      'configuracion.El código de comercio hijo no puede quedar vacío',
    );
  });

  it('PATCH con las 3 credenciales de INDIVIDUAL (lo que manda la pantalla): 200', async () => {
    const cred = {
      mallCommerceCode: '597055555535',
      apiKeySecret: 'K'.repeat(64),
      commerceCodeHijo: '597055555536',
    };
    const res = await edicion({
      modoIntegracion: 'individual',
      configuracion: cred,
    });
    expect(res.status).toBe(200);
    expect(credenciales.descifrarJson((await blobDe(propia))!)).toStrictEqual(
      cred,
    );
  });

  it('PATCH con configuracion null sigue limpiando las credenciales', async () => {
    const res = await edicion({ configuracion: null });
    expect(res.status).toBe(200);
    expect(await blobDe(propia)).toBeNull();
  });

  describe('un baseUrl ya guardado no se lleva el cobro', () => {
    let fetchSpy: jest.SpiedFunction<typeof fetch>;
    const llamadas: {
      url: string;
      headers: Record<string, string>;
      body: string;
    }[] = [];

    beforeEach(() => {
      llamadas.length = 0;
      fetchSpy = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation((url, init) => {
          llamadas.push({
            // El provider llama con un string; `URL`/`Request` por si cambia.
            url:
              typeof url === 'string'
                ? url
                : url instanceof URL
                  ? url.href
                  : url.url,
            headers: init?.headers as Record<string, string>,
            body: init?.body as string,
          });
          return Promise.resolve(
            new Response(
              JSON.stringify({
                token: `tok-config-${Date.now()}`,
                url: 'https://webpay.falso/form',
              }),
              { status: 200 },
            ),
          );
        });
    });

    afterEach(async () => {
      fetchSpy.mockRestore();
      await ds.query(
        `UPDATE tenant_pasarela SET activo = false, prioridad = 9
          WHERE tenant_pasarela_id = $1`,
        [propia],
      );
    });

    /** Guarda la config directo en la base y la deja como la activa de Paris. */
    const guardarDirecto = async (
      modo: 'mall' | 'individual',
      config: Record<string, string>,
    ) => {
      await ds.query(
        `UPDATE tenant_pasarela
            SET configuracion = $2, modo_integracion = $3, activo = true, prioridad = 0
          WHERE tenant_pasarela_id = $1`,
        [propia, credenciales.cifrarJson(config), modo],
      );
    };

    const cobrar = () =>
      request(app.getHttpServer())
        .post('/api/pasarela/api/pagos')
        .set('Authorization', `Bearer ${apiKey}`)
        .send({
          monto: '1000',
          descripcion: 'configuracion e2e',
          urlExito: 'http://app.e2e/exito',
          urlFracaso: 'http://app.e2e/fracaso',
        });

    it('MALL: va al host de la plataforma con sus credenciales y el hijo del tenant', async () => {
      await guardarDirecto('mall', {
        commerceCodeHijo: '597055555536',
        baseUrl: LADRON,
        mallCommerceCode: 'DEL-TENANT',
        apiKeySecret: 'DEL-TENANT',
      });
      // Por PK: la fila global de Webpay Plus que siembra el seed.
      const [plataforma]: { configuracion_pruebas: string }[] = await ds.query(
        `SELECT configuracion_pruebas FROM pasarelas WHERE pasarela_id = $1`,
        [WEBPAY_PLUS_ID],
      );
      const credPlataforma = credenciales.descifrarJson(
        plataforma.configuracion_pruebas,
      );

      const res = await cobrar();

      expect(res.status).toBe(201);
      expect(llamadas).toHaveLength(1);
      expect(llamadas[0].url.startsWith(HOST_PLATAFORMA)).toBe(true);
      expect(llamadas[0].headers['Tbk-Api-Key-Id']).toBe(
        credPlataforma.mallCommerceCode,
      );
      expect(llamadas[0].headers['Tbk-Api-Key-Secret']).toBe(
        credPlataforma.apiKeySecret,
      );
      const body = JSON.parse(llamadas[0].body) as {
        details: { commerce_code: string }[];
      };
      expect(body.details[0].commerce_code).toBe('597055555536');
    });

    it('INDIVIDUAL: va al host del ambiente, no al de la config', async () => {
      await guardarDirecto('individual', {
        mallCommerceCode: '597055555535',
        apiKeySecret: 'K'.repeat(64),
        commerceCodeHijo: '597055555536',
        baseUrl: LADRON,
      });

      const res = await cobrar();

      expect(res.status).toBe(201);
      expect(llamadas).toHaveLength(1);
      expect(llamadas[0].url.startsWith(HOST_PLATAFORMA)).toBe(true);
    });
  });
});
