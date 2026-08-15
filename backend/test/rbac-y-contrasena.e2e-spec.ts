import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * Las dos rutas que el gate daba por verdes sin haberlas ejecutado nunca contra
 * Postgres. Lo señaló la revisión independiente del cierre de las dos entradas
 * 🚩 de la auditoría RBAC/auth: los unit de `RbacService` y `MeService` corren
 * con `DataSource`/`Repository` mockeados, así que **el SQL que se cambió no lo
 * ejecutaba nadie**.
 *
 * Qué cubre y qué no:
 * - **Sí**: que las cinco consultas del motor de permisos, con el tenant atado
 *   en el JOIN, sigan devolviendo lo correcto contra la base real — en
 *   particular el caso 2 de `getMisPermisos` (usuario SIN rol fijo), que es la
 *   consulta que se reescribió moviendo un predicado del `WHERE` al `JOIN`.
 * - **Sí**: que cambiar la contraseña mate el refresh token de verdad, con un
 *   control positivo al lado para que el 401 no pueda venir de que el refresh
 *   nunca funcione en e2e.
 * - **No**: el aislamiento entre tenants propiamente dicho. Montar una fila de
 *   `roles_usuarios` que apunte a un rol de otro tenant **ya no es posible por
 *   API** —esa era justamente la mitad del fix en `assignUser`—, y armarla con
 *   SQL directo probaría un estado inalcanzable. Esa mitad la fijan los unit,
 *   que afirman sobre la forma del SQL.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

// Rol `Administrador`, `es_fijo = true` → short-circuit del motor de permisos.
const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
// Rol `Vendedor`, `es_fijo = false` → NO corta, entra por el JOIN completo.
// Es el único actor que ejercita el caso 2 de `getMisPermisos`.
const VENDEDOR = { email: 'vendedor@paris.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}

/** Login + switch al tenant, **afirmando el status de los dos pasos**. */
async function login(
  app: INestApplication<App>,
  email: string,
  password: string,
): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
  // El `expect` que la entrada del 401 intermitente pide para los 23 helpers
  // que no lo tienen: sin esto, un login fallido deja `token` en `undefined` y
  // el rojo aparece dos requests más tarde, en otra ruta.
  // 200, no 201: los dos llevan `@HttpCode(HttpStatus.OK)` explícito.
  expect(resLogin.status).toBe(200);

  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Authorization',
      `Bearer ${(resLogin.body as TokenResponse).access_token}`,
    )
    .send({ tenantId: PARIS_TENANT_ID });
  expect(resTenant.status).toBe(200);

  return (resTenant.body as TokenResponse).access_token;
}

describe('RBAC y cambio de contraseña (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `/auth/refresh` lee `req.cookies`, y `cookieParser` vive en `main.ts`,
    // que el e2e no ejecuta. Sin esto el refresh da 401 siempre y el test de
    // abajo pasaría por el motivo equivocado.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  describe('GET /rbac/mis-permisos', () => {
    it('un usuario CON rol fijo recibe los permisos del tenant', async () => {
      const token = await login(app, ADMIN.email, ADMIN.pass);

      const res = await request(app.getHttpServer())
        .get('/api/rbac/mis-permisos')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const permisos = res.body as string[];
      expect(Array.isArray(permisos)).toBe(true);
      expect(permisos.length).toBeGreaterThan(0);
      // Formato `modulo:permiso`, que es lo que arma el `map` del service.
      expect(permisos.every((p) => p.includes(':'))).toBe(true);
    });

    // ⭐ El caso que ninguna otra suite ejercita: `es_fijo = false`, o sea el
    // JOIN completo rol → módulo del tenant → permiso, que es la consulta que
    // se reescribió.
    it('un usuario SIN rol fijo recibe solo los permisos asignados a su rol', async () => {
      const token = await login(app, VENDEDOR.email, VENDEDOR.pass);

      const res = await request(app.getHttpServer())
        .get('/api/rbac/mis-permisos')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      const permisos = res.body as string[];
      // No vacío: si el JOIN quedara sobre-restringido, esto daría [] y el
      // vendedor no podría hacer nada. Es la aserción que caza una atadura de
      // tenant mal puesta.
      expect(permisos.length).toBeGreaterThan(0);
      expect(permisos.every((p) => p.includes(':'))).toBe(true);
    });

    it('el vendedor recibe MENOS permisos que el admin', async () => {
      const [tokenAdmin, tokenVendedor] = await Promise.all([
        login(app, ADMIN.email, ADMIN.pass),
        login(app, VENDEDOR.email, VENDEDOR.pass),
      ]);

      const [resAdmin, resVendedor] = await Promise.all([
        request(app.getHttpServer())
          .get('/api/rbac/mis-permisos')
          .set('Authorization', `Bearer ${tokenAdmin}`),
        request(app.getHttpServer())
          .get('/api/rbac/mis-permisos')
          .set('Authorization', `Bearer ${tokenVendedor}`),
      ]);

      // Las dos ramas devuelven algo distinto: prueba que el short-circuit del
      // rol fijo y el JOIN completo no colapsaron al mismo resultado.
      expect((resVendedor.body as string[]).length).toBeLessThan(
        (resAdmin.body as string[]).length,
      );
    });
  });

  describe('GET /rbac/es-admin', () => {
    it('distingue al admin del vendedor', async () => {
      const [tokenAdmin, tokenVendedor] = await Promise.all([
        login(app, ADMIN.email, ADMIN.pass),
        login(app, VENDEDOR.email, VENDEDOR.pass),
      ]);

      const [resAdmin, resVendedor] = await Promise.all([
        request(app.getHttpServer())
          .get('/api/rbac/es-admin')
          .set('Authorization', `Bearer ${tokenAdmin}`),
        request(app.getHttpServer())
          .get('/api/rbac/es-admin')
          .set('Authorization', `Bearer ${tokenVendedor}`),
      ]);

      expect(resAdmin.status).toBe(200);
      expect(resVendedor.status).toBe(200);
      expect((resAdmin.body as { esAdmin: boolean }).esAdmin).toBe(true);
      expect((resVendedor.body as { esAdmin: boolean }).esAdmin).toBe(false);
    });
  });

  describe('PATCH /me/contrasena', () => {
    /**
     * Se registra una cuenta nueva por test en vez de usar una del seed: cambiar
     * la contraseña de `vendedor@paris.cl` la dejaría rota para las otras seis
     * specs que loguean con ella.
     */
    async function registrar(sufijo: string): Promise<{
      token: string;
      cookie: string;
    }> {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          nombre: 'Cambio Contraseña E2E',
          correo: `cambio.contrasena.${sufijo}.${Date.now()}@e2e.test`,
          contrasena: 'la-vieja-1234',
        });
      expect(res.status).toBe(201);

      const cookies = res.headers['set-cookie'] as unknown as string[];
      const refresh = cookies.find((c) => c.startsWith('refresh_token='));
      if (!refresh) throw new Error('El registro no devolvió refresh_token');

      return {
        token: (res.body as TokenResponse).access_token,
        cookie: refresh.split(';')[0],
      };
    }

    // Control positivo: sin esto, el 401 del test de abajo podría venir de que
    // el refresh nunca funcione en e2e, y el test pasaría sin probar nada.
    it('control: sin cambiar la contraseña, el refresh token sigue sirviendo', async () => {
      const { cookie } = await registrar('control');

      const res = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookie);

      expect(res.status).toBe(200);
      expect((res.body as TokenResponse).access_token).toBeDefined();
    });

    it('cambiar la contraseña mata el refresh token', async () => {
      const { token, cookie } = await registrar('cambio');

      const resCambio = await request(app.getHttpServer())
        .patch('/api/me/contrasena')
        .set('Authorization', `Bearer ${token}`)
        .send({
          contrasenaActual: 'la-vieja-1234',
          contrasenaNueva: 'la-nueva-5678',
          confirmarContrasena: 'la-nueva-5678',
        });
      expect(resCambio.status).toBe(200);

      const resRefresh = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookie);

      expect(resRefresh.status).toBe(401);
    });

    it('una contraseña actual incorrecta no mata la sesión', async () => {
      const { token, cookie } = await registrar('fallido');

      const resCambio = await request(app.getHttpServer())
        .patch('/api/me/contrasena')
        .set('Authorization', `Bearer ${token}`)
        .send({
          contrasenaActual: 'no-es-esta',
          contrasenaNueva: 'la-nueva-5678',
          confirmarContrasena: 'la-nueva-5678',
        });
      expect(resCambio.status).toBe(401);

      const resRefresh = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookie);

      expect(resRefresh.status).toBe(200);
    });
  });
});
