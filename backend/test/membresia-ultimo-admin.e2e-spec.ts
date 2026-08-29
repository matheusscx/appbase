import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { TenantsService } from '../src/modules/tenants/tenants.service';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const PROVINCIA_ID = '550e8400-e29b-41d4-a716-446655440001';

const SUPERADMIN = { email: 'admin@sistema.com', pass: 'admin' };
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}
interface Rol {
  id: string;
  nombre: string;
  esFijo: boolean;
}
interface AltaResponse {
  usuarioId: string;
}
interface GarzonResponse {
  id: string;
  nombre: string;
  activo: boolean;
  usuarioId: string | null;
  pinFijado: boolean;
}
interface BajaResponse {
  garzon: {
    id: string;
    nombre: string;
    accion: 'desvinculado' | 'desactivado';
    pin: string | null;
    advertencias: string[];
  } | null;
}

/**
 * Login + `switch-tenant`, que es lo que deja un token con `tenantId` adentro.
 * Devuelve también la cookie porque `switch-tenant` la exige desde el
 * 2026-08-15.
 */
async function entrar(
  app: INestApplication<App>,
  email: string,
  pass: string,
  tenantId: string,
): Promise<string> {
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: pass });
  expect(login.status).toBe(200);
  const cookie = (login.headers['set-cookie'] as unknown as string[]) ?? [];

  const enTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Cookie', cookie)
    .set(
      'Authorization',
      `Bearer ${(login.body as TokenResponse).access_token}`,
    )
    .send({ tenantId });
  expect(enTenant.status).toBe(200);
  return (enTenant.body as TokenResponse).access_token;
}

/** Un correo distinto por corrida: estas suites crean cuentas de verdad. */
function correoNuevo(prefijo: string): string {
  return `${prefijo}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@e2e.cl`;
}

/**
 * La membresía y el rol fijo son lo único que separa a un tenant de quedar
 * inaccesible: `/admin/tenants` expone crear, listar, ver, editar, borrar y
 * agregar módulos, y **ninguna ruta para asignar un rol ni sumar un miembro**
 * (verificado el 2026-08-15). Un tenant que se queda sin admin solo se arregla
 * con SQL directo, así que las dos puertas que pueden dejarlo así —desasignar
 * el rol y dar de baja la membresía— tienen que bloquear.
 *
 * Y el bloqueo tiene que valer **bajo concurrencia**: dos requests que sacan a
 * los dos últimos admins pueden pasar los dos chequeos si el conteo no toma
 * lock. Ese es el último `it` y es el que de verdad justifica esta suite —
 * los otros los caza un unit.
 */
describe('Membresía (e2e): el tenant no se puede quedar sin administradores', () => {
  let app: INestApplication<App>;
  let tokenSuper: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `switch-tenant` y `refresh` leen `req.cookies`, y `cookieParser` vive en
    // `main.ts`, que el e2e no ejecuta. Sin esto los dos cortan con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: SUPERADMIN.email, password: SUPERADMIN.pass });
    expect(login.status).toBe(200);
    tokenSuper = (login.body as TokenResponse).access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Un tenant propio por test, con el superadmin como **único** admin. Es la
   * única forma de ejercer "el último": hacerlo sobre Paris le rompería el
   * admin a las otras suites.
   */
  async function tenantPropio(): Promise<{
    tenantId: string;
    token: string;
    rolAdminId: string;
    superId: string;
  }> {
    const creado = await request(app.getHttpServer())
      .post('/api/admin/tenants')
      .set('Authorization', `Bearer ${tokenSuper}`)
      .send({
        nombre: `E2E Solo ${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        correo: correoNuevo('tenant'),
        provinciaId: PROVINCIA_ID,
      });
    expect(creado.status).toBe(201);
    const tenantId = (creado.body as { id: string }).id;

    const token = await entrar(
      app,
      SUPERADMIN.email,
      SUPERADMIN.pass,
      tenantId,
    );

    const roles = await request(app.getHttpServer())
      .get('/api/roles')
      .set('Authorization', `Bearer ${token}`);
    expect(roles.status).toBe(200);
    const rolAdmin = (roles.body as Rol[]).find((r) => r.esFijo);
    expect(rolAdmin).toBeTruthy();

    const miembros = await request(app.getHttpServer())
      .get('/api/tenants/members')
      .set('Authorization', `Bearer ${token}`);
    expect(miembros.status).toBe(200);
    const filas = miembros.body as { usuarioId: string }[];
    // Exactamente uno: si el tenant naciera con más admins, "el último" de
    // estos tests no sería el último y todos pasarían por la razón equivocada.
    expect(filas).toHaveLength(1);

    return {
      tenantId,
      token,
      rolAdminId: rolAdmin!.id,
      superId: filas[0].usuarioId,
    };
  }

  /** Suma un admin más al tenant. Correo nuevo = queda miembro al instante. */
  async function sumarAdmin(
    token: string,
    rolAdminId: string,
  ): Promise<string> {
    const alta = await request(app.getHttpServer())
      .post('/api/tenants/usuarios')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: 'Segundo',
        apellido: 'Admin',
        correo: correoNuevo('admin2'),
        rolIds: [rolAdminId],
      });
    expect(alta.status).toBe(201);
    return (alta.body as AltaResponse).usuarioId;
  }

  it('desasignarle el rol al último admin se rechaza', async () => {
    const { token, rolAdminId, superId } = await tenantPropio();

    const res = await request(app.getHttpServer())
      .delete(`/api/roles/${rolAdminId}/users/${superId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(
      /sin ningún administrador/,
    );

    // Y no quedó a medias: el rol sigue puesto, así que la ruta que exige
    // `TenantAdminGuard` sigue abierta.
    const despues = await request(app.getHttpServer())
      .get('/api/tenants/members')
      .set('Authorization', `Bearer ${token}`);
    expect(despues.status).toBe(200);
  });

  it('darle de baja la membresía al último admin se rechaza', async () => {
    const { token, superId } = await tenantPropio();

    const res = await request(app.getHttpServer())
      .delete(`/api/tenants/members/${superId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toMatch(
      /última con rol de administrador/,
    );

    const despues = await request(app.getHttpServer())
      .get('/api/tenants/members')
      .set('Authorization', `Bearer ${token}`);
    expect(despues.status).toBe(200);
    expect(despues.body as unknown[]).toHaveLength(1);
  });

  it('con dos admins, sacar a uno sí se puede — el bloqueo no es "nunca"', async () => {
    const { token, rolAdminId, superId } = await tenantPropio();
    await sumarAdmin(token, rolAdminId);

    const res = await request(app.getHttpServer())
      .delete(`/api/tenants/members/${superId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  /**
   * ⚠️ **Dos intentos anteriores no probaban nada, y conviene que quede
   * escrito** (medido el 2026-08-16):
   *
   * 1. Dos bajas por HTTP en `Promise.all` —con supertest y después con `fetch`
   *    real contra un puerto— dan `[200, 403]`: la segunda request empieza
   *    cuando la primera ya commiteó y su `TenantGuard` corta antes de llegar
   *    al service. No hay carrera.
   * 2. Dos llamadas concurrentes al service tampoco: el mutante que saca el
   *    `FOR UPDATE` **sobrevive**. Sin lock, las dos transacciones igual se
   *    serializan de hecho, y la ventana real del bug —que la segunda cuente
   *    entre el conteo y el COMMIT de la primera— es de microsegundos. Un test
   *    que depende de ganar esa lotería es verde por casualidad.
   *
   * Así que lo que se mide acá es **el lock mismo**, que es lo que la entrada
   * del backlog exige ("el conteo tiene que tomar lock"): se retiene desde
   * afuera el lock sobre las filas de un admin que la baja NO toca, y se
   * afirma que la baja **queda esperando**. Sin `FOR UPDATE` no esperaría: su
   * conteo sería un `SELECT` común y su `UPDATE` cae sobre otra fila.
   */
  it('el conteo de admins TOMA LOCK: una baja espera a quien ya lo tiene', async () => {
    const { tenantId, token, rolAdminId, superId } = await tenantPropio();
    const segundoId = await sumarAdmin(token, rolAdminId);

    const runner = app.get(DataSource).createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    // El mismo lock que toma el service, pero acotado a las filas del
    // superadmin. Acotarlo es lo que hace concluyente al test: si bloqueara
    // también las filas de `segundoId`, la baja se frenaría por su propio
    // `UPDATE` y no por el conteo, y el mutante sobreviviría otra vez.
    await runner.query(
      `SELECT ut.usuario_id
         FROM usuarios_tenants ut
         JOIN roles_usuarios ru ON ru.usuario_id = ut.usuario_id
                               AND ru.tenant_id = ut.tenant_id
                               AND ru.eliminado_el IS NULL
         JOIN roles r ON r.rol_id = ru.rol_id
                     AND r.tenant_id = ru.tenant_id
                     AND r.es_fijo = true
                     AND r.eliminado_el IS NULL
        WHERE ut.tenant_id = $1 AND ut.usuario_id = $2
          AND ut.eliminado_el IS NULL
        FOR UPDATE OF ut, ru`,
      [tenantId, superId],
    );

    let termino = false;
    const baja = app
      .get(TenantsService)
      .removeMember(tenantId, segundoId, superId)
      .then((r) => {
        termino = true;
        return r;
      });

    // ⚠️ `finally` y no secuencial: si el `expect` de abajo falla sin soltar el
    // lock, quedan una transacción abierta reteniendo filas y una promesa
    // colgada, y el `app.close()` del `afterAll` se queda esperando. Un rojo
    // puntual se convertiría en el gate entero trabado.
    try {
      await new Promise((r) => setTimeout(r, 500));
      // La aserción: 500 ms es una eternidad para una baja que en el resto de
      // esta suite tarda milisegundos. Si terminó, no pidió el lock.
      expect(termino).toBe(false);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
    await expect(baja).resolves.toEqual({ garzon: null });

    // Y una vez liberado, el resultado es el correcto: se fue uno y quedó el
    // otro. Lo que el lock compra es que ese "quedó el otro" sea cierto
    // también cuando las dos bajas corren a la vez.
    const admins: unknown[] = await app.get(DataSource).query(
      `SELECT 1
         FROM usuarios_tenants ut
         JOIN roles_usuarios ru ON ru.usuario_id = ut.usuario_id
                               AND ru.tenant_id = ut.tenant_id
                               AND ru.eliminado_el IS NULL
         JOIN roles r ON r.rol_id = ru.rol_id
                     AND r.tenant_id = ru.tenant_id
                     AND r.es_fijo = true
                     AND r.eliminado_el IS NULL
        WHERE ut.tenant_id = $1 AND ut.eliminado_el IS NULL`,
      [tenantId],
    );
    expect(admins).toHaveLength(1);
  }, 30_000);
});

/**
 * La otra mitad de la baja: la cuenta que se da de baja puede ser la
 * **credencial** de un garzón. Vincular mata el PIN a propósito —desde ese
 * momento la identidad la prueba el JWT—, así que al bajar la membresía
 * `garzonPersonalDe` deja de resolver el modo personal y el PIN sigue muerto:
 * esa persona se queda sin ninguna forma de operar, y hasta el 2026-08-16 sin
 * ninguna señal de que pasó.
 *
 * Corre en Paris y con un garzón propio: la sesión del garzón del seed es
 * única y seis specs la comparten.
 */
describe('Membresía (e2e): la baja pregunta por el garzón vinculado', () => {
  let app: INestApplication<App>;
  let token: string;
  let rolNoAdminId: string;

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

    token = await entrar(
      app,
      ADMIN_PARIS.email,
      ADMIN_PARIS.pass,
      PARIS_TENANT_ID,
    );

    const roles = await request(app.getHttpServer())
      .get('/api/roles')
      .set('Authorization', `Bearer ${token}`);
    expect(roles.status).toBe(200);
    // Un rol NO fijo: si estas bajas se llevaran un admin, el bloqueo del otro
    // describe las rechazaría y el test mediría otra cosa.
    const rol = (roles.body as Rol[]).find((r) => !r.esFijo);
    expect(rol).toBeTruthy();
    rolNoAdminId = rol!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Un miembro nuevo con un garzón propio vinculado a su cuenta. */
  async function miembroConGarzon(): Promise<{
    usuarioId: string;
    garzon: GarzonResponse;
  }> {
    const alta = await request(app.getHttpServer())
      .post('/api/tenants/usuarios')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: 'Garzon',
        apellido: 'Propio',
        correo: correoNuevo('garzon'),
        rolIds: [rolNoAdminId],
      });
    expect(alta.status).toBe(201);
    const usuarioId = (alta.body as AltaResponse).usuarioId;

    const creado = await request(app.getHttpServer())
      .post('/api/garzones')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `E2E Baja ${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        usuarioId,
      });
    expect(creado.status).toBe(201);
    const garzon = creado.body as GarzonResponse;
    // El estado de partida: con cuenta y SIN PIN usable. Si naciera con PIN,
    // la baja no lo dejaría sin nada y estos tests no probarían el bug.
    expect(garzon.usuarioId).toBe(usuarioId);
    expect(garzon.pinFijado).toBe(false);
    return { usuarioId, garzon };
  }

  async function ficha(garzonId: string): Promise<GarzonResponse> {
    const res = await request(app.getHttpServer())
      .get('/api/garzones')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const fila = (res.body as GarzonResponse[]).find((g) => g.id === garzonId);
    expect(fila).toBeTruthy();
    return fila!;
  }

  it('sin decidir qué pasa con el garzón, la baja se rechaza y no borra nada', async () => {
    const { usuarioId, garzon } = await miembroConGarzon();

    const res = await request(app.getHttpServer())
      .delete(`/api/tenants/members/${usuarioId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    // Nombra al garzón: un 400 genérico no le dice al admin qué está por romper.
    expect((res.body as { message: string }).message).toContain(garzon.nombre);

    const miembros = await request(app.getHttpServer())
      .get('/api/tenants/members')
      .set('Authorization', `Bearer ${token}`);
    expect(miembros.status).toBe(200);
    expect(
      (miembros.body as { usuarioId: string }[]).some(
        (m) => m.usuarioId === usuarioId,
      ),
    ).toBe(true);
  });

  it('"sigue trabajando": se desvincula, y el PIN que vuelve es usable', async () => {
    const { usuarioId, garzon } = await miembroConGarzon();

    const res = await request(app.getHttpServer())
      .delete(`/api/tenants/members/${usuarioId}?garzon=sigue`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as BajaResponse;
    expect(body.garzon).toMatchObject({
      id: garzon.id,
      accion: 'desvinculado',
    });
    expect(body.garzon!.pin).toMatch(/^\d{6}$/);

    const despues = await ficha(garzon.id);
    expect(despues.usuarioId).toBeNull();
    expect(despues.activo).toBe(true);
    // `pinFijado` sale de comparar contra el centinela inutilizable: es la
    // única forma de afirmar que el PIN devuelto sirve para algo. Sin esto, un
    // PIN de 6 dígitos que no se escribió pasaría el test igual.
    expect(despues.pinFijado).toBe(true);

    // Y queda registrado con su propio tipo: el historial es lo que hace
    // legible el patrón, y un PIN que aparece sin explicación no lo es. El
    // `CHECK` de `garzon_pin_evento` rechazaría un tipo que no exista, así que
    // esto también prueba que la constraint conoce el valor nuevo.
    const historia = await request(app.getHttpServer())
      .get(`/api/garzones/${garzon.id}/pin-eventos`)
      .set('Authorization', `Bearer ${token}`);
    expect(historia.status).toBe(200);
    const eventos = (historia.body as { eventos: { tipo: string }[] }).eventos;
    expect(eventos.map((e) => e.tipo)).toContain(
      'regenerado_por_baja_de_cuenta',
    );
  });

  /**
   * ⚠️ **Este test NO prueba la relectura dentro de la transacción**, aunque el
   * escenario se le parezca. Acá la re-vinculación pasa **antes** del `DELETE`,
   * así que `vinculadoA` ya no encuentra nada y `removeMember` corta antes de
   * llamar a `aplicarBajaDeCuenta`: sale por el mismo camino que una baja sin
   * garzón. Escrito primero como prueba del fix, y medido el 2026-08-16 que
   * pasa idéntico con el bug puesto — la ventana real (entre la lectura previa
   * y el `BEGIN`) no es alcanzable por HTTP. Eso lo cubre
   * `garzones.service.spec.ts` → *"aplicarBajaDeCuenta — la relectura dentro de
   * la transacción"*.
   *
   * Lo que sí prueba, y vale tenerlo: que la baja **se guía por el vínculo
   * vigente y no por el que hubo alguna vez**, así que un garzón que ya es de
   * otra persona no se toca.
   */
  it('un garzón que ya es de otra cuenta no se toca al dar de baja a la primera', async () => {
    const { usuarioId, garzon } = await miembroConGarzon();
    const otro = await miembroConGarzon();

    // El tercero se queda con el garzón del primero.
    await request(app.getHttpServer())
      .patch(`/api/garzones/${garzon.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ usuarioId: null })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/garzones/${otro.garzon.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ usuarioId: null })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/garzones/${garzon.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ usuarioId: otro.usuarioId })
      .expect(200);

    // La baja del primero ya no encuentra vínculo suyo: se hace, y no toca
    // nada del garzón.
    const res = await request(app.getHttpServer())
      .delete(`/api/tenants/members/${usuarioId}?garzon=sigue`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as BajaResponse).garzon).toBeNull();

    const despues = await ficha(garzon.id);
    expect(despues.usuarioId).toBe(otro.usuarioId);
    // Y su PIN sigue muerto, que es lo correcto para un garzón vinculado: si
    // esta baja se lo hubiera pisado, acá saldría `true` y el número estaría en
    // manos de otra persona.
    expect(despues.pinFijado).toBe(false);
  });

  it('"no sigue": el garzón queda inactivo y no se promete ningún PIN', async () => {
    const { usuarioId, garzon } = await miembroConGarzon();

    const res = await request(app.getHttpServer())
      .delete(`/api/tenants/members/${usuarioId}?garzon=no-sigue`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body as BajaResponse;
    expect(body.garzon).toMatchObject({
      id: garzon.id,
      accion: 'desactivado',
      pin: null,
    });

    const despues = await ficha(garzon.id);
    expect(despues.activo).toBe(false);
    // Sigue vinculado: la cuenta ya no es miembro, pero rehacer la baja es
    // reversible justamente porque el vínculo no se destruyó.
    expect(despues.usuarioId).toBe(usuarioId);
  });

  it('una baja sin garzón vinculado sigue siendo el caso simple', async () => {
    const alta = await request(app.getHttpServer())
      .post('/api/tenants/usuarios')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: 'Sin',
        apellido: 'Garzon',
        correo: correoNuevo('simple'),
        rolIds: [rolNoAdminId],
      });
    expect(alta.status).toBe(201);

    const res = await request(app.getHttpServer())
      .delete(`/api/tenants/members/${(alta.body as AltaResponse).usuarioId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect((res.body as BajaResponse).garzon).toBeNull();
  });

  it('repetir la baja de alguien que ya no es miembro es 404, no una segunda decisión', async () => {
    const { usuarioId, garzon } = await miembroConGarzon();

    await request(app.getHttpServer())
      .delete(`/api/tenants/members/${usuarioId}?garzon=no-sigue`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // El mismo DELETE otra vez, ahora pidiendo la OTRA salida. Sin el chequeo
    // de membresía viva esto respondía 200 y ejecutaba la decisión de nuevo:
    // desvinculaba y emitía un PIN sin que hubiera ninguna baja que dar.
    const segunda = await request(app.getHttpServer())
      .delete(`/api/tenants/members/${usuarioId}?garzon=sigue`)
      .set('Authorization', `Bearer ${token}`);
    expect(segunda.status).toBe(404);

    const despues = await ficha(garzon.id);
    expect(despues.usuarioId).toBe(usuarioId);
    expect(despues.pinFijado).toBe(false);
  });

  /**
   * La salida "sigue" sobre un garzón DESACTIVADO. Alcanzable sin que nadie
   * haya hecho nada raro: `PATCH /garzones/:id` deja desactivar un garzón
   * vinculado (no hay guard que lo impida), y quien da la baja de la cuenta no
   * necesariamente sabe en qué estado quedó el garzón.
   *
   * Hasta el 2026-08-16 la respuesta decía `accion: 'desvinculado'` con un PIN
   * de 6 dígitos en claro —la única vez que existe fuera de la base— que **no
   * opera**, porque `verificarPin` filtra `activo: true`. Nadie se enteraba
   * hasta que la persona lo tecleaba.
   */
  it('"sigue" sobre un garzón DESACTIVADO devuelve el PIN igual, pero avisa que no va a funcionar', async () => {
    const { usuarioId, garzon } = await miembroConGarzon();

    await request(app.getHttpServer())
      .patch(`/api/garzones/${garzon.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ activo: false })
      .expect(200);

    const res = await request(app.getHttpServer())
      .delete(`/api/tenants/members/${usuarioId}?garzon=sigue`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const baja = (res.body as BajaResponse).garzon;
    expect(baja).toBeTruthy();

    // Advierte, NO bloquea: el PIN se emite igual. Quien da la baja puede
    // tener razones para quererlo —va a reactivar al garzón después—, y
    // negárselo lo dejaría sin ninguna credencial que entregar.
    expect(baja!.accion).toBe('desvinculado');
    expect(baja!.pin).toMatch(/^\d{6}$/);
    expect(baja!.advertencias.join(' ')).toContain('desactivado');

    // Y la advertencia es CIERTA, que es lo que la hace algo más que un texto:
    // ese PIN no abre nada mientras el garzón siga desactivado.
    const intento = await request(app.getHttpServer())
      .post('/api/garzones/verificar-pin')
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: garzon.id, pin: baja!.pin });
    expect(intento.status).toBe(400);
  });

  it('"sigue" sobre un garzón ACTIVO no advierte nada: ahí el PIN sí opera', async () => {
    // El contraste que hace falsable al de arriba: sin esto, un `advertencias`
    // con el texto puesto siempre pasaría los dos.
    const { usuarioId, garzon } = await miembroConGarzon();

    const res = await request(app.getHttpServer())
      .delete(`/api/tenants/members/${usuarioId}?garzon=sigue`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const baja = (res.body as BajaResponse).garzon;
    expect(baja!.advertencias).toEqual([]);

    const intento = await request(app.getHttpServer())
      .post('/api/garzones/verificar-pin')
      .set('Authorization', `Bearer ${token}`)
      .send({ garzonId: garzon.id, pin: baja!.pin });
    expect(intento.status).toBe(200);
  });
});
