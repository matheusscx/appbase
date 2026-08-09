import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * Alta de usuarios del tenant, contra Postgres real.
 *
 * Lo que ningún unit puede probar acá: que el `INSERT ... ON CONFLICT` de roles
 * compile, que la transacción revierta de verdad, y sobre todo **el par que
 * define la feature** — un usuario con la contraseña temporal sin cambiar no
 * obtiene token de tenant, pero sí puede cambiarla.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const FALABELLA_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';

const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };
const VENDEDOR_PARIS = { email: 'vendedor@paris.cl', pass: 'admin' };
/** Sembrado con `debe_cambiar_contrasena = true` y **miembro de Paris**. */
const TEMPORAL = { email: 'temporal@paris.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}
interface AltaResponse {
  usuarioId: string;
  correo: string;
  contrasenaTemporal?: string;
}
interface Member {
  usuarioId: string;
  correo: string;
  roles: { rolId: string }[];
}

/** Login sin elegir tenant: devuelve el token "suelto". */
async function loginSuelto(
  app: INestApplication<App>,
  email: string,
  password: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password });
  return (res.body as TokenResponse).access_token;
}

describe('Alta de usuarios del tenant (e2e)', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let rolIdParis: string;
  /** Un segundo rol, para poder distinguir "quedaron estos" de "se sumaron". */
  let rolIdParisOtro: string;
  let tokenFalabella: string;
  let rolIdFalabella: string;

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

    const suelto = await loginSuelto(app, ADMIN_PARIS.email, ADMIN_PARIS.pass);
    const conTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Authorization', `Bearer ${suelto}`)
      .send({ tenantId: PARIS_TENANT_ID });
    tokenAdmin = (conTenant.body as TokenResponse).access_token;

    const roles = await request(app.getHttpServer())
      .get('/api/roles')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    rolIdParis = (roles.body as { id: string }[])[0].id;
    rolIdParisOtro = (roles.body as { id: string }[])[1].id;

    // El otro tenant sembrado. Su único miembro es `admin@sistema.com`, con rol
    // Administrador, así que sirve para las dos cosas que necesitan un tenant
    // ajeno: un rol que no es de Paris, y un admin que puede dar de alta ahí.
    const sueltoSistema = await loginSuelto(app, 'admin@sistema.com', 'admin');
    const enFalabella = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Authorization', `Bearer ${sueltoSistema}`)
      .send({ tenantId: FALABELLA_TENANT_ID });
    tokenFalabella = (enFalabella.body as TokenResponse).access_token;

    const rolesFalabella = await request(app.getHttpServer())
      .get('/api/roles')
      .set('Authorization', `Bearer ${tokenFalabella}`);
    rolIdFalabella = (rolesFalabella.body as { id: string }[])[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  const alta = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/tenants/usuarios')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send(body);

  /** Correo irrepetible: la suite corre contra una base que ya tiene datos. */
  function correoNuevo(marca: string): string {
    return `alta-${marca}-${Date.now()}@paris.cl`;
  }

  describe('el par que define la feature', () => {
    it('con la contraseña temporal sin cambiar NO se puede entrar a un tenant', async () => {
      const suelto = await loginSuelto(app, TEMPORAL.email, TEMPORAL.pass);
      expect(suelto).toBeTruthy(); // el login sí funciona

      const res = await request(app.getHttpServer())
        .post('/api/auth/switch-tenant')
        .set('Authorization', `Bearer ${suelto}`)
        .send({ tenantId: PARIS_TENANT_ID });

      expect(res.status).toBe(403);
      const body = res.body as { message: string; codigo: string };
      // ⚠️ El mensaje importa: el usuario ES miembro de Paris, así que un 403 de
      // "no perteneces a este tenant" significaría que el test pasa por la razón
      // equivocada y el flag no lo está frenando nada.
      expect(body.message).toContain('contraseña temporal');
      // Y el `codigo` es contrato con el front, no decoración: el store mira
      // este string exacto para desviar a `/cambiar-contrasena`, que es la única
      // salida. Renombrarlo de un solo lado encierra a todo usuario nuevo.
      expect(body.codigo).toBe('DEBE_CAMBIAR_CONTRASENA');
    });

    it('y SÍ puede cambiar su contraseña, que es la única salida', async () => {
      const suelto = await loginSuelto(app, TEMPORAL.email, TEMPORAL.pass);

      const res = await request(app.getHttpServer())
        .patch('/api/me/contrasena')
        .set('Authorization', `Bearer ${suelto}`)
        .send({
          contrasenaActual: TEMPORAL.pass,
          contrasenaNueva: 'nueva-clave-123',
          confirmarContrasena: 'nueva-clave-123',
        });

      expect(res.status).toBe(200);

      // Y con eso el tenant se abre.
      const conNueva = await loginSuelto(
        app,
        TEMPORAL.email,
        'nueva-clave-123',
      );
      const switched = await request(app.getHttpServer())
        .post('/api/auth/switch-tenant')
        .set('Authorization', `Bearer ${conNueva}`)
        .send({ tenantId: PARIS_TENANT_ID });

      expect(switched.status).toBe(200);
      expect((switched.body as TokenResponse).access_token).toBeTruthy();
    });
  });

  describe('los tres caminos del alta', () => {
    it('correo nuevo: crea, asocia, asigna roles y devuelve la temporal una vez', async () => {
      const correo = correoNuevo('nuevo');

      const res = await alta({ nombre: 'Nuevo', correo, rolIds: [rolIdParis] });

      expect(res.status).toBe(201);
      const body = res.body as AltaResponse;
      // Solo forma y largo. Que el alfabeto no tenga caracteres ambiguos se
      // afirma sobre el alfabeto en `tenants.service.spec.ts`, no acá: una
      // muestra de 12 caracteres no contiene ninguno ~15% de las veces aunque
      // el alfabeto los tenga, y el test sería intermitente.
      expect(body.contrasenaTemporal).toMatch(/^[A-Za-z0-9]{12}$/);
      expect(body.usuarioId).toBeTruthy();

      // Quedó miembro y con el rol: crear sin rol sería crear algo roto.
      const members = await request(app.getHttpServer())
        .get('/api/tenants/members')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const creado = (members.body as Member[]).find(
        (m) => m.correo === correo,
      );
      expect(creado).toBeTruthy();
      expect(creado!.roles.map((r) => r.rolId)).toContain(rolIdParis);

      // Y arranca frenado: la temporal no sirve para entrar a ningún tenant.
      const suelto = await loginSuelto(app, correo, body.contrasenaTemporal!);
      const switched = await request(app.getHttpServer())
        .post('/api/auth/switch-tenant')
        .set('Authorization', `Bearer ${suelto}`)
        .send({ tenantId: PARIS_TENANT_ID });
      expect(switched.status).toBe(403);
    });

    // La decisión central del owner —"si el correo ya existe, se asocia"— y el
    // único camino de los tres que no pasa por crear una cuenta. El fixture es
    // el otro tenant sembrado: sin él, un usuario de Paris ya es miembro de
    // Paris y este camino no se puede alcanzar desde la API.
    it('correo que existe pero NO es miembro: se asocia sin tocarle la contraseña', async () => {
      const correo = correoNuevo('otro-tenant');
      const primera = await alta({
        nombre: 'Compartido',
        correo,
        rolIds: [rolIdParis],
      });
      expect(primera.status).toBe(201);
      const { contrasenaTemporal } = primera.body as AltaResponse;

      const res = await request(app.getHttpServer())
        .post('/api/tenants/usuarios')
        .set('Authorization', `Bearer ${tokenFalabella}`)
        .send({ nombre: 'Compartido', correo, rolIds: [rolIdFalabella] });

      expect(res.status).toBe(201);
      // Sin temporal: la cuenta es de esa persona, no del admin que la suma. Una
      // temporal acá significaría que le pisaron la contraseña.
      expect((res.body as AltaResponse).contrasenaTemporal).toBeUndefined();

      const miembrosFalabella = await request(app.getHttpServer())
        .get('/api/tenants/members')
        .set('Authorization', `Bearer ${tokenFalabella}`);
      expect(
        (miembrosFalabella.body as Member[]).some((m) => m.correo === correo),
      ).toBe(true);

      // ⚠️ Y sus roles del OTRO tenant siguen vivos. El alta da de baja los roles
      // que no vinieron, pero acotado a `tenant_id`: sin ese scoping, dar de alta
      // a alguien en un tenant le borraría los permisos en todos los demás —una
      // empresa dejando sin acceso al personal de otra— y el resto de la suite no
      // lo notaría.
      const miembrosParis = await request(app.getHttpServer())
        .get('/api/tenants/members')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const enParis = (miembrosParis.body as Member[]).find(
        (m) => m.correo === correo,
      );
      expect(enParis!.roles.map((r) => r.rolId)).toEqual([rolIdParis]);

      // Y la contraseña que ya tenía sigue sirviendo: es la afirmación que el
      // 201 por sí solo no hace.
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: correo, password: contrasenaTemporal });
      expect(login.status).toBe(200);
    });

    it('correo que ya es miembro: 409, y NO le toca los roles', async () => {
      const antes = await request(app.getHttpServer())
        .get('/api/tenants/members')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const vendedorAntes = (antes.body as Member[]).find(
        (m) => m.correo === VENDEDOR_PARIS.email,
      );

      const res = await alta({
        nombre: 'Vendedor',
        correo: VENDEDOR_PARIS.email,
        rolIds: [rolIdParis],
      });

      expect(res.status).toBe(409);

      const despues = await request(app.getHttpServer())
        .get('/api/tenants/members')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const vendedorDespues = (despues.body as Member[]).find(
        (m) => m.correo === VENDEDOR_PARIS.email,
      );
      // El motivo de que sea 409 y no idempotente: un 200 en silencio podría
      // haberle pisado los roles.
      expect(vendedorDespues!.roles.map((r) => r.rolId).sort()).toEqual(
        vendedorAntes!.roles.map((r) => r.rolId).sort(),
      );
    });
  });

  describe('los dos casos que el gate no veía', () => {
    // ⚠️ `UsuarioTenant` tiene `@DeleteDateColumn`, así que sin `withDeleted` la
    // consulta de membresía no ve la borrada: el alta respondía **201** y la
    // persona seguía afuera, con roles vivos y sin membresía. El admin veía
    // éxito y `switchTenant` le decía "no perteneces a este tenant".
    it('re-dar de alta a alguien eliminado del tenant lo vuelve a asociar de verdad', async () => {
      const correo = correoNuevo('re-alta');
      const primera = await alta({
        nombre: 'Vuelve',
        correo,
        rolIds: [rolIdParis],
      });
      expect(primera.status).toBe(201);
      const { usuarioId } = primera.body as AltaResponse;

      const baja = await request(app.getHttpServer())
        .delete(`/api/tenants/members/${usuarioId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(baja.status).toBe(204);

      // Vuelve con OTRO rol, no con el mismo: si volviera con el mismo, el test
      // no puede distinguir "quedaron los que elegí" de "se sumaron a los viejos".
      const segunda = await alta({
        nombre: 'Vuelve',
        correo,
        rolIds: [rolIdParisOtro],
      });
      expect(segunda.status).toBe(201);
      // No alcanza con el 201: lo que fallaba era justamente que respondía OK
      // sin asociar. Se afirma la membresía real.
      const members = await request(app.getHttpServer())
        .get('/api/tenants/members')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const vuelto = (members.body as Member[]).find(
        (m) => m.correo === correo,
      );
      expect(vuelto).toBeTruthy();
      // ⚠️ EXACTAMENTE los roles del alta, no la unión con los de antes.
      // `removeMember` da de baja la membresía pero deja vivas las filas de
      // `roles_usuarios`: sin dar de baja las que no vinieron, re-dar de alta a
      // alguien restituye en silencio sus permisos viejos —`Administrador`
      // incluido— encima de los que el admin acaba de elegir.
      expect(vuelto!.roles.map((r) => r.rolId)).toEqual([rolIdParisOtro]);
    });

    // La unique de Postgres es case-sensitive: sin comparar en minúsculas, el
    // mismo correo con otra caja creaba una SEGUNDA cuenta para la misma
    // persona, con contraseña temporal y todo.
    it('un correo que ya existe con otra caja de mayúsculas se asocia, no se duplica', async () => {
      const res = await alta({
        nombre: 'Vendedor',
        correo: VENDEDOR_PARIS.email.toUpperCase(),
        rolIds: [rolIdParis],
      });

      // Ya es miembro, así que el camino correcto es el 409 — no un 201 con
      // cuenta nueva, que es lo que pasaba antes.
      expect(res.status).toBe(409);
      expect((res.body as AltaResponse).contrasenaTemporal).toBeUndefined();
    });

    // La otra mitad del mismo problema, y la más cara: deduplicar en minúsculas
    // pero **guardar tal cual se tipeó** dejaba una cuenta que solo entra con esa
    // caja exacta. El admin tipea `Juan.Perez@…`, la persona tipea todo en
    // minúsculas, y como la temporal se muestra una sola vez y no hay reset, no
    // entra nunca. Se afirma sobre el login, no sobre el 201.
    it('un alta tipeada con mayúsculas entra igual escribiendo el correo en minúsculas', async () => {
      const correo = correoNuevo('caja');

      const res = await alta({
        nombre: 'Caja',
        correo: correo.toUpperCase(),
        rolIds: [rolIdParis],
      });

      expect(res.status).toBe(201);
      const body = res.body as AltaResponse;
      // La respuesta devuelve la forma canónica: es la que el admin le dicta.
      expect(body.correo).toBe(correo);

      const enMinusculas = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: correo, password: body.contrasenaTemporal });
      expect(enMinusculas.status).toBe(200);

      // Y la caja original tampoco queda afuera: el login no distingue.
      const comoLoTipeoElAdmin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({
          email: correo.toUpperCase(),
          password: body.contrasenaTemporal,
        });
      expect(comoLoTipeoElAdmin.status).toBe(200);
    });
  });

  // Para que el alta pueda entrar tipeando el correo en minúsculas,
  // `UsersService.findByEmail` pasó a comparar sin distinguir caja. Esa búsqueda
  // la comparten el login, el chequeo de duplicado del registro público y el
  // vínculo con Google, así que el radio es más ancho que esta feature y queda
  // fijado acá.
  describe('el radio de findByEmail, que no es solo el alta', () => {
    it('el registro público deja de crear una segunda cuenta con otra caja', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({
          nombre: 'Colado',
          correo: VENDEDOR_PARIS.email.toUpperCase(),
          contrasena: 'una-clave-larga-123',
        });

      expect(res.status).toBe(409);
    });
  });

  describe('lo que no se puede hacer', () => {
    it('rechaza un rol de OTRO tenant', async () => {
      const res = await alta({
        nombre: 'Colado',
        correo: correoNuevo('rol-ajeno'),
        rolIds: [rolIdFalabella],
      });

      expect(res.status).toBe(400);
    });

    it('sin roles responde 400, y NO deja un usuario huérfano', async () => {
      const correo = correoNuevo('sin-rol');

      const res = await alta({ nombre: 'Sin rol', correo, rolIds: [] });

      expect(res.status).toBe(400);
      const members = await request(app.getHttpServer())
        .get('/api/tenants/members')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect((members.body as Member[]).some((m) => m.correo === correo)).toBe(
        false,
      );
    });

    it('un no-admin del tenant no puede dar de alta', async () => {
      const suelto = await loginSuelto(
        app,
        VENDEDOR_PARIS.email,
        VENDEDOR_PARIS.pass,
      );
      const conTenant = await request(app.getHttpServer())
        .post('/api/auth/switch-tenant')
        .set('Authorization', `Bearer ${suelto}`)
        .send({ tenantId: PARIS_TENANT_ID });

      const res = await request(app.getHttpServer())
        .post('/api/tenants/usuarios')
        .set(
          'Authorization',
          `Bearer ${(conTenant.body as TokenResponse).access_token}`,
        )
        .send({
          nombre: 'X',
          correo: correoNuevo('no-admin'),
          rolIds: [rolIdParis],
        });

      expect(res.status).toBe(403);
    });
  });
});
