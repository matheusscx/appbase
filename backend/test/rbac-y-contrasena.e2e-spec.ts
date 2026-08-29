import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { AppModule } from '../src/app.module';
import { TokensAccesoService } from '../src/modules/auth/tokens-acceso.service';
import { TipoTokenAcceso } from '../src/modules/auth/entities/token-acceso.entity';

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
  // El `expect` que la entrada del 401 intermitente —cerrada el 2026-08-27,
  // `docs/agent/resueltos.md`— pide para los 23 helpers
  // que no lo tienen: sin esto, un login fallido deja `token` en `undefined` y
  // el rojo aparece dos requests más tarde, en otra ruta.
  // 200, no 201: los dos llevan `@HttpCode(HttpStatus.OK)` explícito.
  expect(resLogin.status).toBe(200);

  const resTenant = await request(app.getHttpServer())
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
  expect(resTenant.status).toBe(200);

  return (resTenant.body as TokenResponse).access_token;
}

describe('RBAC y cambio de contraseña (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let tokens: TokensAccesoService;

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
    dataSource = app.get(DataSource);
    tokens = app.get(TokensAccesoService);
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

      expect(resVendedor.status).toBe(200);
      expect(resAdmin.status).toBe(200);
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
      const correo = `cambio.contrasena.${sufijo}.${Date.now()}@e2e.test`;
      const contrasena = 'la-vieja-1234';

      // `200` y **sin sesión**: el registro responde lo mismo exista o no el
      // correo, así que no puede devolver tokens —cuando la dirección es de
      // otra persona no hay cuenta propia a la cual entrar—. La sesión llega
      // recién después de verificar.
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ nombre: 'Cambio Contraseña E2E', correo, contrasena });
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('access_token');

      // El token en claro NO sale por la API —ese es justamente el punto: en la
      // base sólo queda el hash SHA-256—, así que se emite uno por el service,
      // igual que hace `invitacion-y-reset.e2e-spec.ts`. Lo que se ejercita es
      // el endpoint de verificación, que es lo que importa acá.
      const filas = await dataSource.query<{ usuario_id: string }[]>(
        `SELECT usuario_id FROM usuarios WHERE correo = $1`,
        [correo],
      );
      expect(filas).toHaveLength(1);
      const verificacion = await tokens.emitir(
        filas[0].usuario_id,
        TipoTokenAcceso.VERIFICACION,
      );
      const resVerif = await request(app.getHttpServer()).post(
        `/api/auth/verificar/${verificacion}`,
      );
      expect(resVerif.status).toBe(200);

      // Y recién ahora entra. Sin el paso de arriba el login corta con 401:
      // ése es el control de que la verificación no es decorativa.
      const resLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: correo, password: contrasena });
      expect(resLogin.status).toBe(200);

      const cookies = resLogin.headers['set-cookie'] as unknown as string[];
      const refresh = cookies.find((c) => c.startsWith('refresh_token='));
      if (!refresh) throw new Error('El login no devolvió refresh_token');

      return {
        token: (resLogin.body as TokenResponse).access_token,
        cookie: refresh.split(';')[0],
      };
    }

    it('sin verificar el correo, la cuenta recién registrada no entra', async () => {
      // El control negativo del helper de arriba: si el login funcionara sin
      // verificar, todos los `expect` que dependen de la verificación pasarían
      // sin probar nada.
      const correo = `sin.verificar.${Date.now()}@e2e.test`;
      const contrasena = 'la-vieja-1234';
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ nombre: 'Sin Verificar', correo, contrasena });
      expect(res.status).toBe(200);

      const resLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: correo, password: contrasena });

      expect(resLogin.status).toBe(401);
    });

    /**
     * ⚠️ **La carrera de dos pestañas, medida de verdad.**
     *
     * Este test existe porque el unit equivalente **no puede** probar esto: fija
     * `reemplazado_por` en el mock, o sea que da por resuelto exactamente el
     * ordenamiento que fallaba. La primera versión del arreglo escribía el
     * puntero fuera de la transacción, y entonces el `UPDATE` del perdedor se
     * desbloqueaba al PRINCIPIO de la rotación —no en el commit—, leía
     * `reemplazado_por = NULL` y se comía un 401: medido contra Postgres, **7 de
     * cada 8 veces**. El unit pasaba igual.
     *
     * En el navegador ese 401 no es inocuo: `useApiFetch` hace `clearAuth()` +
     * `navigateTo('/login')`, así que la pestaña perdedora se iba al login.
     *
     * ℹ️ El bucle reusa la cookie **original**, no la rotada: la ronda 1 es la
     * carrera concurrente y las 2 a 5 ejercitan el **replay dentro de la
     * gracia**. Las dos cosas hay que cubrirlas, pero no son la misma, y decir
     * "más rondas = más muestras de la carrera" sería falso.
     */
    it('dos refresh simultáneos con la misma cookie: los DOS siguen andando', async () => {
      const { cookie } = await registrar('carrera');

      for (let ronda = 0; ronda < 5; ronda++) {
        const [a, b] = await Promise.all([
          request(app.getHttpServer())
            .post('/api/auth/refresh')
            .set('Cookie', cookie),
          request(app.getHttpServer())
            .post('/api/auth/refresh')
            .set('Cookie', cookie),
        ]);

        // Ninguno puede quedar afuera: el perdedor del canje recibe el mismo
        // token que ganó el otro.
        expect([a.status, b.status]).toEqual([200, 200]);
        const tokenA = (a.body as TokenResponse).access_token;
        const tokenB = (b.body as TokenResponse).access_token;
        expect(tokenA).toBeDefined();
        expect(tokenB).toBeDefined();

        // Y la cookie del ganador queda viva para la ronda siguiente: si la
        // detección de reuso hubiera revocado, esto daría 401 en la ronda 2.
        const cookies = (a.headers['set-cookie'] ??
          b.headers['set-cookie']) as unknown as string[];
        const nueva = cookies?.find((c) => c.startsWith('refresh_token='));
        expect(nueva).toBeDefined();
      }
    });

    /**
     * ⚠️ **Ráfaga: 15 sesiones distintas refrescando a la vez.**
     *
     * No es una carrera —cada una tiene su propia cookie— y ese es el punto: lo
     * que mide es que `refresh` **no agote el pool de conexiones**. Una versión
     * de este código hacía `usersService.findById` (repo-bound, o sea una
     * conexión nueva) **adentro** de la transacción: cada request retenía una
     * conexión y pedía una segunda, y con ~10 en vuelo el pool de 10 se
     * bloqueaba contra sí mismo. La API quedaba muerta para todos los tenants
     * hasta reiniciar el contenedor, y Postgres no lo abortaba porque el ciclo
     * es del pool y no de locks de base.
     *
     * El test de la carrera de acá arriba **no podía cazarlo**: manda 2 requests
     * y repite en serie, así que nunca pasa de 2 transacciones en vuelo.
     *
     * El `timeout` de Jest es la aserción real: si el pool se traba, esto no
     * falla con un status feo, se **cuelga**.
     */
    it('una ráfaga de 15 refresh simultáneos no traba el pool de conexiones', async () => {
      // ⚠️ El armado va en SERIE a propósito. El motivo escrito era que montar
      // las 15 sesiones en paralelo saturaba el listener efímero que supertest
      // levantaba por request y reventaba con `ECONNRESET`. **Ese listener ya no
      // existe** (2026-08-27, `test/setup-supertest.ts`: el bind se hace una vez
      // en `init()`), así que la razón no se sostiene y **paralelizarlo no está
      // medido ni a favor ni en contra**. Se deja en serie porque lo que este
      // test mide es la ráfaga de abajo, no la preparación: paralelizar el armado
      // no compra nada y arriesga volverlo flaky por otro lado.
      const sesiones: { cookie: string }[] = [];
      for (let i = 0; i < 15; i++) {
        sesiones.push(await registrar(`rafaga-${i}`));
      }

      // ⚠️ **HTTP real contra un puerto, no supertest.** El motivo original:
      // `request(server)` levantaba un listener efímero por llamada y quince a la
      // vez lo tumbaban con `ECONNRESET`, antes de que el pool llegara a importar.
      // **Premisa muerta desde el 2026-08-27** —el bind es uno solo, hecho en
      // `init()`—; si hoy quince por supertest andarían, no se midió. Lo que sigue
      // valiendo sin depender de eso: con las quince requests contra el mismo
      // puerto, lo que se mide es el pool y no el harness.
      const server = app.getHttpServer() as Server;
      if (!server.listening) {
        // El host va explícito por la misma razón que en `setup-supertest.ts`:
        // `listen(0)` bindea el wildcard y acá abajo se le habla a 127.0.0.1, y ese
        // desencuentro es el `401` fantasma. Hoy este bloque no corre —`init()` ya
        // dejó el server escuchando— pero si algún día vuelve a correr, que no reabra
        // el agujero.
        await new Promise<void>((resolve) =>
          server.listen(0, '127.0.0.1', resolve),
        );
      }
      const { port } = server.address() as AddressInfo;

      const respuestas = await Promise.all(
        sesiones.map(({ cookie }) =>
          fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
            method: 'POST',
            headers: { Cookie: cookie },
          }),
        ),
      );

      expect(respuestas.map((r) => r.status)).toEqual(
        Array.from({ length: 15 }, () => 200),
      );

      // Y el backend sigue vivo después: con el pool agotado esto se colgaba
      // aunque la ruta casi no toque la base.
      const despues = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ADMIN.email, password: ADMIN.pass }),
      });
      expect(despues.status).toBe(200);
    }, 60_000);

    it('un refresh token ya rotado y presentado de nuevo NO deja a nadie afuera dentro de la gracia', async () => {
      // El complemento del de arriba, secuencial en vez de concurrente: es el
      // reintento de red (la request llegó, la respuesta se perdió).
      const { cookie } = await registrar('reintento');

      const primera = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookie);
      expect(primera.status).toBe(200);

      // El mismo token viejo, otra vez: está dentro de los 30 s de gracia.
      const reintento = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', cookie);
      expect(reintento.status).toBe(200);

      // Y la sesión del ganador sigue viva: no se revocó nada.
      const cookiesGanador = primera.headers['set-cookie'] as unknown as
        | string[]
        | undefined;
      const refreshGanador = cookiesGanador
        ?.find((c) => c.startsWith('refresh_token='))
        ?.split(';')[0];
      const tercera = await request(app.getHttpServer())
        .post('/api/auth/refresh')
        .set('Cookie', refreshGanador ?? '');
      expect(tercera.status).toBe(200);
    });

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
