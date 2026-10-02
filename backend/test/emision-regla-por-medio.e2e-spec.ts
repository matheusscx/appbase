import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { loginSegundoTenant } from './helpers/segundo-tenant';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
// Admin del tenant: único que puede declarar emisor y facturador.
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };
// Rol Vendedor: sin `TenantAdminGuard`, el sujeto de los 403.
const VENDEDOR = { email: 'vendedor@paris.cl', password: 'admin' };

const TARJETA_CREDITO_ID = '550e8400-e29b-41d4-a716-446655440107';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';

interface MetodoFila {
  metodoPagoId: string;
  emisor: string;
  esEfectivo: boolean;
  habilitada: boolean;
  permiteVuelto: boolean;
}

async function login(
  app: INestApplication<App>,
  email: string,
  password: string,
): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
  expect(resLogin.status).toBe(200);
  const resSwitch = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set(
      'Authorization',
      `Bearer ${(resLogin.body as { access_token: string }).access_token}`,
    )
    .send({ tenantId: PARIS_TENANT_ID });
  expect(resSwitch.status).toBe(200);
  return (resSwitch.body as { access_token: string }).access_token;
}

describe('Regla de emisión: emisor por medio y facturador del comercio (e2e)', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenVendedor: string;
  let tokenAjeno: string;

  const filaDe = async (
    token: string,
    metodoPagoId: string,
  ): Promise<MetodoFila> => {
    const res = await request(app.getHttpServer())
      .get('/api/metodos-pago')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const fila = (res.body as MetodoFila[]).find(
      (m) => m.metodoPagoId === metodoPagoId,
    );
    expect(fila).toBeDefined();
    return fila!;
  };

  const facturadorDe = async (token: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get('/api/tenants/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return (res.body as { facturador: string }).facturador;
  };

  const patchMe = (token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch('/api/tenants/me')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const patchMetodo = (
    token: string,
    metodoPagoId: string,
    body: Record<string, unknown>,
  ) =>
    request(app.getHttpServer())
      .patch(`/api/metodos-pago/${metodoPagoId}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();

    tokenAdmin = await login(app, ADMIN.email, ADMIN.password);
    tokenVendedor = await login(app, VENDEDOR.email, VENDEDOR.password);
    tokenAjeno = await loginSegundoTenant(app);
  });

  afterAll(async () => {
    // Deja el seed como estaba para las suites que corran después.
    await patchMe(tokenAdmin, { facturador: 'sistema' });
    await patchMetodo(tokenAdmin, TARJETA_CREDITO_ID, { emisor: 'sistema' });
    await app.close();
  });

  describe('emisor por medio de pago', () => {
    it('un comercio sembrado trae "sistema" en todos los medios (E3)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/metodos-pago')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
      const filas = res.body as MetodoFila[];
      expect(filas.length).toBeGreaterThan(0);
      expect(filas.every((m) => m.emisor === 'sistema')).toBe(true);
    });

    it('el GET devuelve esEfectivo por fila (la pantalla de cobro lo necesita)', async () => {
      expect((await filaDe(tokenAdmin, EFECTIVO_ID)).esEfectivo).toBe(true);
      expect((await filaDe(tokenAdmin, TARJETA_CREDITO_ID)).esEfectivo).toBe(
        false,
      );
    });

    it('el admin cambia a "maquina" y el GET lo devuelve; el tenant de otro no cambia', async () => {
      const res = await patchMetodo(tokenAdmin, TARJETA_CREDITO_ID, {
        emisor: 'maquina',
      });
      expect(res.status).toBe(200);

      expect((await filaDe(tokenAdmin, TARJETA_CREDITO_ID)).emisor).toBe(
        'maquina',
      );
      // El otro tenant tiene su propia fila del mismo medio: sigue como estaba.
      expect((await filaDe(tokenAjeno, TARJETA_CREDITO_ID)).emisor).toBe(
        'sistema',
      );
    });

    it('un PATCH sin emisor conserva el que tenía', async () => {
      const res = await patchMetodo(tokenAdmin, TARJETA_CREDITO_ID, {
        habilitada: true,
      });
      expect(res.status).toBe(200);
      expect((await filaDe(tokenAdmin, TARJETA_CREDITO_ID)).emisor).toBe(
        'maquina',
      );
    });

    it.each(['externo', 'MAQUINA', '', 7, null])(
      'rechaza con 400 el valor %p fuera de la lista',
      async (emisor) => {
        const res = await patchMetodo(tokenAdmin, TARJETA_CREDITO_ID, {
          emisor,
        });
        expect(res.status).toBe(400);
        expect((await filaDe(tokenAdmin, TARJETA_CREDITO_ID)).emisor).toBe(
          'maquina',
        );
      },
    );

    // Las tres columnas son NOT NULL: un `null` explícito llegaba a Postgres y
    // daba 500. El control es el mismo campo con su valor de siempre: 200.
    it.each(['habilitada', 'permiteVuelto', 'emisor'] as const)(
      'un %s null es 400 y la fila no cambia; con su valor actual, 200',
      async (campo) => {
        const antes = await filaDe(tokenAdmin, TARJETA_CREDITO_ID);

        const res = await patchMetodo(tokenAdmin, TARJETA_CREDITO_ID, {
          [campo]: null,
        });
        expect(res.status).toBe(400);
        expect(await filaDe(tokenAdmin, TARJETA_CREDITO_ID)).toEqual(antes);

        const control = await patchMetodo(tokenAdmin, TARJETA_CREDITO_ID, {
          [campo]: antes[campo],
        });
        expect(control.status).toBe(200);
      },
    );

    it('un no-admin recibe 403 y el valor no cambia', async () => {
      const res = await patchMetodo(tokenVendedor, TARJETA_CREDITO_ID, {
        emisor: 'nadie',
      });
      expect(res.status).toBe(403);
      expect((await filaDe(tokenAdmin, TARJETA_CREDITO_ID)).emisor).toBe(
        'maquina',
      );
    });
  });

  describe('facturador del comercio', () => {
    it('un comercio sembrado trae "sistema" (E9)', async () => {
      expect(await facturadorDe(tokenAdmin)).toBe('sistema');
    });

    it('el admin cambia a "externo" y GET /tenants/me lo devuelve; el tenant de otro no cambia', async () => {
      const res = await patchMe(tokenAdmin, { facturador: 'externo' });
      expect(res.status).toBe(200);
      expect(await facturadorDe(tokenAdmin)).toBe('externo');
      expect(await facturadorDe(tokenAjeno)).toBe('sistema');
    });

    it('un PATCH sin facturador lo deja como estaba', async () => {
      // Reenvía el nombre actual: un PATCH real, que no cambia nada visible.
      const me = await request(app.getHttpServer())
        .get('/api/tenants/me')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(me.status).toBe(200);
      const res = await patchMe(tokenAdmin, {
        nombre: (me.body as { nombre: string }).nombre,
      });
      expect(res.status).toBe(200);
      expect(await facturadorDe(tokenAdmin)).toBe('externo');
    });

    it.each(['otro', 'SISTEMA', '', null])(
      'rechaza con 400 el valor %p',
      async (facturador) => {
        const res = await patchMe(tokenAdmin, { facturador });
        expect(res.status).toBe(400);
        expect(await facturadorDe(tokenAdmin)).toBe('externo');
      },
    );

    it('un no-admin recibe 403 y el valor no cambia', async () => {
      const res = await patchMe(tokenVendedor, { facturador: 'sistema' });
      expect(res.status).toBe(403);
      expect(await facturadorDe(tokenAdmin)).toBe('externo');
    });

    it('el admin vuelve a "sistema"', async () => {
      const res = await patchMe(tokenAdmin, { facturador: 'sistema' });
      expect(res.status).toBe(200);
      expect(await facturadorDe(tokenAdmin)).toBe('sistema');
    });
  });

  describe('el esquema rechaza lo que el DTO no dejaría pasar', () => {
    // La API ya devuelve 400 antes de llegar acá; esto prueba que el CHECK
    // existe de verdad (la entity lo declara y `synchronize` lo crea), que es
    // lo que protege a un escritor que no pase por el DTO.
    it('facturador y emisor fuera de la lista chocan con su CHECK', async () => {
      const ds = app.get(DataSource);
      await expect(
        ds.query(
          `UPDATE tenants SET facturador = 'otro' WHERE tenant_id = $1`,
          [PARIS_TENANT_ID],
        ),
      ).rejects.toThrow(/chk_tenants_facturador/);
      await expect(
        ds.query(
          `UPDATE tenant_metodo_pago SET emisor = 'otro'
           WHERE tenant_id = $1 AND metodo_pago_id = $2`,
          [PARIS_TENANT_ID, TARJETA_CREDITO_ID],
        ),
      ).rejects.toThrow(/chk_tenant_metodo_pago_emisor/);
    });
  });
});
