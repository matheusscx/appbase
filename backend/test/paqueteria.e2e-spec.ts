import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import type {
  PaqueteConfiguracionRespuesta,
  RepartidorFila,
} from '../src/modules/paqueteria/paqueteria.types';
import { loginSegundoTenant } from './helpers/segundo-tenant';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const VENDEDOR_PARIS = { email: 'vendedor@paris.cl', pass: 'admin' }; // no es admin del tenant

interface TokenResponse {
  access_token: string;
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
  expect(resLogin.status).toBe(200);
  const initialToken = (resLogin.body as TokenResponse).access_token;
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId });
  expect(resTenant.status).toBe(200);
  return (resTenant.body as TokenResponse).access_token;
}

describe('Paquetería — configuración y repartidores (e2e)', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenVendedor: string;
  let tokenSegundoTenant: string;
  const creados: string[] = [];

  const llamar = (
    metodo: 'get' | 'post' | 'put' | 'patch' | 'delete',
    ruta: string,
    token = tokenAdmin,
    body?: object,
  ) => {
    const req = request(app.getHttpServer())
      [metodo](ruta)
      .set('Authorization', `Bearer ${token}`);
    return body ? req.send(body) : req;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    // `switch-tenant` lee `req.cookies`, y `cookieParser` vive en `main.ts`, que el e2e no ejecuta.
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    tokenAdmin = await login(
      app,
      ADMIN_PARIS.email,
      ADMIN_PARIS.pass,
      PARIS_TENANT_ID,
    );
    tokenVendedor = await login(
      app,
      VENDEDOR_PARIS.email,
      VENDEDOR_PARIS.pass,
      PARIS_TENANT_ID,
    );
    tokenSegundoTenant = await loginSegundoTenant(app);
  });

  afterAll(async () => {
    // El `close` va en un `finally` y la aserción DESPUÉS (molde: `cajones.e2e-spec.ts`).
    const fallos: string[] = [];
    try {
      for (const id of creados) {
        const res = await llamar('delete', `/api/repartidores/${id}`);
        if (![200, 404].includes(res.status)) {
          fallos.push(`DELETE repartidor ${id} → ${res.status}`);
        }
      }
    } finally {
      await app.close();
    }
    expect(fallos).toEqual([]);
  });

  it('el vendedor (no admin) recibe 403 en las rutas del módulo', async () => {
    for (const [metodo, ruta] of [
      ['get', '/api/paquetes/configuracion'],
      ['put', '/api/paquetes/configuracion'],
      ['get', '/api/repartidores'],
      ['post', '/api/repartidores'],
    ] as const) {
      const res = await llamar(metodo, ruta, tokenVendedor, {});
      expect(res.status).toBe(403);
    }
  });

  describe('configuración', () => {
    // Estado único del tenant Paris: este describe lo deja siempre en 10000 / 5000
    // (los valores del seed), así ningún otro spec ve otra cosa.
    it('PUT guarda y GET lo devuelve; un monto con decimales en CLP es 400', async () => {
      const ok = await llamar(
        'put',
        '/api/paquetes/configuracion',
        tokenAdmin,
        {
          precioEnvioDefecto: '10000',
          pagoRepartidorDefecto: '5000',
        },
      );
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({
        configurada: true,
        precioEnvioDefecto: '10000.0000',
        pagoRepartidorDefecto: '5000.0000',
      });

      const leida = await llamar('get', '/api/paquetes/configuracion');
      expect(leida.status).toBe(200);
      expect(leida.body as PaqueteConfiguracionRespuesta).toMatchObject({
        configurada: true,
        precioEnvioDefecto: '10000.0000',
      });

      const malo = await llamar(
        'put',
        '/api/paquetes/configuracion',
        tokenAdmin,
        {
          precioEnvioDefecto: '10000.5',
          pagoRepartidorDefecto: '5000',
        },
      );
      expect(malo.status).toBe(400);
    });

    it('PUT sin uno de los campos, o con un monto negativo: 400', async () => {
      const falta = await llamar(
        'put',
        '/api/paquetes/configuracion',
        tokenAdmin,
        {
          precioEnvioDefecto: '10000',
        },
      );
      expect(falta.status).toBe(400);
      const negativo = await llamar(
        'put',
        '/api/paquetes/configuracion',
        tokenAdmin,
        {
          precioEnvioDefecto: '-1',
          pagoRepartidorDefecto: '5000',
        },
      );
      expect(negativo.status).toBe(400);
    });

    it('cada tenant tiene la suya: el segundo no ve los montos de Paris', async () => {
      const paris = await llamar('get', '/api/paquetes/configuracion');
      expect(paris.status).toBe(200);
      expect((paris.body as PaqueteConfiguracionRespuesta).configurada).toBe(
        true,
      );

      const ajena = await llamar(
        'get',
        '/api/paquetes/configuracion',
        tokenSegundoTenant,
      );
      expect(ajena.status).toBe(200);
      expect(ajena.body).not.toEqual(paris.body);
    });
  });

  describe('repartidores', () => {
    it('alta y desactivar; el listado lo sigue mostrando, inactivo', async () => {
      const r = await llamar('post', '/api/repartidores', tokenAdmin, {
        nombre: `E2E ${Date.now()}`,
        telefono: '+56911112222',
      });
      expect(r.status).toBe(201);
      const id = (r.body as RepartidorFila).id;
      creados.push(id);
      expect(r.body).toMatchObject({ activo: true, telefono: '+56911112222' });

      const off = await llamar('patch', `/api/repartidores/${id}`, tokenAdmin, {
        activo: false,
      });
      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({ id, activo: false });

      const lista = await llamar('get', '/api/repartidores');
      expect(lista.status).toBe(200);
      expect(
        (lista.body as RepartidorFila[]).find((x) => x.id === id),
      ).toMatchObject({
        activo: false,
      });
    });

    it('PATCH con telefono null lo borra; sin la clave lo deja', async () => {
      const r = await llamar('post', '/api/repartidores', tokenAdmin, {
        nombre: `E2E ${Date.now()}`,
        telefono: '+56933334444',
      });
      expect(r.status).toBe(201);
      const id = (r.body as RepartidorFila).id;
      creados.push(id);

      const renombre = await llamar(
        'patch',
        `/api/repartidores/${id}`,
        tokenAdmin,
        {
          nombre: `E2E renombrado ${Date.now()}`,
        },
      );
      expect(renombre.status).toBe(200);
      expect(renombre.body).toMatchObject({ telefono: '+56933334444' });

      const sinTel = await llamar(
        'patch',
        `/api/repartidores/${id}`,
        tokenAdmin,
        {
          telefono: null,
        },
      );
      expect(sinTel.status).toBe(200);
      expect(sinTel.body).toMatchObject({ telefono: null });
    });

    it.each([['nombre'], ['activo']])(
      'PATCH con %s null: 400 y el repartidor queda igual',
      async (campo) => {
        const nombre = `E2E ${Date.now()}`;
        const r = await llamar('post', '/api/repartidores', tokenAdmin, {
          nombre,
        });
        expect(r.status).toBe(201);
        const id = (r.body as RepartidorFila).id;
        creados.push(id);

        const res = await llamar(
          'patch',
          `/api/repartidores/${id}`,
          tokenAdmin,
          {
            [campo]: null,
          },
        );
        expect(res.status).toBe(400);

        const lista = await llamar('get', '/api/repartidores');
        expect(lista.status).toBe(200);
        expect(
          (lista.body as RepartidorFila[]).find((x) => x.id === id),
        ).toMatchObject({ nombre, activo: true });
      },
    );

    it('nombre vacío al crear: 400', async () => {
      const res = await llamar('post', '/api/repartidores', tokenAdmin, {
        nombre: '',
      });
      expect(res.status).toBe(400);
    });

    it('eliminar: sale del listado (soft delete) y un segundo DELETE es 404', async () => {
      const r = await llamar('post', '/api/repartidores', tokenAdmin, {
        nombre: `E2E ${Date.now()}`,
      });
      expect(r.status).toBe(201);
      const id = (r.body as RepartidorFila).id;

      const del = await llamar('delete', `/api/repartidores/${id}`);
      expect(del.status).toBe(200);

      const lista = await llamar('get', '/api/repartidores');
      expect(lista.status).toBe(200);
      expect((lista.body as RepartidorFila[]).some((x) => x.id === id)).toBe(
        false,
      );

      const otra = await llamar('delete', `/api/repartidores/${id}`);
      expect(otra.status).toBe(404);
    });

    it('aislamiento: el repartidor de un tenant no existe para el otro (404) ni aparece en su listado', async () => {
      const r = await llamar('post', '/api/repartidores', tokenAdmin, {
        nombre: `E2E ${Date.now()}`,
      });
      expect(r.status).toBe(201);
      const id = (r.body as RepartidorFila).id;
      creados.push(id);

      const ajeno = await llamar(
        'patch',
        `/api/repartidores/${id}`,
        tokenSegundoTenant,
        {
          nombre: 'x',
        },
      );
      expect(ajeno.status).toBe(404);
      const ajenoDel = await llamar(
        'delete',
        `/api/repartidores/${id}`,
        tokenSegundoTenant,
      );
      expect(ajenoDel.status).toBe(404);

      const lista = await llamar(
        'get',
        '/api/repartidores',
        tokenSegundoTenant,
      );
      expect(lista.status).toBe(200);
      expect((lista.body as RepartidorFila[]).some((x) => x.id === id)).toBe(
        false,
      );
    });

    it('id con forma no UUID: 400, no 500', async () => {
      const res = await llamar(
        'patch',
        '/api/repartidores/no-es-uuid',
        tokenAdmin,
        {
          nombre: 'x',
        },
      );
      expect(res.status).toBe(400);
    });
  });
});
