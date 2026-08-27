import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

/** Admin del tenant: short-circuita todo por `es_fijo`. */
const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
/** `Salones:Leer` + `Salones:Actualizar`, y NO admin (`seedRolEncargadoSalon`). */
const ENCARGADO = { email: 'encargado.salon@paris.cl', pass: 'admin' };
/** `Salones:Leer` + `Salones:Operar`: puede operar, no administrar. */
const GARZON_CON_CUENTA = { email: 'ana.torres@paris.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}
interface Rol {
  id: string;
  nombre: string;
  esFijo: boolean;
  esSistema: boolean;
}
interface GarzonResponse {
  id: string;
  nombre: string;
  usuarioId: string | null;
  advertencias?: string[];
  puedeOperarSalon?: boolean | null;
  cuentaEsMiembro?: boolean | null;
}

async function entrar(
  app: INestApplication<App>,
  email: string,
  pass: string,
): Promise<string> {
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: pass });
  expect(login.status).toBe(200);

  const enTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
    .set(
      'Authorization',
      `Bearer ${(login.body as TokenResponse).access_token}`,
    )
    .send({ tenantId: PARIS_TENANT_ID });
  expect(enTenant.status).toBe(200);
  return (enTenant.body as TokenResponse).access_token;
}

function correoNuevo(prefijo: string): string {
  return `${prefijo}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@e2e.cl`;
}

/**
 * `garzones.service.ts` avisa, en tres sitios, que la cuenta recién vinculada
 * *"no va a poder entrar en modo personal … hasta que se lo des"*. Ese aviso se
 * le muestra a cualquiera con `Salones:Actualizar`, y otorgar `Salones:Operar`
 * significaba editar un rol — `PATCH /roles/:id`, admin-only. O sea: una
 * instrucción que su lector podía no poder ejecutar.
 *
 * Decisión del owner (2026-08-15): **se abre el permiso, no se corrige el
 * texto**, y se abre por un camino puntual — NO dándole acceso a la edición de
 * roles, que lo dejaría editando cualquiera y sería escalada de privilegios.
 *
 * Esta suite prueba las dos mitades: que el encargado **puede**, y que lo que
 * puede está **acotado**.
 */
describe('Salones (e2e): el encargado puede dar el permiso de operar, y solo ese', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenEncargado: string;
  let tokenSoloOperar: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `switch-tenant` lee `req.cookies`, y `cookieParser` vive en `main.ts`,
    // que el e2e no ejecuta.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    tokenAdmin = await entrar(app, ADMIN.email, ADMIN.pass);
    tokenEncargado = await entrar(app, ENCARGADO.email, ENCARGADO.pass);
    tokenSoloOperar = await entrar(
      app,
      GARZON_CON_CUENTA.email,
      GARZON_CON_CUENTA.pass,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Una cuenta nueva del tenant, sin ningún rol que le dé `Salones:Operar`, y
   * un garzón propio vinculado a ella. Nueva por corrida: reusar una cuenta ya
   * habilitada haría pasar el test sin que el otorgamiento hiciera nada.
   */
  async function garzonConCuentaSinPermiso(
    token = tokenAdmin,
  ): Promise<{ usuarioId: string; garzon: GarzonResponse }> {
    const rolesRes = await request(app.getHttpServer())
      .get('/api/roles')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(rolesRes.status).toBe(200);
    // Un rol cualquiera que NO sea fijo ni de sistema: el alta exige al menos
    // uno, y con el fijo la cuenta sería admin y podría operar por
    // short-circuit — el test pasaría sin otorgar nada.
    const rol = (rolesRes.body as Rol[]).find((r) => !r.esFijo && !r.esSistema);
    // Sin rol no hay alta posible: si el seed cambiara y Paris quedara solo con
    // el fijo, este `toBeTruthy` dice qué pasó en vez de reventar más abajo.
    expect(rol).toBeTruthy();

    const alta = await request(app.getHttpServer())
      .post('/api/tenants/usuarios')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: 'Sin',
        apellido: 'Permiso',
        correo: correoNuevo('operar'),
        rolIds: [rol!.id],
      });
    expect(alta.status).toBe(201);
    const usuarioId = (alta.body as { usuarioId: string }).usuarioId;

    const creado = await request(app.getHttpServer())
      .post('/api/garzones')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `E2E Operar ${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        usuarioId,
      });
    expect(creado.status).toBe(201);
    const garzon = creado.body as GarzonResponse;
    // El estado de partida, y de paso el dato que el frontend usa para ofrecer
    // el botón: la cuenta todavía NO puede operar.
    expect(garzon.puedeOperarSalon).toBe(false);
    expect(garzon.advertencias?.join(' ')).toContain('hasta que se lo des');
    return { usuarioId, garzon };
  }

  it('el encargado (NO admin) puede darlo, y el permiso rige de verdad', async () => {
    const { garzon } = await garzonConCuentaSinPermiso(tokenEncargado);

    const res = await request(app.getHttpServer())
      .post(`/api/garzones/${garzon.id}/permiso-operar`)
      .set('Authorization', `Bearer ${tokenEncargado}`);
    expect(res.status).toBe(201);

    // Que rija no se afirma sobre las filas escritas sino sobre el motor: se
    // re-vincula la misma cuenta y se lee `puedeOperarSalon`, que sale de la
    // consulta de RBAC completa (rol → módulo del tenant → permiso). Si el
    // cableado quedara a medias —el rol sin `modulos_roles`, por ejemplo— las
    // filas existirían igual y esto seguiría en `false`.
    const revinculado = await request(app.getHttpServer())
      .patch(`/api/garzones/${garzon.id}`)
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send({ usuarioId: garzon.usuarioId });
    expect(revinculado.status).toBe(200);
    expect((revinculado.body as GarzonResponse).puedeOperarSalon).toBe(true);
    expect((revinculado.body as GarzonResponse).advertencias).toEqual([]);
  });

  it('darlo dos veces no rompe nada ni duplica el rol', async () => {
    const { garzon } = await garzonConCuentaSinPermiso(tokenEncargado);

    for (let i = 0; i < 2; i++) {
      await request(app.getHttpServer())
        .post(`/api/garzones/${garzon.id}/permiso-operar`)
        .set('Authorization', `Bearer ${tokenEncargado}`)
        .expect(201);
    }

    const roles = await request(app.getHttpServer())
      .get('/api/roles')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const deSistema = (roles.body as Rol[]).filter((r) => r.esSistema);
    expect(deSistema).toHaveLength(1);
  });

  it('sin `Salones:Actualizar` no se puede, aunque se tenga `Salones:Operar`', async () => {
    const { garzon } = await garzonConCuentaSinPermiso();

    await request(app.getHttpServer())
      .post(`/api/garzones/${garzon.id}/permiso-operar`)
      .set('Authorization', `Bearer ${tokenSoloOperar}`)
      .expect(403);
  });

  it('no se le da el permiso a una cuenta que ya no es miembro', async () => {
    // No es un caso teórico: la salida "no sigue" de la baja de membresía deja
    // al garzón **vinculado a una cuenta dada de baja**, y desde ahí el
    // encargado llega a este endpoint en una sola llamada. Sin el chequeo se
    // escribe una fila de `roles_usuarios` que hoy no concede nada, pero que
    // le restituye el rol en silencio si a esa persona la vuelven a sumar por
    // `POST /tenants/members`, que nunca toca `roles_usuarios`.
    const { usuarioId, garzon } = await garzonConCuentaSinPermiso();

    await request(app.getHttpServer())
      .delete(`/api/tenants/members/${usuarioId}?garzon=no-sigue`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .post(`/api/garzones/${garzon.id}/permiso-operar`)
      .set('Authorization', `Bearer ${tokenEncargado}`);
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(
      /ya no es miembro/,
    );
  });

  it('un garzón sin cuenta vinculada no tiene a quién darle el permiso', async () => {
    const creado = await request(app.getHttpServer())
      .post('/api/garzones')
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send({ nombre: `E2E Sin cuenta ${Date.now()}` });
    expect(creado.status).toBe(201);

    await request(app.getHttpServer())
      .post(
        `/api/garzones/${(creado.body as GarzonResponse).id}/permiso-operar`,
      )
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .expect(400);
  });

  describe('lo que el encargado NO puede: ampliar lo que reparte', () => {
    /** El rol de sistema, creado por el primer otorgamiento de esta suite. */
    async function rolDeSistema(): Promise<Rol> {
      const { garzon } = await garzonConCuentaSinPermiso(tokenEncargado);
      await request(app.getHttpServer())
        .post(`/api/garzones/${garzon.id}/permiso-operar`)
        .set('Authorization', `Bearer ${tokenEncargado}`)
        .expect(201);

      const roles = await request(app.getHttpServer())
        .get('/api/roles')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const rol = (roles.body as Rol[]).find((r) => r.esSistema);
      expect(rol).toBeTruthy();
      // No es fijo: si lo fuera daría acceso TOTAL por el short-circuit de
      // `RbacService`, y el encargado estaría repartiendo el tenant entero.
      expect(rol!.esFijo).toBe(false);
      return rol!;
    }

    it('ni el ADMIN puede agregarle permisos — es lo que acota lo que el encargado reparte', async () => {
      // El bloqueo que sostiene toda la decisión. Si el admin pudiera sumarle
      // `Ventas:Crear`, el encargado pasaría a repartir eso también sin que
      // ninguno de los dos se entere.
      const rol = await rolDeSistema();
      const modulos = await request(app.getHttpServer())
        .get('/api/roles/modulos-disponibles')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(modulos.status).toBe(200);
      const modulo = (
        modulos.body as {
          moduloTenantId: string;
          permisos: { moduloAppPermisoId: string }[];
        }[]
      ).find((m) => m.permisos.length > 0);
      expect(modulo).toBeTruthy();

      await request(app.getHttpServer())
        .put(
          `/api/roles/${rol.id}/modules/${modulo!.moduloTenantId}/permissions`,
        )
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          moduloAppPermisoIds: modulo!.permisos.map(
            (p) => p.moduloAppPermisoId,
          ),
        })
        .expect(400);
    });

    it('ni el ADMIN puede renombrarlo ni borrarlo', async () => {
      const rol = await rolDeSistema();

      await request(app.getHttpServer())
        .patch(`/api/roles/${rol.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ nombre: 'Operador de todo' })
        .expect(400);

      await request(app.getHttpServer())
        .delete(`/api/roles/${rol.id}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(400);
    });

    it('el encargado sigue sin poder tocar los roles del tenant', async () => {
      // La otra mitad de "camino puntual": abrirle el otorgamiento no le abrió
      // la edición de roles. Si esto diera 200, la decisión estaría
      // implementada como la escalada que descartó explícitamente.
      const roles = await request(app.getHttpServer())
        .get('/api/roles')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const cualquiera = (roles.body as Rol[]).find(
        (r) => !r.esFijo && !r.esSistema,
      );

      await request(app.getHttpServer())
        .patch(`/api/roles/${cualquiera!.id}`)
        .set('Authorization', `Bearer ${tokenEncargado}`)
        .send({ nombre: 'Mío ahora' })
        .expect(403);
    });
  });

  /**
   * El listado con `conPermisos`, contra la API real. Lo que ningún unit ve:
   * que el `unnest($2::uuid[])` y los EXISTS de RBAC sean SQL válida (los
   * tests unitarios mockean `manager.query` y pasarían con la consulta rota),
   * y que el DTO transforme el `'true'` del query string — sin el
   * `@Transform`, `@IsBoolean` lo rechaza y el flag queda inutilizable.
   *
   * Los dos campos existen por dos huecos medidos el 2026-08-16:
   * - la ficha rotulaba *"Sin PIN todavía"* —cuyo significado es *"la persona
   *   lo resuelve desde su perfil"*— a garzones cuya cuenta ya no es miembro y
   *   que por lo tanto **no pueden** (`fijarMiPin` les da 404);
   * - el único botón para dar `Salones:Operar` vivía en un toast que se
   *   auto-cierra, y sin este dato la ficha no podía ofrecer otro.
   */
  describe('el listado sabe lo que la ficha necesita para no mentir', () => {
    it('SIN el flag los campos no viajan: `undefined` es "no se preguntó", no "la cuenta está mal"', async () => {
      const { garzon } = await garzonConCuentaSinPermiso();

      const res = await request(app.getHttpServer())
        .get('/api/garzones')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
      const fila = (res.body as GarzonResponse[]).find(
        (g) => g.id === garzon.id,
      );
      expect(fila).toBeTruthy();
      // Las otras cinco pantallas que cargan este listado no piden el flag y
      // no deben pagar el RBAC. Si esto empezara a venir definido, lo están
      // pagando.
      expect(fila!.cuentaEsMiembro).toBeUndefined();
      expect(fila!.puedeOperarSalon).toBeUndefined();
    });

    it('CON el flag: cuenta viva sin el permiso → miembro sí, operar no', async () => {
      const { garzon } = await garzonConCuentaSinPermiso();

      const fila = await filaConPermisos(garzon.id);

      expect(fila.cuentaEsMiembro).toBe(true);
      expect(fila.puedeOperarSalon).toBe(false);
    });

    it('otorgar el permiso se ve en el listado: es lo que le apaga el botón a la ficha', async () => {
      const { garzon } = await garzonConCuentaSinPermiso();

      await request(app.getHttpServer())
        .post(`/api/garzones/${garzon.id}/permiso-operar`)
        .set('Authorization', `Bearer ${tokenEncargado}`)
        .expect(201);

      expect((await filaConPermisos(garzon.id)).puedeOperarSalon).toBe(true);
    });

    it('la baja "no sigue" deja el garzón con `cuentaEsMiembro: false` — el estado que el badge rotulaba mal', async () => {
      const { usuarioId, garzon } = await garzonConCuentaSinPermiso();
      // Estado de partida: la cuenta ES miembro. Sin esta línea el test pasaría
      // igual con un `cuentaEsMiembro` clavado en `false`.
      expect((await filaConPermisos(garzon.id)).cuentaEsMiembro).toBe(true);

      await request(app.getHttpServer())
        .delete(`/api/tenants/members/${usuarioId}?garzon=no-sigue`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(200);

      const fila = await filaConPermisos(garzon.id);
      // El vínculo SIGUE (es lo que "no sigue" produce a propósito), pero la
      // cuenta ya no es miembro. Ese par es exactamente el caso que la ficha
      // no sabía distinguir de "todavía no lo fijó".
      expect(fila.usuarioId).toBe(usuarioId);
      expect(fila.cuentaEsMiembro).toBe(false);
    });

    it('un garzón SIN cuenta queda en null, no en false: no hay a quién preguntarle', async () => {
      const creado = await request(app.getHttpServer())
        .post('/api/garzones')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          nombre: `E2E Sin cuenta ${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        });
      expect(creado.status).toBe(201);

      const fila = await filaConPermisos((creado.body as GarzonResponse).id);

      expect(fila.cuentaEsMiembro).toBeNull();
      expect(fila.puedeOperarSalon).toBeNull();
    });
  });

  /** La fila de ese garzón en el listado pedido CON los permisos. */
  async function filaConPermisos(garzonId: string): Promise<GarzonResponse> {
    const res = await request(app.getHttpServer())
      .get('/api/garzones?conPermisos=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    // Antes de castear: un 401 devuelve un objeto, y `.find` sobre un objeto
    // es un `TypeError` que no dice qué contestó el servidor (ver el
    // intermitente de auth, cerrado el 2026-08-27 en `docs/agent/resueltos.md`).
    expect(res.status).toBe(200);
    const fila = (res.body as GarzonResponse[]).find((g) => g.id === garzonId);
    expect(fila).toBeTruthy();
    return fila!;
  }
});
