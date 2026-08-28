import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * Modo personal del garzón, contra Postgres real.
 *
 * Lo que ningún unit puede probar acá: que el `LEFT JOIN` del resolver compile
 * y que las tres ramas se comporten distinto **según con qué cuenta se opera**,
 * que es información que vive en la base y no en un parámetro.
 *
 * ⚠️ El test que sostiene todo es el del tótem sin credencial: `garzonId` y
 * `pin` son opcionales en el DTO —tienen que serlo, porque en modo personal no
 * se mandan—, así que el `ValidationPipe` deja pasar un body vacío. Si el
 * resolver no cortara, el PIN sería salteable en los 6 lugares donde se pide.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const GARZON_ANA = '550e8400-e29b-41d4-a716-446655440238';
// Bruno Díaz: garzón del seed SIN vincular, con PIN de dev conocido
// (`222222`). Lo necesita el test "el tótem opera como siempre" de acá
// abajo — Ana ya no sirve para esa mitad (ver el docblock del describe).
const GARZON_BRUNO = '550e8400-e29b-41d4-a716-446655440239';

/** Vinculada al garzón Ana Torres: opera sin PIN. */
const PERSONAL = { email: 'ana.torres@paris.cl', pass: 'admin' };
/** Marcada `es_totem`: siempre pide PIN, aunque se la vincule. */
const TOTEM = { email: 'totem@paris.cl', pass: 'admin' };
/** Sin vínculo ni marca: el camino de siempre. */
const ADMIN_PARIS = { email: 'admin.paris@paris.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}

describe('Modo personal del garzón (e2e)', () => {
  let app: INestApplication<App>;
  let tokenPersonal: string;
  let tokenTotem: string;
  let tokenAdmin: string;

  async function tokenDe(email: string, password: string): Promise<string> {
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });
    expect(login.status).toBe(200);
    const res = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
      .set(
        'Authorization',
        `Bearer ${(login.body as TokenResponse).access_token}`,
      )
      .send({ tenantId: PARIS_TENANT_ID });
    expect(res.status).toBe(200);
    return (res.body as TokenResponse).access_token;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    // `switch-tenant` y `refresh` leen `req.cookies`, y `cookieParser` vive en
    // `main.ts`, que el e2e no ejecuta. Sin esto los dos cortan con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    tokenPersonal = await tokenDe(PERSONAL.email, PERSONAL.pass);
    tokenTotem = await tokenDe(TOTEM.email, TOTEM.pass);
    tokenAdmin = await tokenDe(ADMIN_PARIS.email, ADMIN_PARIS.pass);
  });

  afterAll(async () => {
    await app.close();
  });

  const miVinculo = (token: string) =>
    request(app.getHttpServer())
      .get('/api/garzones/mi-vinculo')
      .set('Authorization', `Bearer ${token}`);

  describe('en qué modo está el dispositivo', () => {
    it('la cuenta vinculada devuelve su garzón', async () => {
      const res = await miVinculo(tokenPersonal);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        garzonId: GARZON_ANA,
        nombre: 'Ana Torres',
      });
    });

    it('una cuenta sin vínculo devuelve null: la pantalla pide PIN', async () => {
      const res = await miVinculo(tokenAdmin);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    // El override duro. La cuenta del tótem NO está vinculada en el seed, así
    // que este caso se arma acá: se la vincula por SQL —la API lo prohíbe, que
    // es justamente la otra mitad de la regla— y se comprueba que el marcador
    // gana igual.
    it('marcada como tótem devuelve null AUNQUE tenga un garzón vinculado', async () => {
      const dataSource = app.get(DataSource);
      const [{ usuario_id: totemId }] = await dataSource.query<
        { usuario_id: string }[]
      >(`SELECT usuario_id FROM usuarios WHERE correo = $1`, [TOTEM.email]);
      const [{ garzon_id: bruno }] = await dataSource.query<
        { garzon_id: string }[]
      >(
        `SELECT garzon_id FROM garzones
          WHERE tenant_id = $1 AND usuario_id IS NULL AND es_placeholder = false
            AND eliminado_el IS NULL LIMIT 1`,
        [PARIS_TENANT_ID],
      );

      await dataSource.query(
        `UPDATE garzones SET usuario_id = $1 WHERE garzon_id = $2`,
        [totemId, bruno],
      );
      try {
        const res = await miVinculo(tokenTotem);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({});
      } finally {
        await dataSource.query(
          `UPDATE garzones SET usuario_id = NULL WHERE garzon_id = $1`,
          [bruno],
        );
      }
    });
  });

  describe('operar sin PIN, y el corte que lo hace posible', () => {
    /**
     * ⚠️ Pega en `/activa` y NO en `/iniciar`. El nombre importa: mientras se
     * llamó `iniciarSesion`, este helper hacía parecer que el inicio de turno
     * estaba cubierto — y no lo estaba. `/activa` es además el único de los
     * tres endpoints de sesión que el frontend nunca llama.
     */
    const consultarSesion = (token: string, body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post('/api/sesiones-garzon/activa')
        .set('Authorization', `Bearer ${token}`)
        .send(body);

    it('la cuenta vinculada consulta su sesión SIN mandar garzón ni PIN', async () => {
      const res = await consultarSesion(tokenPersonal, {});

      // 201 (POST sin `@HttpCode`) con la sesión o con `null` si no tiene una
      // abierta: lo que importa es que NO es el 400 de "elegí el garzón".
      expect(res.status).toBe(201);
    });

    // ⚠️ EL test de la fase.
    it('una cuenta NO vinculada sin credencial recibe 400, no opera', async () => {
      const res = await consultarSesion(tokenAdmin, {});

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain(
        'Elegí el garzón',
      );
    });

    it('la cuenta marcada tótem tampoco zafa: sin credencial es 400', async () => {
      const res = await consultarSesion(tokenTotem, {});

      expect(res.status).toBe(400);
    });

    it('y con credencial válida el tótem opera como siempre', async () => {
      // Bruno, no Ana: hasta el 2026-08-14 este test usaba a Ana (vinculada)
      // para probar DOS afirmaciones a la vez — "el tótem opera con
      // credencial válida" y "un vinculado sigue siendo alcanzable por
      // PIN". `6758e7b2` mató la segunda a propósito (vincular invalida el
      // PIN), así que las dos afirmaciones se separaron (revisión
      // independiente, misma fecha): esta mitad, la que SIGUE siendo
      // cierta, se mudó a un garzón sin vincular; la otra mitad, la que
      // DEJÓ de serlo, es el test negativo de abajo, con Ana.
      const res = await consultarSesion(tokenTotem, {
        garzonId: GARZON_BRUNO,
        pin: '222222',
      });

      expect(res.status).toBe(201);
    });

    /**
     * La otra mitad de "opera como siempre" (split 2026-08-14, revisión
     * independiente): antes de `6758e7b2` esta MISMA credencial —el
     * `garzonId` de Ana, vinculada, con su PIN de dev `111111`— dejaba
     * entrar al tótem con 201. Vincular invalida el PIN
     * (`GarzonesService.actualizar()`), así que ahora tiene que dar 400. No
     * es una prueba sola, son DOS mitades de la misma afirmación
     * ("vinculado, alcanzable por el tótem"), y las dos tienen que valer
     * para que el test pruebe algo:
     *
     * - Que Ana SIGUE en el selector del tótem — es la decisión deliberada
     *   que sostiene `docs/features/garzones.md` ("El garzón sin PIN
     *   usable sigue apareciendo en el selector") y
     *   `docs/superpowers/specs/2026-08-14-pin-propio-garzon-design.md:109`:
     *   esconderlo filtraría quién tiene cuenta y quién no. Sin esta
     *   mitad, un test que solo mirara el 400 de abajo no distinguiría
     *   "invalidado por vinculación" de "el selector ya no la ofrece", que
     *   es un bug MUY distinto y mucho peor (le esconde al encargado que
     *   Ana existe).
     * - Que su PIN VIEJO Y REAL (`111111`, el mismo que hasta ayer abría la
     *   puerta) ya no sirve — no un PIN inventado. Con uno inventado el
     *   400 llegaría igual por "PIN incorrecto" de toda la vida, y el test
     *   pasaría en verde sin haber probado la invalidación (mismo
     *   anti-patrón que se corrigió en `caja-testigo.e2e-spec.ts` dos
     *   rounds atrás: un mutante que revierte `garzon.pinHash =
     *   PIN_INUTILIZABLE` tiene que hacer caer ESTE assert).
     */
    it('un garzón vinculado sigue en el selector del tótem, pero su PIN viejo ya no abre la puerta', async () => {
      const pedirSelector = (enTurno: boolean) =>
        request(app.getHttpServer())
          .get(`/api/garzones/para-selector?enTurno=${enTurno}`)
          .set('Authorization', `Bearer ${tokenTotem}`);

      // Las dos listas son complementarias por construcción
      // (`garzones-selector.e2e-spec.ts` ya lo prueba); acá no importa en
      // cuál de las dos cae Ana —depende de si algún otro spec le dejó una
      // sesión abierta—, solo que esté en alguna. `enTurno` filtra por
      // sesión abierta, nunca por vínculo.
      const [fuera, dentro] = await Promise.all([
        pedirSelector(false),
        pedirSelector(true),
      ]);
      expect(fuera.status).toBe(200);
      expect(dentro.status).toBe(200);
      const ids = [
        ...(fuera.body as { garzonId: string }[]),
        ...(dentro.body as { garzonId: string }[]),
      ].map((g) => g.garzonId);
      expect(ids).toContain(GARZON_ANA);

      // El PIN que hasta el 2026-08-14 la identificaba de verdad: no uno
      // inventado.
      const res = await consultarSesion(tokenTotem, {
        garzonId: GARZON_ANA,
        pin: '111111',
      });

      expect(res.status).toBe(400);
      // El motivo, no solo el número (misma vara que
      // `caja-testigo.e2e-spec.ts`, "El motivo, no solo el número"): sin
      // esto, un 400 por cualquier otra causa —el `ValidationPipe`, un
      // guard, un 404 disfrazado— pasaría igual, y no probaría que
      // `verificarPin`/`bcrypt.compare` corrió de verdad contra el
      // `pin_hash` muerto de Ana.
      expect((res.body as { message: string }).message).toContain(
        'PIN inválido',
      );
    });
  });

  /**
   * ⚠️ Los DOS endpoints que el frontend sí usa, y que estaban rotos: la
   * pantalla mandaba `pin: ''` en modo personal, y el `@IsOptional()` de
   * class-validator **no saltea el string vacío**, así que el `@Matches` lo
   * rechazaba con 400. Sin turno no se puede abrir ninguna cuenta, o sea que el
   * modo personal entero quedaba inoperable.
   *
   * El e2e anterior no lo veía porque ejercitaba `/activa`, el único de los tres
   * que el frontend nunca llama.
   */
  describe('el ciclo de turno completo en modo personal', () => {
    it('entra y sale de turno sin mandar credencial', async () => {
      const turnos = await request(app.getHttpServer())
        .get('/api/turnos')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const turnoId = (turnos.body as { id: string; activo: boolean }[]).find(
        (t) => t.activo,
      )!.id;

      const entrar = await request(app.getHttpServer())
        .post('/api/sesiones-garzon/iniciar')
        .set('Authorization', `Bearer ${tokenPersonal}`)
        .send({ turnoId });
      expect(entrar.status).toBe(201);

      const salir = await request(app.getHttpServer())
        .post('/api/sesiones-garzon/cerrar')
        .set('Authorization', `Bearer ${tokenPersonal}`)
        .send({});
      expect(salir.status).toBe(201);
    });

    // La otra mitad: el corte sigue en pie para quien no tiene vínculo.
    it('sin vínculo, entrar a turno sin credencial es 400', async () => {
      const turnos = await request(app.getHttpServer())
        .get('/api/turnos')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const turnoId = (turnos.body as { id: string; activo: boolean }[]).find(
        (t) => t.activo,
      )!.id;

      const res = await request(app.getHttpServer())
        .post('/api/sesiones-garzon/iniciar')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ turnoId });

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain(
        'Elegí el garzón',
      );
    });
  });

  describe('las dos reglas que impiden configurar una contradicción', () => {
    const vincular = (garzonId: string, usuarioId: string | null) =>
      request(app.getHttpServer())
        .patch(`/api/garzones/${garzonId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ usuarioId });

    it('no se puede vincular una cuenta marcada como tótem', async () => {
      const members = await request(app.getHttpServer())
        .get('/api/tenants/members')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const totem = (
        members.body as { usuarioId: string; correo: string }[]
      ).find((m) => m.correo === TOTEM.email)!;

      const res = await vincular(GARZON_ANA, totem.usuarioId);

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain('tótem');
    });

    it('no se puede marcar tótem a una cuenta que ya es un garzón', async () => {
      const members = await request(app.getHttpServer())
        .get('/api/tenants/members')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const ana = (
        members.body as { usuarioId: string; correo: string }[]
      ).find((m) => m.correo === PERSONAL.email)!;

      const res = await request(app.getHttpServer())
        .patch(`/api/tenants/members/${ana.usuarioId}/totem`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ esTotem: true });

      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toContain('Ana Torres');
    });

    // Un UUID que no es de nadie: todos los usuarios sembrados SON miembros de
    // Paris, así que no hay a quién usar de contraejemplo. Vincular una cuenta
    // ajena no daría acceso —igual hace falta token de este tenant— pero
    // dejaría un vínculo que nadie puede ejercer.
    // Era un 500 crudo: lo enforceaba solo el índice único, y el selector
    // ofrecía la cuenta igual. El admin la elegía y comía "Internal server
    // error" mientras los otros dos casos inválidos sí le decían qué hacer.
    it('vincular una cuenta que ya es otro garzón da 409 con nombre, no 500', async () => {
      const otros = await request(app.getHttpServer())
        .get('/api/garzones')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const otroGarzon = (
        otros.body as { id: string; usuarioId: string | null }[]
      ).find((g) => g.id !== GARZON_ANA && !g.usuarioId)!;

      const members = await request(app.getHttpServer())
        .get('/api/tenants/members')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const ana = (
        members.body as { usuarioId: string; correo: string }[]
      ).find((m) => m.correo === PERSONAL.email)!;

      const res = await vincular(otroGarzon.id, ana.usuarioId);

      expect(res.status).toBe(409);
      expect((res.body as { message: string }).message).toContain('Ana Torres');
    });

    // ⚠️ `garzones` tiene DOS índices únicos parciales, y restaurar puede chocar
    // con cualquiera de los dos. Con un mensaje fijo, el admin recibía la
    // explicación del placeholder "Mostrador" —otro garzón, otra regla— cuando
    // lo que tenía que hacer era desvincular una cuenta. El camino se recorre
    // entero con acciones que la pantalla ofrece.
    it('restaurar un garzón cuya cuenta ya tomó otro explica ESO, no "Mostrador"', async () => {
      // ⚠️ Todo el escenario se arma con material NUEVO —una cuenta dada de alta
      // acá y dos garzones creados acá— en vez de reusar el tótem y a Ana
      // Torres del seed. La primera versión de este test los usaba y les
      // sobreescribía el vínculo sin devolverlo: la segunda corrida sobre la
      // misma base tiraba 7 de 14, y el daño **no se reparaba solo** porque
      // `seedGarzones` es `if (!exists) save` y nunca vuelve a tocar
      // `usuario_id`. Un `finally` lo habría tapado; no depender del seed lo
      // elimina.
      // Por NOMBRE y no por posición: `roles[0]` es `Administrador`, así que
      // cada corrida sumaba un admin del tenant a Paris para un escenario que
      // solo necesita "una cuenta que sea miembro". Y depender del orden de la
      // lista deja el test verde mientras el residuo cambia en silencio.
      const roles = await request(app.getHttpServer())
        .get('/api/roles')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      const rolId = (roles.body as { id: string; nombre: string }[]).find(
        (r) => r.nombre === 'Salón',
      )!.id;

      const alta = await request(app.getHttpServer())
        .post('/api/tenants/usuarios')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          nombre: 'Cuenta disputada',
          correo: `disputada-${Date.now()}@paris.cl`,
          rolIds: [rolId],
        });
      const usuarioId = (alta.body as { usuarioId: string }).usuarioId;

      const crearGarzon = async (nombre: string) => {
        const res = await request(app.getHttpServer())
          .post('/api/garzones')
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ nombre });
        expect(res.status).toBe(201);
        return (res.body as { id: string }).id;
      };
      const primero = await crearGarzon(`Primero ${Date.now()}`);
      const segundo = await crearGarzon(`Segundo ${Date.now()}`);

      expect((await vincular(primero, usuarioId)).status).toBe(200);
      await request(app.getHttpServer())
        .delete(`/api/garzones/${primero}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      // El `usuario_id` sobrevive al soft delete, pero el índice único es
      // parcial sobre filas vivas: la cuenta queda libre y otro se la lleva.
      expect((await vincular(segundo, usuarioId)).status).toBe(200);

      const res = await request(app.getHttpServer())
        .post(`/api/garzones/${primero}/restaurar`)
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(res.status).toBe(409);
      const mensaje = (res.body as { message: string }).message;
      expect(mensaje).toContain('cuenta');
      // Lo que NO puede decir: el placeholder no tiene nada que ver acá.
      expect(mensaje).not.toContain('Mostrador');
    });

    it('no se puede vincular una cuenta que no es miembro del tenant', async () => {
      const res = await vincular(
        GARZON_ANA,
        '00000000-0000-4000-8000-000000000000',
      );

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain(
        'no es miembro',
      );
    });
  });
});
