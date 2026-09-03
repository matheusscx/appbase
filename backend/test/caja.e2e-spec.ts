import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

// Supervisor: rol Administrador, es_fijo=true → short-circuit de permisos,
// incluye Cajas:Leer.
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

const FALABELLA_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';
// Miembro de los DOS tenants del seed: el arnés del aislamiento multi-tenant
// necesita la misma persona a ambos lados. Ver el describe del final.
const MULTI_TENANT = { email: 'admin@sistema.com', pass: 'admin' };

// Supervisor de verdad: rol 'Cajas · Supervisión' (es_fijo=false) con
// Cajas:Leer y NADA más. Ve todas las cajas y NO es admin del tenant — la
// combinación exacta a la que el modo ciego sí le aplica.
const SUPERVISOR_EMAIL = 'supervisor@paris.cl';
const SUPERVISOR_PASS = 'admin';

// Cajero: rol Vendedor, solo tiene MiCaja (sin Cajas).
// Nota: el seed usa el mismo hash de dev para todos los usuarios (password 'admin');
// ventas.e2e-spec.ts prueba con 'Vendedor1234!' pero ese test se salta en silencio
// si el login falla, por eso ese valor nunca se verificó.
const VENDEDOR_EMAIL = 'vendedor@paris.cl';
const VENDEDOR_PASS = 'admin';

// El encargado que fuerza el cierre sin ser admin del tenant (decisión del
// owner 2026-08-13): rol 'Cajas · Encargado' con Cajas:Leer + Cajas:Actualizar,
// y NO admin — la combinación exacta a la que el modo ciego sigue aplicando
// aun pudiendo forzar. Distinto de SUPERVISOR_EMAIL (solo Cajas:Leer, arnés
// del 403 de "no puede forzar sin Actualizar").
const ENCARGADO_EMAIL = 'encargado@paris.cl';
const ENCARGADO_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface CajaResponse {
  id: string;
}
interface CajonResponse {
  id: string;
}
interface CajonDisponible {
  cajonId: string;
}
interface Member {
  usuarioId: string;
  correo: string;
}
interface ArqueoLinea {
  metodoPagoId: string | null;
  nombre: string;
  esEfectivo: boolean;
  esperado: string;
  requiereConteo: boolean;
  contado?: string | null;
  diferencia?: string | null;
  motivoNombre?: string | null;
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
  const initialToken = (resLogin.body as TokenResponse).access_token;

  // Switch a tenant Paris para que el token cargue tenant_id
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

/**
 * Abre una caja física (sobre un cajón) para el usuario del token. Si ya
 * tiene una abierta (409 — residuo de una corrida local previa abortada),
 * la reutiliza vía GET /api/caja/activa en vez de fallar.
 */
async function abrirOReusarCaja(
  app: INestApplication<App>,
  token: string,
  cajonId: string,
): Promise<string> {
  const resAbrir = await request(app.getHttpServer())
    .post('/api/caja/abrir')
    .set('Authorization', `Bearer ${token}`)
    .send({
      cajonId,
      saldoInicial: '10000.0000',
      comentario: 'Apertura E2E caja',
    });

  if (resAbrir.status === 201) {
    return (resAbrir.body as CajaResponse).id;
  }

  // 409 esperado: ya existe una caja abierta para este usuario. Reusarla.
  const resActiva = await request(app.getHttpServer())
    .get('/api/caja/activa')
    .set('Authorization', `Bearer ${token}`);
  expect(resActiva.status).toBe(200);
  return (resActiva.body as CajaResponse).id;
}

/**
 * Cierre en dos fases (Task 3): fase 1 (`POST /:id/conteo`) congela el arqueo
 * y auto-cierra si cuadra, o pasa a `en_conciliacion` si alguna línea
 * descuadra. Si descuadra, esta función resuelve la fase 2 (`POST /:id/cerrar`)
 * con los motivos de `justificar` (vacío si no se pasa). Devuelve la respuesta
 * de la fase que terminó cerrando el flujo — `{estado, arqueo}` si auto-cerró
 * en fase 1, o `{caja, arqueo}` si necesitó la fase 2.
 *
 * **No afirma el status adentro, a propósito**: la mitad de los llamadores la
 * usan como higiene de `afterAll` y descartan la respuesta, así que una
 * aserción acá convertiría una limpieza fallida en un rojo del test. El que
 * lee el body de lo que devuelve afirma su `.status` (201) en el llamador.
 */
async function cerrarEnDosFases(
  app: INestApplication<App>,
  cajaId: string,
  token: string,
  contadas: any[],
  justificar?: any[],
) {
  const c = await request(app.getHttpServer())
    .post(`/api/caja/${cajaId}/conteo`)
    .set('Authorization', `Bearer ${token}`)
    .send({ lineas: contadas });
  // status-tolerante: cerrarEnDosFases no afirma adentro a propósito; el llamador que lee el body afirma su status
  if ((c.body as { estado?: string }).estado === 'en_conciliacion') {
    return request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/cerrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: justificar ?? [] });
  }
  return c;
}

/**
 * Higiene de `afterAll` para el cajero de un `describe`, tolerante a que la
 * caja ya haya quedado `en_conciliacion` (no solo `abierta`) — a diferencia
 * de `cerrarEnDosFases`, que asume que arranca desde `abierta` y no hace
 * nada si el conteo (fase 1) falla porque la caja ya pasó ese estado.
 *
 * Medido con el mutante de Task 6b (`puedeForzar=true` sin mirar el
 * permiso): un `it` que asevera 403 y en cambio recibe 201 dejó la caja del
 * cajero forzada a `en_conciliacion` ANTES de que la aserción fallida
 * abortara el resto del test — la higiene de ese `it` nunca corrió, y el
 * `afterAll` de entonces tampoco la liberaba (esperaba `abierta`). El
 * cajero quedaba atascado para la siguiente suite que use
 * `vendedor@paris.cl`. Best-effort a propósito (sin afirmar el status): es
 * una red de seguridad de `afterAll`, no una aserción del test.
 */
async function liberarCajeroSiQuedoOcupado(
  app: INestApplication<App>,
  tokenCajero: string,
  tokenAdmin: string,
): Promise<void> {
  const activa = await request(app.getHttpServer())
    .get('/api/caja/activa')
    .set('Authorization', `Bearer ${tokenCajero}`);
  // status-tolerante: red de limpieza: un rojo de la higiene taparía el del test que la hizo falta
  const caja = activa.body as (CajaResponse & { estado?: string }) | null;
  if (!caja?.id) return;

  // El arqueo se lee con el ADMIN: el modo ciego le retiene el `esperado` al
  // cajero (y al encargado, desde la task 6b), y sin el esperado esta higiene
  // no puede contar exacto.
  const leerArqueo = async () =>
    (
      await request(app.getHttpServer())
        .get(`/api/caja/${caja.id}/arqueo`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
    ).body as { lineas: ArqueoLinea[] };

  if (caja.estado === 'abierta') {
    // Contar EXACTAMENTE el esperado de cada línea, no un monto fijo. Antes iba
    // un `'10000'` de efectivo a ojo: cualquier caja con otro saldo quedaba
    // descuadrada, la fase 2 con `lineas: []` moría con 400 ("Falta el motivo
    // de la diferencia") y la higiene no liberaba nada — justo lo que promete
    // hacer. Contando el esperado no hay descuadre que justificar.
    const { lineas } = await leerArqueo();
    await request(app.getHttpServer())
      .post(`/api/caja/${caja.id}/conteo`)
      .set('Authorization', `Bearer ${tokenCajero}`)
      .send({
        lineas: lineas.map((l) => ({
          metodoPagoId: l.metodoPagoId,
          montoContado: l.esperado ?? '0',
        })),
      });
  }

  // Si sigue ocupando (`en_conciliacion`, forzada o no), la fase 2 la cierra un
  // admin. Las diferencias que ya venían congeladas de antes —esta higiene no
  // las causó— se justifican con el primer motivo activo del tenant; si el
  // tenant no tiene motivos, alcanza el comentario (`aplicarMotivosADescuadres`).
  const { lineas } = await leerArqueo();
  const descuadres = lineas.filter(
    (l) => l.diferencia != null && Number(l.diferencia) !== 0,
  );
  let motivoId: string | undefined;
  if (descuadres.length > 0) {
    const resMotivos = await request(app.getHttpServer())
      .get('/api/motivos-diferencia?soloActivas=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    // status-tolerante: red de limpieza: un rojo de la higiene taparía el del test que la hizo falta
    motivoId = (resMotivos.body as { id: string }[])?.[0]?.id;
  }
  await request(app.getHttpServer())
    .post(`/api/caja/${caja.id}/cerrar`)
    .set('Authorization', `Bearer ${tokenAdmin}`)
    .send({
      lineas: descuadres.map((l) => ({
        metodoPagoId: l.metodoPagoId,
        ...(motivoId ? { motivoDiferenciaId: motivoId } : {}),
        comentarioDiferencia: 'Higiene E2E: residuo de una corrida anterior',
      })),
      comentario: 'Higiene E2E: liberar caja atascada',
    });
}

/**
 * Resuelve el usuarioId del dueño de `token` matcheando su correo en
 * GET /api/tenants/members (patrón de cajones.e2e-spec.ts).
 */
async function usuarioIdDe(
  app: INestApplication<App>,
  token: string,
  email: string,
): Promise<string> {
  const resMiembros = await request(app.getHttpServer())
    .get('/api/tenants/members')
    .set('Authorization', `Bearer ${token}`);
  // El status va ANTES del casteo. Sin esto, una respuesta que no sea la lista
  // muere con `TypeError: .find is not a function` y se lleva puesta la causa:
  // el 2026-08-11 un flaky de este spec costó una sesión de forense por eso.
  // No arregla el flaky — lo hace legible la próxima vez.
  expect(resMiembros.status).toBe(200);
  expect(Array.isArray(resMiembros.body)).toBe(true);
  const miembro = (resMiembros.body as Member[]).find(
    (m) => m.correo === email,
  );
  if (!miembro) {
    throw new Error(`No se encontró en /tenants/members el correo ${email}`);
  }
  return miembro.usuarioId;
}

describe('Caja (e2e) — aislamiento cajero (MiCaja) vs supervisor (Cajas)', () => {
  let app: INestApplication<App>;
  let tokenCajero: string;
  let tokenSupervisor: string;
  let cajaDelCajeroId: string;
  let cajonDelCajeroId: string;

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

    tokenCajero = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
    tokenSupervisor = await login(app, ADMIN_EMAIL, ADMIN_PASS);

    // Cajón dedicado para las aperturas de este describe (AbrirCajaDto exige
    // cajonId — ver `describe('apertura sobre cajón (e2e)')` más abajo).
    const resCajon = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenSupervisor}`)
      .send({ nombre: `E2E Owner-only ${Date.now()}` });
    expect(resCajon.status).toBe(201);
    cajonDelCajeroId = (resCajon.body as CajonResponse).id;
  }, 60000);

  afterAll(async () => {
    // El `close` va en un `finally`: cualquier paso de esta limpieza puede
    // tirar —un `query` que falla, una aserción de acá abajo— y sin esto la app
    // de Nest quedaba viva con su `@Cron` escribiéndole a la base desde un
    // módulo desmontado MIENTRAS corren las suites siguientes. El fallo sigue
    // propagando; lo que cambia es que ya no se lleva el cierre puesto.
    // Ver `docs/agent/pendientes.md` § 1.
    try {
      if (cajonDelCajeroId) {
        await request(app.getHttpServer())
          .delete(`/api/cajones/${cajonDelCajeroId}`)
          .set('Authorization', `Bearer ${tokenSupervisor}`);
      }
    } finally {
      await app.close();
    }
  });

  describe('GET /caja/cajones-estado', () => {
    it('un cajero (solo MiCaja, sin Cajas) recibe 403', async () => {
      await request(app.getHttpServer())
        .get('/api/caja/cajones-estado')
        .set('Authorization', `Bearer ${tokenCajero}`)
        .expect(403);
    });

    it('un supervisor (Cajas:Leer) recibe la lista de cajones con su estado', async () => {
      const r = await request(app.getHttpServer())
        .get('/api/caja/cajones-estado')
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body)).toBe(true);
      for (const item of r.body as Array<Record<string, unknown>>) {
        expect(typeof item.cajonId).toBe('string');
        expect(typeof item.nombre).toBe('string');
        expect('sesion' in item).toBe(true);
      }
    });
  });

  describe('POST /caja/:id/conteo — cierre forzado (dueño o `Cajas:Actualizar`, fase 1)', () => {
    // `tokenSupervisor` en este describe es en realidad admin.paris (rol
    // Administrador, es_fijo=true) — ver el comentario de `ADMIN_EMAIL` más
    // arriba. Es justo el actor que la regla nueva habilita: antes de esta
    // task este mismo request devolvía 403 ("owner-only"); ahora un admin
    // puede forzar el cierre de la caja de otro cajero (decisión del owner
    // 2026-08-11, `caja.service.ts` `enviarConteo`/`esForzado`).
    let cajonDelAdminId: string;
    let cajaDelAdminId: string;

    beforeAll(async () => {
      // Cajón propio para que el admin abra SU PROPIA caja (necesario para el
      // segundo test: un no-admin-no-dueño solo se prueba de verdad contra una
      // caja que no sea ni suya ni de un admin — así que el "dueño" acá es el
      // admin, y quien intenta forzarla es el cajero, que sí tiene
      // MiCaja:Actualizar pero no es admin ni dueño).
      const r = await request(app.getHttpServer())
        .post('/api/cajones')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ nombre: `E2E Admin Owner ${Date.now()}` });
      expect(r.status).toBe(201);
      cajonDelAdminId = (r.body as CajonResponse).id;
    });

    afterAll(async () => {
      if (cajonDelAdminId) {
        await request(app.getHttpServer())
          .delete(`/api/cajones/${cajonDelAdminId}`)
          .set('Authorization', `Bearer ${tokenSupervisor}`);
      }
    });

    it('un admin del tenant SÍ puede enviar el conteo de la caja abierta por el cajero (forzado)', async () => {
      cajaDelCajeroId = await abrirOReusarCaja(
        app,
        tokenCajero,
        cajonDelCajeroId,
      );

      const res = await request(app.getHttpServer())
        .post(`/api/caja/${cajaDelCajeroId}/conteo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '10000' }] });

      expect(res.status).toBe(201);
      // Forzado (usuario del token != dueño de la caja): pasa por
      // conciliación AUNQUE CUADRE — ahí vive la firma del testigo.
      expect((res.body as { estado: string }).estado).toBe('en_conciliacion');

      // Nadie firmó como testigo: cerrar sin explicación tiene que
      // rechazarse (Task 4, `caja.service.ts` `cerrar`/`esForzado`) — esto
      // protege la regla nueva, no solo la tolera.
      const sinComentario = await request(app.getHttpServer())
        .post(`/api/caja/${cajaDelCajeroId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [] });
      expect(sinComentario.status).toBe(400);

      // El mismo admin que forzó también puede finalizar la conciliación
      // (fase 2, ya cubierto por 'admin finaliza una conciliación ajena' más
      // abajo — acá solo se cierra, con el comentario que un forzado sin
      // testigo exige, para no dejar al cajero trabado).
      const cerrar = await request(app.getHttpServer())
        .post(`/api/caja/${cajaDelCajeroId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          lineas: [],
          comentario: 'nadie firmó, cierro para no dejar trabado al cajero',
        });
      expect([200, 201]).toContain(cerrar.status);
    });

    it('un no-admin que no es dueño sigue sin poder tocar la caja', async () => {
      cajaDelAdminId = await abrirOReusarCaja(
        app,
        tokenSupervisor,
        cajonDelAdminId,
      );

      const res = await request(app.getHttpServer())
        .post(`/api/caja/${cajaDelAdminId}/conteo`)
        .set('Authorization', `Bearer ${tokenCajero}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '10000' }] });

      expect(res.status).toBe(403);
      expect((res.body as { message: string }).message).toBe(
        'No tienes acceso a esta caja',
      );

      // Higiene: el dueño real (admin) cierra su propia caja, sin forzado —
      // cuadra exacto, auto-cierra en fase 1.
      await cerrarEnDosFases(app, cajaDelAdminId, tokenSupervisor, [
        { metodoPagoId: null, montoContado: '10000' },
      ]);
    });
  });

  describe('apertura sobre cajón (e2e)', () => {
    let cajonId: string;

    beforeAll(async () => {
      const r = await request(app.getHttpServer())
        .post('/api/cajones')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ nombre: `E2E Apertura ${Date.now()}` });
      expect(r.status).toBe(201);
      cajonId = (r.body as CajonResponse).id;
    });

    afterAll(async () => {
      // Soft-delete del cajón dedicado para no dejar residuos entre corridas.
      await request(app.getHttpServer())
        .delete(`/api/cajones/${cajonId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
    });

    // El chequeo aplicativo de `abrir` (findActiva) corre FUERA de la transacción,
    // así que dos aperturas simultáneas sobre cajones DISTINTOS no competían por
    // nada: el mismo cajero quedaba con dos cajas abiertas. La defensa real es el
    // índice único parcial, y lo que este test asevera es que existe con la forma
    // correcta — borrarlo del entity deja pasar la carrera otra vez.
    it('existe el índice único que impide dos cajas activas del mismo usuario', async () => {
      const ds = app.get(DataSource);
      const rows: { indexdef: string }[] = await ds.query(
        `SELECT indexdef FROM pg_indexes
          WHERE tablename = 'cajas' AND indexname = 'ux_cajas_activa_por_usuario'`,
      );
      expect(rows).toHaveLength(1);
      const def = rows[0].indexdef;
      expect(def).toContain('UNIQUE');
      expect(def).toContain('tenant_id');
      expect(def).toContain('usuario_id');
      // `en_conciliacion` también ocupa al cajero: sin ella, quien dejó una
      // conciliación pendiente podría abrir una segunda caja bajo concurrencia.
      expect(def).toContain('en_conciliacion');
      expect(def).toContain('abierta');
      // Las dos condiciones del `where` que hacen que el índice defienda ALGO:
      // sobre 'virtual' no protegería ninguna caja física, y sin el filtro de
      // borrado bloquearía reabrir tras un soft-delete legítimo.
      expect(def).toContain(`'fisica'`);
      expect(def).toContain('eliminado_el');
    });

    it('el cajón recién creado aparece en cajones-disponibles del admin', async () => {
      const r = await request(app.getHttpServer())
        .get('/api/caja/cajones-disponibles')
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(r.status).toBe(200);
      expect(
        (r.body as CajonDisponible[]).some((c) => c.cajonId === cajonId),
      ).toBe(true);
    });

    it('abrir sin cajonId es rechazado (400)', async () => {
      const r = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ saldoInicial: '0' });
      expect(r.status).toBe(400);
    });

    it('abre sobre el cajón, queda ocupado, y no se puede desactivar con caja abierta (409)', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId, saldoInicial: '0' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      // el cajón ya no aparece disponible mientras tiene una sesión abierta
      const disp = await request(app.getHttpServer())
        .get('/api/caja/cajones-disponibles')
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(disp.status).toBe(200);
      expect(
        (disp.body as CajonDisponible[]).some((c) => c.cajonId === cajonId),
      ).toBe(false);

      // guard de integridad: no se puede desactivar un cajón con caja abierta
      const desactivar = await request(app.getHttpServer())
        .patch(`/api/cajones/${cajonId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ activo: false });
      expect(desactivar.status).toBe(409);

      // cerrar para dejar limpio (higiene de reruns locales)
      const cerrar = await cerrarEnDosFases(app, cajaId, tokenSupervisor, [
        { metodoPagoId: null, montoContado: '0' },
      ]);
      expect([200, 201]).toContain(cerrar.status);
    });

    it('un usuario fuera del allow-list del cajón recibe 403 al abrir', async () => {
      const supervisorId = await usuarioIdDe(app, tokenSupervisor, ADMIN_EMAIL);

      // restringir el cajón al admin: el cajero queda fuera del allow-list
      const restringir = await request(app.getHttpServer())
        .put(`/api/cajones/${cajonId}/usuarios`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ usuarioIds: [supervisorId] });
      expect(restringir.status).toBe(200);

      const r = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenCajero}`)
        .send({ cajonId, saldoInicial: '0' });
      expect(r.status).toBe(403);

      // limpiar el allow-list para no afectar otras corridas
      const limpiar = await request(app.getHttpServer())
        .put(`/api/cajones/${cajonId}/usuarios`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ usuarioIds: [] });
      expect(limpiar.status).toBe(200);
    });

    // Antes este test consultaba con el MISMO usuario que había abierto la caja,
    // así que borrar la rama `cajonId && tieneVerTodas` de `buildHistorialFilters`
    // —que quita la restricción por usuario— seguía devolviendo 200 con filas: el
    // filtro "solo mis cajas" daba el mismo resultado. La rama existe para ver
    // cajas AJENAS por cajón, así que el que abre y el que consulta tienen que ser
    // personas distintas.
    it('el historial por cajonId muestra la caja de OTRO usuario (supervisión)', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenCajero}`)
        .send({ cajonId, saldoInicial: '10000.0000' });
      expect(abrir.status).toBe(201);
      const cajaDelCajero = (abrir.body as CajaResponse).id;

      const r = await request(app.getHttpServer())
        .get(`/api/caja?cajonId=${cajonId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(r.status).toBe(200);
      const data = (r.body as { data: Array<{ id: string }> }).data;
      // Sin la rama de supervisión, el filtro por usuario propio dejaría fuera
      // esta caja y el array vendría vacío.
      expect(data.map((c) => c.id)).toContain(cajaDelCajero);

      await cerrarEnDosFases(app, cajaDelCajero, tokenCajero, [
        { metodoPagoId: null, montoContado: '10000.0000' },
      ]);
    });
  });

  describe('arqueo multi-medio', () => {
    // Tarjeta de débito (es_efectivo=false, habilitada para Paris vía seed;
    // requiere_conteo=false por defecto).
    const TARJETA_DEBITO_ID = '550e8400-e29b-41d4-a716-446655440106';
    const BOLETA_ID = '550e8400-e29b-41d4-a716-446655440145';
    const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

    let ds: DataSource;
    let cajonArqueoId: string;
    // Item tipo 'servicio' (sin stock): evita depender de productos con stock
    // compartido/agotable por otros specs (ver `docs/agent/pendientes.md`,
    // caveat de polución local de stock acumulado entre corridas de e2e).
    let itemId: string;

    beforeAll(async () => {
      ds = app.get(DataSource);
      const r = await request(app.getHttpServer())
        .post('/api/cajones')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ nombre: `E2E Arqueo ${Date.now()}` });
      expect(r.status).toBe(201);
      cajonArqueoId = (r.body as CajonResponse).id;

      const item = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          nombre: `E2E Arqueo Servicio ${Date.now()}`,
          precioBase: '5000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'servicio',
        });
      expect(item.status).toBe(201);
      itemId = (item.body as { id: string }).id;
    });

    afterAll(async () => {
      // Higiene: la política de requiere_conteo es del tenant, no debe quedar
      // alterada para otras corridas/specs que compartan la BD.
      await ds.query(
        `UPDATE tenant_metodo_pago SET requiere_conteo = false
         WHERE tenant_id = $1 AND metodo_pago_id = $2`,
        [PARIS_TENANT_ID, TARJETA_DEBITO_ID],
      );
      if (itemId) {
        await request(app.getHttpServer())
          .delete(`/api/items/${itemId}`)
          .set('Authorization', `Bearer ${tokenSupervisor}`);
      }
      await request(app.getHttpServer())
        .delete(`/api/cajones/${cajonArqueoId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
    });

    it('vender con tarjeta NO infla el esperado de efectivo (fin del faltante fantasma)', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonArqueoId, saldoInicial: '0' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      const venta = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          tipoDocumentoId: BOLETA_ID,
          lineas: [{ itemId, cantidad: '1' }],
          pagos: [{ metodoPagoId: TARJETA_DEBITO_ID, monto: '5000.0000' }],
        });
      expect(venta.status).toBe(201);

      const preview = await request(app.getHttpServer())
        .get(`/api/caja/${cajaId}/arqueo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(preview.status).toBe(200);
      const lineas = (preview.body as { ciego: boolean; lineas: ArqueoLinea[] })
        .lineas;
      const efectivo = lineas.find((l) => l.esEfectivo);
      const tarjeta = lineas.find((l) => l.metodoPagoId === TARJETA_DEBITO_ID);
      // El fondo era 0 y no hubo entradas en efectivo: la venta con tarjeta
      // no debe inflar el esperado de efectivo (fin del faltante fantasma).
      expect(efectivo?.esperado).toBe('0.0000');
      expect(tarjeta?.esperado).toBe('5000.0000');

      const cerrar = await cerrarEnDosFases(app, cajaId, tokenSupervisor, [
        { metodoPagoId: null, montoContado: '0' },
      ]);
      expect(cerrar.status).toBe(201);
      const body = cerrar.body as { estado: string; arqueo: ArqueoLinea[] };
      expect(body.estado).toBe('cerrada'); // cuadró → auto-cierre en fase 1
      const efectivoCerrado = body.arqueo.find((l) => l.esEfectivo);
      expect(efectivoCerrado?.diferencia).toBe('0.0000');
    });

    it('la tarjeta sin requiere_conteo es informativa: cerrar solo con efectivo → 201', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonArqueoId, saldoInicial: '10000.0000' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      // Movimiento con tarjeta (requiere_conteo=false por defecto): la línea
      // queda informativa, no bloquea el cierre.
      const venta = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          tipoDocumentoId: BOLETA_ID,
          lineas: [{ itemId, cantidad: '1' }],
          pagos: [{ metodoPagoId: TARJETA_DEBITO_ID, monto: '5000.0000' }],
        });
      expect(venta.status).toBe(201);

      const cerrar = await cerrarEnDosFases(app, cajaId, tokenSupervisor, [
        { metodoPagoId: null, montoContado: '10000.0000' },
      ]);
      expect(cerrar.status).toBe(201);
    });

    it('el historial reporta el descuadre de tarjeta, no solo el de efectivo', async () => {
      await ds.query(
        `UPDATE tenant_metodo_pago SET requiere_conteo = true
         WHERE tenant_id = $1 AND metodo_pago_id = $2`,
        [PARIS_TENANT_ID, TARJETA_DEBITO_ID],
      );

      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonArqueoId, saldoInicial: '0' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      const venta = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          tipoDocumentoId: BOLETA_ID,
          lineas: [{ itemId, cantidad: '1' }],
          pagos: [{ metodoPagoId: TARJETA_DEBITO_ID, monto: '5000.0000' }],
        });
      expect(venta.status).toBe(201);

      // El efectivo CUADRA (0 esperado, 0 contado) y la tarjeta descuadra en
      // -500: es justo el caso que el historial mostraba como "+0".
      const motivos = await request(app.getHttpServer())
        .get('/api/motivos-diferencia?soloActivas=true')
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(motivos.status).toBe(200);
      const motivoId = (motivos.body as { id: string }[])[0]?.id;
      const cerrar = await cerrarEnDosFases(
        app,
        cajaId,
        tokenSupervisor,
        [
          { metodoPagoId: null, montoContado: '0' },
          { metodoPagoId: TARJETA_DEBITO_ID, montoContado: '4500.0000' },
        ],
        [{ metodoPagoId: TARJETA_DEBITO_ID, motivoDiferenciaId: motivoId }],
      );
      expect([200, 201]).toContain(cerrar.status);

      const historial = await request(app.getHttpServer())
        .get(`/api/caja?cajonId=${cajonArqueoId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(historial.status).toBe(200);
      const fila = (
        historial.body as {
          data: {
            id: string;
            diferencia: string | null;
            diferenciaTotal: string | null;
          }[];
        }
      ).data.find((c) => c.id === cajaId);

      // El campo viejo sigue siendo el del cajón físico: el efectivo cuadró.
      expect(fila?.diferencia).toBe('0.0000');
      // El nuevo suma todas las líneas y por eso sí ve el descuadre de tarjeta.
      expect(fila?.diferenciaTotal).toBe('-500.0000');

      await ds.query(
        `UPDATE tenant_metodo_pago SET requiere_conteo = false
         WHERE tenant_id = $1 AND metodo_pago_id = $2`,
        [PARIS_TENANT_ID, TARJETA_DEBITO_ID],
      );
    });

    it('con requiere_conteo=true en tarjeta, enviar el conteo sin su contado → 400', async () => {
      await ds.query(
        `UPDATE tenant_metodo_pago SET requiere_conteo = true
         WHERE tenant_id = $1 AND metodo_pago_id = $2`,
        [PARIS_TENANT_ID, TARJETA_DEBITO_ID],
      );

      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonArqueoId, saldoInicial: '0' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      const venta = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          tipoDocumentoId: BOLETA_ID,
          lineas: [{ itemId, cantidad: '1' }],
          pagos: [{ metodoPagoId: TARJETA_DEBITO_ID, monto: '5000.0000' }],
        });
      expect(venta.status).toBe(201);

      // La validación de "falta el conteo de X" (línea obligatoria sin
      // contado) vive en la fase 1 (`enviarConteo`), no en `cerrar`.
      const conteoSinTarjeta = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/conteo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '0' }] });
      expect(conteoSinTarjeta.status).toBe(400);

      // Higiene: cerrar con el conteo de la tarjeta (ahora obligatoria) para
      // no dejar la caja abierta, y restaurar la política del tenant.
      const cerrarCompleto = await cerrarEnDosFases(
        app,
        cajaId,
        tokenSupervisor,
        [
          { metodoPagoId: null, montoContado: '0' },
          { metodoPagoId: TARJETA_DEBITO_ID, montoContado: '5000.0000' },
        ],
      );
      expect(cerrarCompleto.status).toBe(201);

      await ds.query(
        `UPDATE tenant_metodo_pago SET requiere_conteo = false
         WHERE tenant_id = $1 AND metodo_pago_id = $2`,
        [PARIS_TENANT_ID, TARJETA_DEBITO_ID],
      );
    });

    /**
     * Antes este test afirmaba lo contrario ("montoContado admite decimales",
     * 201): la plata entraba con la escala que el cliente quisiera y el recorte
     * lo terminaba haciendo Postgres, fuera de la configuración del tenant.
     * Paris opera en CLP —0 decimales— así que `10000.5000` (que Decimal
     * normaliza a **un** decimal real) no es un saldo que esa moneda pueda
     * representar, y `EscalaMonedaPipe` lo rechaza en el borde.
     *
     * Es además el primer lugar del proyecto donde el pipe se ejerce **cableado
     * de verdad**: que Nest le inyecte el `REQUEST` (de donde sale el tenant) y
     * `MonedasService`. Si `CajaModule` dejara de importar `MonedasModule`, la
     * resolución falla en runtime y solo este e2e se pone rojo — el typecheck y
     * los unit tests siguen verdes, porque el lookup es por
     * `moduleRef.injectables`, no por tipos.
     */
    it('rechaza un saldo inicial que la moneda del tenant no puede representar', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonArqueoId, saldoInicial: '10000.5000' });
      expect(abrir.status).toBe(400);
    });

    it('rechaza un montoContado que la moneda del tenant no puede representar', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonArqueoId, saldoInicial: '10000.0000' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      const conteo = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/conteo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '10000.5000' }] });
      expect(conteo.status).toBe(400);

      // Higiene: la caja sigue abierta (el 400 no la tocó). Se cierra con un
      // monto representable — y de paso queda probado el camino feliz: la
      // escala válida pasa, el pipe no rompió el cierre normal.
      const cerrar = await cerrarEnDosFases(app, cajaId, tokenSupervisor, [
        { metodoPagoId: null, montoContado: '10000.0000' },
      ]);
      expect(cerrar.status).toBe(201);
    });

    it('la caja cerrada devuelve las líneas congeladas en GET /:id/arqueo', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonArqueoId, saldoInicial: '1000.0000' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      const cerrar = await cerrarEnDosFases(app, cajaId, tokenSupervisor, [
        { metodoPagoId: null, montoContado: '1000.0000' },
      ]);
      expect(cerrar.status).toBe(201);

      const arqueoCerrado = await request(app.getHttpServer())
        .get(`/api/caja/${cajaId}/arqueo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(arqueoCerrado.status).toBe(200);
      const lineas = (
        arqueoCerrado.body as { ciego: boolean; lineas: ArqueoLinea[] }
      ).lineas;
      const efectivo = lineas.find((l) => l.esEfectivo);
      expect(efectivo?.contado).not.toBeNull();
      expect(efectivo?.diferencia).not.toBeNull();
      expect(efectivo?.contado).toBe('1000.0000');
      expect(efectivo?.diferencia).toBe('0.0000');
    });

    it('modo ciego + caja abierta operada por admin: el admin ve el arqueo completo (ciego no aplica al dueño)', async () => {
      await ds.query(
        `UPDATE tenants SET arqueo_ciego = true WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      );
      try {
        const abrir = await request(app.getHttpServer())
          .post('/api/caja/abrir')
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({ cajonId: cajonArqueoId, saldoInicial: '10000.0000' });
        expect(abrir.status).toBe(201);
        const cajaId = (abrir.body as CajaResponse).id;

        // Venta con tarjeta (informativa: es_efectivo=false, requiere_conteo=false).
        const venta = await request(app.getHttpServer())
          .post('/api/ventas')
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({
            tipoDocumentoId: BOLETA_ID,
            lineas: [{ itemId, cantidad: '1' }],
            pagos: [{ metodoPagoId: TARJETA_DEBITO_ID, monto: '5000.0000' }],
          });
        expect(venta.status).toBe(201);

        const arqueo = await request(app.getHttpServer())
          .get(`/api/caja/${cajaId}/arqueo`)
          .set('Authorization', `Bearer ${tokenSupervisor}`);
        expect(arqueo.status).toBe(200);
        const body = arqueo.body as { ciego: boolean; lineas: ArqueoLinea[] };
        // El admin del tenant ve el arqueo completo aun en modo ciego (§3.4): el
        // ciego no aplica al dueño, así que el esperado SÍ viaja.
        expect(body.ciego).toBe(false);
        const efectivo = body.lineas.find((l) => l.esEfectivo);
        // La tarjeta NO infla el esperado de efectivo (fin del faltante fantasma).
        expect(efectivo?.esperado).toBe('10000.0000');

        // El cierre igual cuadra: el server recomputa el esperado (10000).
        const cerrar = await cerrarEnDosFases(app, cajaId, tokenSupervisor, [
          { metodoPagoId: null, montoContado: '10000.0000' },
        ]);
        expect(cerrar.status).toBe(201);
        const cerrarBody = cerrar.body as { arqueo: ArqueoLinea[] };
        const efectivoCerrado = cerrarBody.arqueo.find((l) => l.esEfectivo);
        expect(efectivoCerrado?.esperado).toBe('10000.0000');
        expect(efectivoCerrado?.diferencia).toBe('0.0000');

        // La caja cerrada revela TODO (ciego:false) aunque el tenant sea ciego.
        const revelado = await request(app.getHttpServer())
          .get(`/api/caja/${cajaId}/arqueo`)
          .set('Authorization', `Bearer ${tokenSupervisor}`);
        expect(revelado.status).toBe(200);
        const revBody = revelado.body as {
          ciego: boolean;
          lineas: ArqueoLinea[];
        };
        expect(revBody.ciego).toBe(false);
        const efectivoRevelado = revBody.lineas.find((l) => l.esEfectivo);
        expect(efectivoRevelado?.esperado).toBe('10000.0000');
        expect(efectivoRevelado?.diferencia).toBe('0.0000');
      } finally {
        // Higiene: restaurar la política para no contaminar otros specs/corridas.
        await ds.query(
          `UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1`,
          [PARIS_TENANT_ID],
        );
      }
    });

    it('modo ciego + descuadre real: el conteo pasa a en_conciliacion y el GET /arqueo posterior revela; se finaliza con motivo', async () => {
      // Motivo fijo del seed (`seedMotivosDiferencia`, Paris arranca en 291).
      const FALTA_EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440291';

      await ds.query(
        `UPDATE tenants SET arqueo_ciego = true WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      );
      try {
        const abrir = await request(app.getHttpServer())
          .post('/api/caja/abrir')
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({ cajonId: cajonArqueoId, saldoInicial: '10000.0000' });
        expect(abrir.status).toBe(201);
        const cajaId = (abrir.body as CajaResponse).id;

        // Contado ≠ esperado (10000): la caja NO auto-cierra, pasa a conciliación.
        const conteo = await request(app.getHttpServer())
          .post(`/api/caja/${cajaId}/conteo`)
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({
            lineas: [{ metodoPagoId: null, montoContado: '9000.0000' }],
          });
        expect(conteo.status).toBe(201);
        expect((conteo.body as { estado: string }).estado).toBe(
          'en_conciliacion',
        );

        // Aunque el tenant sea ciego, la caja ya no está "abierta": el GET
        // /arqueo revela todo para poder conciliar (ciego solo aplica al
        // preview de una caja abierta).
        const arqueoRevelado = await request(app.getHttpServer())
          .get(`/api/caja/${cajaId}/arqueo`)
          .set('Authorization', `Bearer ${tokenSupervisor}`);
        expect(arqueoRevelado.status).toBe(200);
        const revBody = arqueoRevelado.body as {
          ciego: boolean;
          lineas: ArqueoLinea[];
        };
        expect(revBody.ciego).toBe(false);
        const efectivoRevelado = revBody.lineas.find((l) => l.esEfectivo);
        expect(efectivoRevelado?.esperado).toBe('10000.0000');
        expect(efectivoRevelado?.diferencia).toBe('-1000.0000');
        expect(efectivoRevelado?.motivoNombre).toBeNull();

        // Fase 2: finalizar la conciliación con motivo.
        const cerrar = await request(app.getHttpServer())
          .post(`/api/caja/${cajaId}/cerrar`)
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({
            lineas: [
              { metodoPagoId: null, motivoDiferenciaId: FALTA_EFECTIVO_ID },
            ],
          });
        expect([200, 201]).toContain(cerrar.status);

        const arqueoFinal = await request(app.getHttpServer())
          .get(`/api/caja/${cajaId}/arqueo`)
          .set('Authorization', `Bearer ${tokenSupervisor}`);
        expect(arqueoFinal.status).toBe(200);
        const lineasFinal = (arqueoFinal.body as { lineas: ArqueoLinea[] })
          .lineas;
        expect(lineasFinal.find((l) => l.esEfectivo)?.motivoNombre).toBe(
          'falta de efectivo',
        );
      } finally {
        // Higiene: restaurar la política para no contaminar otros specs/corridas.
        await ds.query(
          `UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1`,
          [PARIS_TENANT_ID],
        );
      }
    });
  });

  describe('cierre normal con descuadre — motivo es un paso aparte', () => {
    // Motivos fijos del seed (`seedMotivosDiferencia`, Paris arranca en 291).
    const FALTA_EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440291';

    let cajonMotivoId: string;

    beforeAll(async () => {
      const r = await request(app.getHttpServer())
        .post('/api/cajones')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ nombre: `E2E Motivo ${Date.now()}` });
      expect(r.status).toBe(201);
      cajonMotivoId = (r.body as CajonResponse).id;
    });

    afterAll(async () => {
      await request(app.getHttpServer())
        .delete(`/api/cajones/${cajonMotivoId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
    });

    it('conteo con descuadre → en_conciliacion; cerrar sin motivo → 400; con motivo → cierra y GET /arqueo muestra motivoNombre', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonMotivoId, saldoInicial: '10000.0000' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      // Contado != esperado (10000): fase 1 NO auto-cierra, pasa a conciliación.
      const conteo = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/conteo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '9000.0000' }] });
      expect(conteo.status).toBe(201);
      expect((conteo.body as { estado: string }).estado).toBe(
        'en_conciliacion',
      );

      const arqueoSinJustificar = await request(app.getHttpServer())
        .get(`/api/caja/${cajaId}/arqueo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(arqueoSinJustificar.status).toBe(200);
      const lineasSinJustificar = (
        arqueoSinJustificar.body as { ciego: boolean; lineas: ArqueoLinea[] }
      ).lineas;
      const efectivoSinJustificar = lineasSinJustificar.find(
        (l) => l.esEfectivo,
      );
      expect(efectivoSinJustificar?.diferencia).toBe('-1000.0000');
      expect(efectivoSinJustificar?.motivoNombre).toBeNull();

      // Fase 2 (`cerrar`) sin motivo, habiendo motivos activos en el tenant → 400.
      const cerrarSinMotivo = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null }] });
      expect(cerrarSinMotivo.status).toBe(400);

      // La caja sigue en_conciliacion: el 400 no finalizó la transacción, la
      // línea sigue sin motivo.
      const arqueoTrasFallo = await request(app.getHttpServer())
        .get(`/api/caja/${cajaId}/arqueo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(arqueoTrasFallo.status).toBe(200);
      const efectivoTrasFallo = (
        arqueoTrasFallo.body as { lineas: ArqueoLinea[] }
      ).lineas.find((l) => l.esEfectivo);
      expect(efectivoTrasFallo?.motivoNombre).toBeNull();

      // Con motivoDiferenciaId válido → cierra.
      const cerrarConMotivo = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          lineas: [
            { metodoPagoId: null, motivoDiferenciaId: FALTA_EFECTIVO_ID },
          ],
        });
      expect([200, 201]).toContain(cerrarConMotivo.status);

      const arqueo = await request(app.getHttpServer())
        .get(`/api/caja/${cajaId}/arqueo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(arqueo.status).toBe(200);
      const lineas = (arqueo.body as { ciego: boolean; lineas: ArqueoLinea[] })
        .lineas;
      const efectivo = lineas.find((l) => l.esEfectivo);
      expect(efectivo?.diferencia).toBe('-1000.0000');
      expect(efectivo?.motivoNombre).toBe('falta de efectivo');
    });

    it('cerrar con `lineas: []` NO finaliza una caja descuadrada: 400 y sigue en_conciliacion', async () => {
      const abrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ cajonId: cajonMotivoId, saldoInicial: '10000.0000' });
      expect(abrir.status).toBe(201);
      const cajaId = (abrir.body as CajaResponse).id;

      const conteo = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/conteo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '9500.0000' }] });
      expect(conteo.status).toBe(201);
      expect((conteo.body as { estado: string }).estado).toBe(
        'en_conciliacion',
      );

      // El payload no menciona la línea descuadrada. Mientras el recorrido salía
      // de `dto.lineas`, esto devolvía 200 y cerraba la caja con la diferencia
      // sin justificar — el faltante quedaba sin explicación para siempre.
      const cerrarVacio = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [] });
      expect(cerrarVacio.status).toBe(400);

      const detalle = await request(app.getHttpServer())
        .get(`/api/caja/${cajaId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(detalle.status).toBe(200);
      expect((detalle.body as { estado: string }).estado).toBe(
        'en_conciliacion',
      );

      // Higiene: cerrar de verdad para liberar el cajón (ver pendientes.md).
      const cerrarOk = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          lineas: [
            { metodoPagoId: null, motivoDiferenciaId: FALTA_EFECTIVO_ID },
          ],
        });
      expect([200, 201]).toContain(cerrarOk.status);
    });
  });

  // `bloquearCajaAbierta` filtra `estado = 'abierta'`, pero los tres unit que
  // dicen cubrirlo mockean la query con `mockResolvedValueOnce([])`, que ignora
  // el SQL: el resultado lo decide el mock, no el WHERE. Relajar el filtro a
  // `IN ('abierta','en_conciliacion')` no rompía nada. Esto lo ejerce de verdad,
  // contra los DOS estados que no deben aceptar escritura.
  describe('escribir contra una caja que no está abierta', () => {
    const FALTA_EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440291';
    const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
    const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
    let cajonEstadoId: string;
    let itemEstadoId: string;

    beforeAll(async () => {
      const r = await request(app.getHttpServer())
        .post('/api/cajones')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ nombre: `E2E Estado ${Date.now()}` });
      expect(r.status).toBe(201);
      cajonEstadoId = (r.body as CajonResponse).id;

      // Servicio (sin stock): no compite por el stock del producto demo.
      const item = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          nombre: `E2E Estado Servicio ${Date.now()}`,
          precioBase: '5000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'servicio',
        });
      expect(item.status).toBe(201);
      itemEstadoId = (item.body as { id: string }).id;
    });

    afterAll(async () => {
      if (itemEstadoId) {
        await request(app.getHttpServer())
          .delete(`/api/items/${itemEstadoId}`)
          .set('Authorization', `Bearer ${tokenSupervisor}`);
      }
      await request(app.getHttpServer())
        .delete(`/api/cajones/${cajonEstadoId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
    });

    // `abrirOReusarCaja` y no un POST directo: tolera el 409 por un residuo de
    // una corrida local abortada, que es la fuga que este archivo ya sufrió.
    const abrir = () => abrirOReusarCaja(app, tokenSupervisor, cajonEstadoId);

    function movimiento(cajaId: string) {
      return request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/movimientos`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ tipo: 'entrada', concepto: 'no debería entrar', monto: '100' });
    }

    it('una caja CERRADA rechaza el movimiento', async () => {
      const cajaId = await abrir();
      // Cuadra → la fase 1 auto-cierra.
      const cierre = await cerrarEnDosFases(app, cajaId, tokenSupervisor, [
        { metodoPagoId: null, montoContado: '10000.0000' },
      ]);
      expect(cierre.status).toBe(201);
      expect((cierre.body as { estado?: string }).estado).toBe('cerrada');

      const r = await movimiento(cajaId);
      expect(r.status).toBe(403);
    });

    it('una caja EN CONCILIACIÓN también lo rechaza', async () => {
      const cajaId = await abrir();
      const conteo = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/conteo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '9000.0000' }] });
      expect(conteo.status).toBe(201);
      expect((conteo.body as { estado: string }).estado).toBe(
        'en_conciliacion',
      );

      // Es el caso que distingue: una caja en conciliación sigue "ocupando",
      // pero ya congeló su arqueo y no puede recibir plata nueva.
      const r = await movimiento(cajaId);
      expect(r.status).toBe(403);

      // Higiene: liberar el cajón.
      const cerrar = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          lineas: [
            { metodoPagoId: null, motivoDiferenciaId: FALTA_EFECTIVO_ID },
          ],
        });
      expect([200, 201]).toContain(cerrar.status);
    });

    // Los dos tests de arriba NO discriminan una regresión de una sola capa:
    // `registrarMovimiento` chequea el estado dos veces (el lock y un `findOne`),
    // así que relajar solo `bloquearCajaAbierta` queda tapado por el otro.
    // La devolución de una nota de crédito es el camino donde ese lock está
    // SOLO: si se relaja, se saca plata de una caja que ya congeló su arqueo.
    it('la devolución de una NC no puede sacar plata de una caja en conciliación', async () => {
      const cajaId = await abrir();

      const venta = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          lineas: [{ itemId: itemEstadoId, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '5950.0000' }],
        });
      expect(venta.status).toBe(201);
      const ventaId = (venta.body as { id: string }).id;

      // La caja pasa a conciliación: su arqueo quedó congelado.
      const conteo = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/conteo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '1000.0000' }] });
      expect(conteo.status).toBe(201);
      expect((conteo.body as { estado: string }).estado).toBe(
        'en_conciliacion',
      );

      const nc = await request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/notas-credito`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          monto: '5000.0000',
          comentario: 'devolución e2e',
          devolverDinero: true,
        });
      expect(nc.status).toBe(403);

      const cerrar = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          lineas: [
            { metodoPagoId: null, motivoDiferenciaId: FALTA_EFECTIVO_ID },
          ],
        });
      expect([200, 201]).toContain(cerrar.status);
    });
  });

  describe('justificación de diferencias — PATCH /caja/:id/arqueo/motivos (admin-only)', () => {
    // Motivo fijo del seed, distinto del usado en el describe anterior
    // para no competir por el mismo registro (maxWorkers:1 en jest-e2e.json
    // hace que los archivos corran en serie, pero los `it` dentro de un mismo
    // describe podrían solaparse con otros describes si Jest los reordena).
    const DIVERGENCIA_TARJETA_ID = '550e8400-e29b-41d4-a716-446655440293';

    let ds: DataSource;
    let cajonJustificacionId: string;

    beforeAll(async () => {
      ds = app.get(DataSource);
      const r = await request(app.getHttpServer())
        .post('/api/cajones')
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({ nombre: `E2E Justificacion ${Date.now()}` });
      expect(r.status).toBe(201);
      cajonJustificacionId = (r.body as CajonResponse).id;
    });

    afterAll(async () => {
      await request(app.getHttpServer())
        .delete(`/api/cajones/${cajonJustificacionId}`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
    });

    it('en modo ciego con descuadre: conteo → en_conciliacion, se finaliza con motivo, y el override (PATCH) es admin-only', async () => {
      // Motivo fijo del seed, distinto de DIVERGENCIA_TARJETA_ID (con el que
      // se re-justifica más abajo), para poder verificar que el PATCH
      // realmente reemplaza el motivo aplicado en la fase 2.
      const FALTA_EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440291';

      await ds.query(
        `UPDATE tenants SET arqueo_ciego = true WHERE tenant_id = $1`,
        [PARIS_TENANT_ID],
      );
      try {
        const abrir = await request(app.getHttpServer())
          .post('/api/caja/abrir')
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({ cajonId: cajonJustificacionId, saldoInicial: '10000.0000' });
        expect(abrir.status).toBe(201);
        const cajaId = (abrir.body as CajaResponse).id;

        // Contado != esperado (10000): fase 1 pasa a en_conciliacion (el modo
        // ciego del tenant no cambia esta bifurcación).
        const conteo = await request(app.getHttpServer())
          .post(`/api/caja/${cajaId}/conteo`)
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({
            lineas: [{ metodoPagoId: null, montoContado: '9500.0000' }],
          });
        expect(conteo.status).toBe(201);
        expect((conteo.body as { estado: string }).estado).toBe(
          'en_conciliacion',
        );

        // Fase 2: finaliza con motivo → la caja queda `cerrada`.
        const cerrar = await request(app.getHttpServer())
          .post(`/api/caja/${cajaId}/cerrar`)
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({
            lineas: [
              { metodoPagoId: null, motivoDiferenciaId: FALTA_EFECTIVO_ID },
            ],
          });
        expect([200, 201]).toContain(cerrar.status);

        // No-admin (Vendedor) no puede re-justificar (override admin-only).
        const patchNoAdmin = await request(app.getHttpServer())
          .patch(`/api/caja/${cajaId}/arqueo/motivos`)
          .set('Authorization', `Bearer ${tokenCajero}`)
          .send({
            lineas: [
              {
                metodoPagoId: null,
                motivoDiferenciaId: DIVERGENCIA_TARJETA_ID,
              },
            ],
          });
        expect(patchNoAdmin.status).toBe(403);

        // Admin re-justifica con un motivo distinto.
        const patchAdmin = await request(app.getHttpServer())
          .patch(`/api/caja/${cajaId}/arqueo/motivos`)
          .set('Authorization', `Bearer ${tokenSupervisor}`)
          .send({
            lineas: [
              {
                metodoPagoId: null,
                motivoDiferenciaId: DIVERGENCIA_TARJETA_ID,
              },
            ],
          });
        expect(patchAdmin.status).toBe(200);

        const arqueo = await request(app.getHttpServer())
          .get(`/api/caja/${cajaId}/arqueo`)
          .set('Authorization', `Bearer ${tokenSupervisor}`);
        expect(arqueo.status).toBe(200);
        const lineas = (
          arqueo.body as { ciego: boolean; lineas: ArqueoLinea[] }
        ).lineas;
        const efectivo = lineas.find((l) => l.esEfectivo);
        expect(efectivo?.motivoNombre).toBe('divergencia de tarjeta');
      } finally {
        await ds.query(
          `UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1`,
          [PARIS_TENANT_ID],
        );
      }
    });
  });

  describe('admin finaliza una conciliación ajena — fase 2 (POST /cerrar)', () => {
    // Motivo fijo del seed (`seedMotivosDiferencia`, Paris arranca en 291).
    const FALTA_EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440291';

    it('el cajero deja la caja en_conciliacion y el admin (no dueño) la finaliza con motivo', async () => {
      const cajaId = await abrirOReusarCaja(app, tokenCajero, cajonDelCajeroId);

      // El cajero envía su conteo con descuadre: pasa a en_conciliacion, no
      // auto-cierra, y no puede abrir otra caja hasta que se resuelva.
      const conteo = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/conteo`)
        .set('Authorization', `Bearer ${tokenCajero}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '9999.0000' }] });
      expect(conteo.status).toBe(201);
      expect((conteo.body as { estado: string }).estado).toBe(
        'en_conciliacion',
      );

      // El admin, sin ser dueño de la caja, finaliza la fase 2 con motivo.
      const cerrar = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`)
        .send({
          lineas: [
            { metodoPagoId: null, motivoDiferenciaId: FALTA_EFECTIVO_ID },
          ],
        });
      expect([200, 201]).toContain(cerrar.status);

      const arqueo = await request(app.getHttpServer())
        .get(`/api/caja/${cajaId}/arqueo`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(arqueo.status).toBe(200);
      const lineas = (arqueo.body as { lineas: ArqueoLinea[] }).lineas;
      expect(lineas.find((l) => l.esEfectivo)?.motivoNombre).toBe(
        'falta de efectivo',
      );
    });
  });
});

describe('Caja (e2e) — modo ciego oculta resumen y movimientos del turno', () => {
  let app: INestApplication<App>;
  let token: string;
  let adminToken: string;
  let cajonId: string;
  let ds: DataSource;

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
    ds = app.get(DataSource);

    token = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
    adminToken = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    const r = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: `E2E Ciego Resumen ${Date.now()}` });
    expect(r.status).toBe(201);
    cajonId = (r.body as CajonResponse).id;
  }, 60000);

  afterAll(async () => {
    // El `close` va en un `finally`: cualquier paso de esta limpieza puede
    // tirar —un `query` que falla, una aserción de acá abajo— y sin esto la app
    // de Nest quedaba viva con su `@Cron` escribiéndole a la base desde un
    // módulo desmontado MIENTRAS corren las suites siguientes. El fallo sigue
    // propagando; lo que cambia es que ya no se lleva el cierre puesto.
    // Ver `docs/agent/pendientes.md` § 1.
    try {
      await ds.query(
        'UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1',
        [PARIS_TENANT_ID],
      );
      if (cajonId) {
        await request(app.getHttpServer())
          .delete(`/api/cajones/${cajonId}`)
          .set('Authorization', `Bearer ${adminToken}`);
      }
    } finally {
      await app.close();
    }
  });

  it('ciego + caja abierta: resumen oculta cifras (ciego:true, totales null, saldoInicial presente) y movimientos devuelve página vacía', async () => {
    const cajaId = await abrirOReusarCaja(app, token, cajonId);
    await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/movimientos`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'salida', concepto: 'retiro', monto: '500.0000' });
    await ds.query(
      'UPDATE tenants SET arqueo_ciego = true WHERE tenant_id = $1',
      [PARIS_TENANT_ID],
    );

    const resumen = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos/resumen`)
      .set('Authorization', `Bearer ${token}`);
    expect(resumen.status).toBe(200);
    const rb = resumen.body as Record<string, unknown>;
    expect(rb.ciego).toBe(true);
    expect(rb.saldoInicial).toBe('10000.0000');
    expect(rb.totalEntradas).toBeNull();
    expect(rb.totalSalidas).toBeNull();
    expect(rb.saldoEsperado).toBeNull();
    expect(rb.totalMovimientos).toBeNull();

    const movs = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos`)
      .set('Authorization', `Bearer ${token}`);
    expect(movs.status).toBe(200);
    const mb = movs.body as { data: unknown[]; meta: { total: number } };
    expect(mb.data).toEqual([]);
    expect(mb.meta.total).toBe(0);

    // Reveal al conciliar: descuadre → en_conciliacion → estado !== 'abierta' → revela.
    const conteo = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/conteo`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ metodoPagoId: null, montoContado: '12345.0000' }] });
    expect(conteo.status).toBe(201);
    expect((conteo.body as { estado: string }).estado).toBe('en_conciliacion');

    const resumenReveal = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos/resumen`)
      .set('Authorization', `Bearer ${token}`);
    expect(resumenReveal.status).toBe(200);
    const rr = resumenReveal.body as Record<string, unknown>;
    expect(rr.ciego).toBe(false);
    expect(rr.totalSalidas).toBe('500.0000');
    const movsReveal = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos`)
      .set('Authorization', `Bearer ${token}`);
    expect(movsReveal.status).toBe(200);
    expect((movsReveal.body as { meta: { total: number } }).meta.total).toBe(1);

    // Higiene (evita caja colgada en_conciliacion en reruns locales): fase 2 con un
    // motivo real. En descuadre, POST /cerrar exige motivo por línea (sub-proyecto C).
    const motivos = await request(app.getHttpServer())
      .get('/api/motivos-diferencia?soloActivas=true')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(motivos.status).toBe(200);
    const motivoId = (motivos.body as { id: string }[])[0]?.id;
    await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/cerrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ metodoPagoId: null, motivoDiferenciaId: motivoId }] });
  });

  it('arqueo_ciego off: resumen revela cifras y movimientos lista las filas', async () => {
    await ds.query(
      'UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1',
      [PARIS_TENANT_ID],
    );
    const cajaId = await abrirOReusarCaja(app, token, cajonId);
    const resumen = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos/resumen`)
      .set('Authorization', `Bearer ${token}`);
    expect(resumen.status).toBe(200);
    const rb = resumen.body as Record<string, unknown>;
    expect(rb.ciego).toBe(false);
    expect(rb.saldoEsperado).toBe('10000.0000');
    await cerrarEnDosFases(app, cajaId, token, [
      { metodoPagoId: null, montoContado: '10000.0000' },
    ]);
  });
});

describe('Caja (e2e) — el modo ciego NO aplica al admin (ve en vivo)', () => {
  let app: INestApplication<App>;
  let tokenCajero: string;
  let tokenAdmin: string;
  let cajonId: string;
  let ds: DataSource;

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
    ds = app.get(DataSource);

    tokenCajero = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    const r = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `E2E Ciego Admin ${Date.now()}` });
    expect(r.status).toBe(201);
    cajonId = (r.body as CajonResponse).id;
  }, 60000);

  afterAll(async () => {
    // El `close` va en un `finally`: cualquier paso de esta limpieza puede
    // tirar —un `query` que falla, una aserción de acá abajo— y sin esto la app
    // de Nest quedaba viva con su `@Cron` escribiéndole a la base desde un
    // módulo desmontado MIENTRAS corren las suites siguientes. El fallo sigue
    // propagando; lo que cambia es que ya no se lleva el cierre puesto.
    // Ver `docs/agent/pendientes.md` § 1.
    try {
      await ds.query(
        'UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1',
        [PARIS_TENANT_ID],
      );
      if (cajonId) {
        await request(app.getHttpServer())
          .delete(`/api/cajones/${cajonId}`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
      }
    } finally {
      await app.close();
    }
  });

  it('caja abierta del cajero en tenant ciego: el cajero la ve ciega, el admin (verTodas) la ve completa', async () => {
    const cajaId = await abrirOReusarCaja(app, tokenCajero, cajonId);
    await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/movimientos`)
      .set('Authorization', `Bearer ${tokenCajero}`)
      .send({ tipo: 'salida', concepto: 'retiro', monto: '500.0000' });
    await ds.query(
      'UPDATE tenants SET arqueo_ciego = true WHERE tenant_id = $1',
      [PARIS_TENANT_ID],
    );

    // Cajero (no-admin, su propia caja) → ciega.
    const rCajero = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos/resumen`)
      .set('Authorization', `Bearer ${tokenCajero}`);
    expect(rCajero.status).toBe(200);
    expect((rCajero.body as { ciego: boolean }).ciego).toBe(true);
    expect((rCajero.body as { totalSalidas: unknown }).totalSalidas).toBeNull();
    const mCajero = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos`)
      .set('Authorization', `Bearer ${tokenCajero}`);
    expect(mCajero.status).toBe(200);
    expect((mCajero.body as { meta: { total: number } }).meta.total).toBe(0);

    // Admin del tenant (verTodas) → completo, aun estando la caja abierta y el tenant ciego.
    const rAdmin = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos/resumen`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(rAdmin.status).toBe(200);
    const adminBody = rAdmin.body as { ciego: boolean; totalSalidas: unknown };
    expect(adminBody.ciego).toBe(false);
    expect(typeof adminBody.totalSalidas).toBe('string');
    const mAdmin = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/movimientos`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(mAdmin.status).toBe(200);
    expect(
      (mAdmin.body as { meta: { total: number } }).meta.total,
    ).toBeGreaterThanOrEqual(1);

    // GET /arqueo respeta el mismo eje: el cajero lo ve ciego (esperado null), el
    // admin lo ve revelado.
    const aCajero = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/arqueo`)
      .set('Authorization', `Bearer ${tokenCajero}`);
    expect(aCajero.status).toBe(200);
    expect((aCajero.body as { ciego: boolean }).ciego).toBe(true);
    const aAdmin = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/arqueo`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(aAdmin.status).toBe(200);
    expect((aAdmin.body as { ciego: boolean }).ciego).toBe(false);

    // Higiene: apagar ciego y cerrar la caja (con motivo por si descuadra).
    await ds.query(
      'UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1',
      [PARIS_TENANT_ID],
    );
    const motivos = await request(app.getHttpServer())
      .get('/api/motivos-diferencia?soloActivas=true')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(motivos.status).toBe(200);
    const motivoId = (motivos.body as { id: string }[])[0]?.id;
    await cerrarEnDosFases(
      app,
      cajaId,
      tokenCajero,
      [{ metodoPagoId: null, montoContado: '0' }],
      [{ metodoPagoId: null, motivoDiferenciaId: motivoId }],
    );
  });
});

describe('Caja (e2e) — el modo ciego SÍ aplica al supervisor no-admin', () => {
  let app: INestApplication<App>;
  let tokenCajero: string;
  let tokenAdmin: string;
  let tokenSupervisor: string;
  let cajonId: string;
  let ds: DataSource;

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
    ds = app.get(DataSource);

    tokenCajero = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    tokenSupervisor = await login(app, SUPERVISOR_EMAIL, SUPERVISOR_PASS);
    const r = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `E2E Ciego Supervisor ${Date.now()}` });
    expect(r.status).toBe(201);
    cajonId = (r.body as CajonResponse).id;
  }, 60000);

  afterAll(async () => {
    // El `close` va en un `finally`: cualquier paso de esta limpieza puede
    // tirar —un `query` que falla, una aserción de acá abajo— y sin esto la app
    // de Nest quedaba viva con su `@Cron` escribiéndole a la base desde un
    // módulo desmontado MIENTRAS corren las suites siguientes. El fallo sigue
    // propagando; lo que cambia es que ya no se lleva el cierre puesto.
    // Ver `docs/agent/pendientes.md` § 1.
    try {
      await ds.query(
        'UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1',
        [PARIS_TENANT_ID],
      );
      // Si el test falló antes de su cierre, el cajero se queda con la caja
      // abierta y el 409 aparece varias suites más allá, lejos de la causa
      // (ver `docs/agent/pendientes.md`). Liberarlo acá, pase lo que pase.
      // Las requests de esta limpieza NO afirman su status a propósito —mismo
      // criterio que `liberarCajeroSiQuedoOcupado`—: es una red, no una
      // aserción, y un rojo suyo taparía el del test que sí falló.
      const activa = await request(app.getHttpServer())
        .get('/api/caja/activa')
        .set('Authorization', `Bearer ${tokenCajero}`);
      // status-tolerante: red de limpieza: un rojo de la higiene taparía el del test que la hizo falta
      const abiertaId = (activa.body as CajaResponse | null)?.id;
      if (abiertaId) {
        const motivos = await request(app.getHttpServer())
          .get('/api/motivos-diferencia?soloActivas=true')
          .set('Authorization', `Bearer ${tokenAdmin}`);
        // status-tolerante: red de limpieza: un rojo de la higiene taparía el del test que la hizo falta
        const motivoId = (motivos.body as { id: string }[])[0]?.id;
        await cerrarEnDosFases(
          app,
          abiertaId,
          tokenCajero,
          [{ metodoPagoId: null, montoContado: '0' }],
          [{ metodoPagoId: null, motivoDiferenciaId: motivoId }],
        );
      }
      if (cajonId) {
        await request(app.getHttpServer())
          .delete(`/api/cajones/${cajonId}`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
      }
    } finally {
      await app.close();
    }
  });

  it('caja abierta ajena en tenant ciego: el supervisor la ve pero sin el esperado; el admin sí lo ve', async () => {
    const cajaId = await abrirOReusarCaja(app, tokenCajero, cajonId);
    await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/movimientos`)
      .set('Authorization', `Bearer ${tokenCajero}`)
      .send({
        tipo: 'entrada',
        concepto: 'venta efectivo',
        monto: '3000.0000',
      });
    await ds.query(
      'UPDATE tenants SET arqueo_ciego = true WHERE tenant_id = $1',
      [PARIS_TENANT_ID],
    );

    interface Sesion {
      cajaId: string;
      saldoInicial: string;
      saldoEsperado: string | null;
    }
    interface Fila {
      cajonId: string;
      sesion: Sesion | null;
    }
    const filaDe = (body: unknown) =>
      (body as Fila[]).find((f) => f.cajonId === cajonId);

    // Supervisor: LLEGA a la caja ajena (Cajas:Leer ⇒ verTodas) pero el ciego le
    // retiene el esperado. Assertear la sesión no-nula es lo que separa "ciego"
    // de "no la ve": sin ella, un 403 o una grilla vacía darían el mismo null.
    const gSup = await request(app.getHttpServer())
      .get('/api/caja/cajones-estado')
      .set('Authorization', `Bearer ${tokenSupervisor}`);
    expect(gSup.status).toBe(200);
    const sesionSup = filaDe(gSup.body)?.sesion;
    expect(sesionSup).toBeTruthy();
    expect(sesionSup?.cajaId).toBe(cajaId);
    expect(sesionSup?.saldoEsperado).toBeNull();

    // Admin sobre la MISMA grilla y la misma caja: ve el esperado. Mata el
    // mutante de "el controller no pasa esAdmin" (que dejaría ciegos a los dos).
    const gAdmin = await request(app.getHttpServer())
      .get('/api/caja/cajones-estado')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(gAdmin.status).toBe(200);
    const sesionAdmin = filaDe(gAdmin.body)?.sesion;
    expect(sesionAdmin?.saldoEsperado).not.toBeNull();

    // El esperado del admin es el número de verdad (inicial + los 3000 que
    // acaba de entrar), no un placeholder: si el ciego "revelara" un 0 o el
    // saldo inicial pelado, esta igualdad falla.
    const esperado = (Number(sesionAdmin?.saldoInicial ?? '0') + 3000).toFixed(
      4,
    );
    expect(sesionAdmin?.saldoEsperado).toBe(esperado);

    // El saldo inicial NO es secreto —lo declaró el propio cajero al abrir— y
    // por eso viaja igual para los dos. Si alguien lo retuviera de más, acá se ve.
    expect(sesionSup?.saldoInicial).toBe(sesionAdmin?.saldoInicial);

    // Mismo eje en GET /:id/arqueo, el otro camino que consume `esAdmin`.
    const aSup = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/arqueo`)
      .set('Authorization', `Bearer ${tokenSupervisor}`);
    expect(aSup.status).toBe(200);
    expect((aSup.body as { ciego: boolean }).ciego).toBe(true);
    const aAdmin = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/arqueo`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(aAdmin.status).toBe(200);
    expect((aAdmin.body as { ciego: boolean }).ciego).toBe(false);

    // El apagado del ciego y el cierre de la caja los hace el `afterAll`, que
    // corre también cuando este test falla.
  });
});

/**
 * Aislamiento multi-tenant de caja, que no cubría **ningún** test.
 *
 * El eje que sí estaba cubierto es el de roles dentro de un tenant (cajero vs
 * supervisor). Este es el otro: que la caja de un tenant sea invisible e
 * intocable desde el otro.
 *
 * ⚠️ **La clave del arnés es que ataca la MISMA PERSONA.** `admin@sistema.com`
 * es miembro de los dos tenants del seed, así que la caja se abre con su token
 * de Paris y se ataca con su token de Falabella: mismo `usuario_id`, distinto
 * `tenant_id`. Sin eso el test no prueba aislamiento — la primera versión usaba
 * dos personas distintas y **sobrevivía a que se borrara el scoping por tenant
 * de todo el camino de escritura**, porque lo que cortaba era el chequeo de
 * dueño (`caja.usuarioId !== usuarioId`). Lo midió la revisión independiente.
 * Y es admin en los dos lados, o sea que tampoco lo tapa el guard de permisos.
 */
describe('Caja (e2e) — aislamiento multi-tenant', () => {
  let app: INestApplication<App>;
  let tokenParis: string;
  let tokenFalabella: string;
  let cajaParisId: string;

  async function loginEn(tenantId: string): Promise<string> {
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: MULTI_TENANT.email, password: MULTI_TENANT.pass });
    expect(resLogin.status).toBe(200);
    const res = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set(
        'Cookie',
        (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
      )
      .set(
        'Authorization',
        `Bearer ${(resLogin.body as TokenResponse).access_token}`,
      )
      .send({ tenantId });
    expect(res.status).toBe(200);
    expect([200, 201]).toContain(res.status);
    return (res.body as TokenResponse).access_token;
  }

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

    tokenParis = await loginEn(PARIS_TENANT_ID);
    tokenFalabella = await loginEn(FALABELLA_TENANT_ID);

    const disp = await request(app.getHttpServer())
      .get('/api/caja/cajones-disponibles')
      .set('Authorization', `Bearer ${tokenParis}`);
    expect(disp.status).toBe(200);
    const cajonId = (disp.body as { cajonId: string }[])[0]?.cajonId;
    const abrir = await request(app.getHttpServer())
      .post('/api/caja/abrir')
      .set('Authorization', `Bearer ${tokenParis}`)
      .send({
        cajonId,
        saldoInicial: '50000.0000',
        comentario: 'Apertura E2E aislamiento',
      });
    expect(abrir.status).toBe(201);
    cajaParisId = (abrir.body as { id: string }).id;
  }, 60000);

  afterAll(async () => {
    // El `close` va en un `finally`: cualquier paso de esta limpieza puede
    // tirar —un `query` que falla, una aserción de acá abajo— y sin esto la app
    // de Nest quedaba viva con su `@Cron` escribiéndole a la base desde un
    // módulo desmontado MIENTRAS corren las suites siguientes. El fallo sigue
    // propagando; lo que cambia es que ya no se lleva el cierre puesto.
    // Ver `docs/agent/pendientes.md` § 1.
    try {
      // El teardown **asevera** el cierre: si la caja queda abierta, el cajón
      // queda ocupado y el spec siguiente se lleva un 409 críptico al abrir.
      if (cajaParisId) {
        const conteo = await request(app.getHttpServer())
          .post(`/api/caja/${cajaParisId}/conteo`)
          .set('Authorization', `Bearer ${tokenParis}`)
          .send({ lineas: [{ metodoPagoId: null, montoContado: '50000' }] });
        expect([200, 201]).toContain(conteo.status);
        expect((conteo.body as { estado: string }).estado).toBe('cerrada');
      }
    } finally {
      await app.close();
    }
  });

  // Control: la caja existe y su propio tenant la ve. Sin esto, un 404 para el
  // otro tenant podría venir de que la caja no exista.
  it('control — el mismo usuario, en el tenant dueño, sí ve su caja', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/caja/${cajaParisId}`)
      .set('Authorization', `Bearer ${tokenParis}`);

    expect(res.status).toBe(200);
    expect((res.body as { id: string }).id).toBe(cajaParisId);
  });

  it('desde el otro tenant no se lee, ni por id ni en el listado', async () => {
    const porId = await request(app.getHttpServer())
      .get(`/api/caja/${cajaParisId}`)
      .set('Authorization', `Bearer ${tokenFalabella}`);
    expect(porId.status).toBe(404);

    // ⚠️ `todas=true` a propósito. Sin el flag, el listado filtra además por
    // `usuario_id`, y como acá el usuario es EL MISMO en los dos tenants ese
    // filtro no descarta nada… pero en la primera versión —dos personas
    // distintas— tapaba al de tenant: se midió que borrar el scoping por
    // tenant del historial dejaba el test en verde igual.
    const listado = await request(app.getHttpServer())
      .get('/api/caja?todas=true')
      .set('Authorization', `Bearer ${tokenFalabella}`);
    expect(listado.status).toBe(200);
    const cajas = (listado.body as { data: { id: string }[] }).data;
    expect(Array.isArray(cajas)).toBe(true);
    expect(cajas.some((c) => c.id === cajaParisId)).toBe(false);
  });

  /**
   * ⚠️ Este test NO aísla el filtro de tenant de `bloquearCajaAbierta`, y la
   * razón se midió el 2026-08-16 — **corrigiendo lo que este comentario decía
   * antes**.
   *
   * Decía que el mutante "cuelga la corrida". **Es falso.** Sacándole el
   * `AND tenant_id = $2` a `bloquearCajaAbierta`: este test solo corre en 3,7 s
   * y **pasa**, y el spec entero da **35/35 en 8,5 s**. No hay ningún cuelgue.
   *
   * Lo que pasa de verdad es más ordinario y peor: **el mutante SOBREVIVE**. Las
   * tres defensas de la escritura —`bloquearCajaAbierta`, el `findOne` acotado
   * (`caja.service.ts`, justo debajo del lock) y el chequeo de dueño— son
   * redundantes en la dimensión del tenant, así que sacar la primera deja que
   * la segunda produzca exactamente el mismo no-201 y ninguna aserción cambia.
   *
   * Lo único que el filtro de la PRIMERA aporta por su cuenta es **no tomar un
   * `FOR UPDATE` sobre la fila de otro tenant antes de rechazar**. Eso no es un
   * agujero de datos —el `findOne` frena igual— pero sí deja que un tenant
   * bloquee la caja de otro mientras dura la transacción.
   * ✅ **Eso ya tiene su test (2026-08-26): el que sigue abajo.** No hizo falta
   * mirar `pg_locks` ni abrir el frente de conexiones/deadlock: una compuerta
   * que retiene el lock desde afuera hace observable el bloqueo con una
   * aserción de orden. Este test de acá sigue midiendo lo otro —que la
   * escritura no prospera— y sigue siendo el que NO discrimina el filtro.
   *
   * Lo que sí fija, y es lo que importa: la escritura **no prospera** y la caja
   * del otro tenant **queda intacta**. Un conteo ajeno le congelaría el arqueo
   * y podría cerrarle la caja a otra empresa.
   */
  it('desde el otro tenant no se escribe, y la caja queda intacta', async () => {
    const movimiento = await request(app.getHttpServer())
      .post(`/api/caja/${cajaParisId}/movimientos`)
      .set('Authorization', `Bearer ${tokenFalabella}`)
      // El body tiene que ser VÁLIDO: con `tipo: 'ingreso'` —que no existe— el
      // 400 lo daba el `ValidationPipe` y el test no ejercitaba nada. Medido.
      .send({ tipo: 'entrada', concepto: 'E2E ajeno', monto: '1000.0000' });
    expect(movimiento.status).not.toBe(201);

    // El conteo es el más caro: congela el arqueo y puede cerrarle la caja a
    // otra empresa.
    const conteo = await request(app.getHttpServer())
      .post(`/api/caja/${cajaParisId}/conteo`)
      .set('Authorization', `Bearer ${tokenFalabella}`)
      .send({ lineas: [{ metodoPagoId: null, montoContado: '1' }] });
    expect([200, 201]).not.toContain(conteo.status);

    const despues = await request(app.getHttpServer())
      .get(`/api/caja/${cajaParisId}`)
      .set('Authorization', `Bearer ${tokenParis}`);
    expect(despues.status).toBe(200);
    const caja = despues.body as { estado: string; saldoInicial: string };
    expect(caja.estado).toBe('abierta');
    expect(Number(caja.saldoInicial)).toBe(50000);
  });

  /**
   * El test que le faltaba al de arriba (2026-08-26). Aquél fija que la
   * escritura ajena **no prospera**; éste fija lo único que el filtro de tenant
   * de `bloquearCajaAbierta` aporta **por su cuenta**: no tomar un `FOR UPDATE`
   * sobre la fila de otro tenant antes de rechazar.
   *
   * Por qué hacía falta uno aparte: las tres defensas de la escritura —el lock,
   * el `findOne` acotado y el chequeo de dueño— son redundantes en la dimensión
   * del tenant, así que sacarle el `AND tenant_id = $2` al lock deja que la
   * segunda produzca el mismo no-201 y **ninguna aserción de arriba se mueve**
   * (medido el 2026-08-16: el mutante sobrevive, y el spec entero sigue en
   * verde). Lo que cambia no es el resultado, es si la fila ajena quedó
   * bloqueada mientras dura la transacción.
   *
   * Cómo se observa sin mirar `pg_locks`: una **compuerta**, la misma técnica de
   * `orden-locks-desfases.e2e-spec.ts` y `membresia-ultimo-admin.e2e-spec.ts`.
   * Un `QueryRunner` propio, fuera de Nest, retiene `FOR UPDATE` sobre la caja
   * de Paris; entonces el otro tenant intenta escribir. Con el filtro adentro
   * del `SELECT … FOR UPDATE`, Postgres no bloquea una fila que no matchea el
   * `WHERE`: el rechazo llega **con la compuerta todavía cerrada**. Sin el
   * filtro, la sentencia matchea y se queda esperando a que la compuerta suelte.
   *
   * ⚠️ **Hay DOS presupuestos de tiempo, y conviene saberlo antes de que
   * parpadee:** 3 s para que conteste el tenant ajeno y 5 s para que el dueño
   * se encole. Lo que se afirma es el orden de los eventos, no un tiempo, pero
   * si en una máquina cargada alguno se pasara de su presupuesto el rojo sería
   * indistinguible del que produce el mutante. El margen medido para el primero
   * son casi tres órdenes de magnitud —el 403 ajeno tardó **5 ms** con la fila
   * tomada, medido in-process en esta misma corrida, contra un presupuesto de
   * 3.000—, así que el riesgo es bajo; si igual parpadea, los sospechosos son estos dos números. Los sondeos
   * son de 25 ms, así que el camino sano cuesta lo que tardan las dos requests,
   * no los presupuestos.
   */
  it('la escritura ajena ni siquiera bloquea la fila: el tenant va DENTRO del `FOR UPDATE`', async () => {
    const ds = app.get(DataSource);
    const runner = ds.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    /**
     * Cuántos backends de Postgres están esperando el lock de `cajas` ahora
     * mismo. Es la medición que el repo usa para los locks
     * (`orden-locks-desfases.e2e-spec.ts`), y no un cronómetro: cuenta
     * esperadores, no milisegundos.
     *
     * 🛑 **Va por el pool (`ds.query`), NUNCA por la conexión de la compuerta**,
     * y eso no es estilo: `pg_stat_activity` se **cachea por transacción**. La
     * primera lectura congela la foto y todas las siguientes DENTRO de la misma
     * transacción devuelven esa. Preguntándole a la compuerta —que tiene una
     * transacción abierta de punta a punta— el contador se queda pegado en lo
     * que hubiera al principio: medido, cuatro lecturas byte a byte idénticas
     * mientras la cola cambiaba. Cada `ds.query` corre en su propia
     * transacción implícita, así que siempre ve la foto de ahora.
     * ℹ️ Si alguna vez hace falta leerla DESDE adentro de una transacción, la
     * válvula existe: `SELECT pg_stat_clear_snapshot()` antes de cada lectura.
     */
    async function esperandoElLockDeCajas(): Promise<number> {
      // ⚠️ El `LIKE` ata la medición al TEXTO de la query de
      // `bloquearCajaAbierta` (`caja.service.ts`): si alguien la reformatea o la
      // pasa a query builder (con el nombre entrecomillado), esto deja de
      // matchear y el test
      // se pone rojo apuntando al lugar equivocado. Falla hacia el rojo, nunca
      // hacia el verde, que es la misma propiedad que hace seguros los conteos
      // exactos de abajo sobre una base compartida con el contenedor: un
      // esperador de más rompe el test, no lo aprueba.
      const filas: { n: number }[] = await ds.query(
        `SELECT count(*)::int AS n
           FROM pg_stat_activity
          WHERE datname = current_database()
            AND wait_event_type = 'Lock'
            AND query LIKE '%FROM cajas%'`,
      );
      return Number(filas[0]?.n ?? 0);
    }

    /** Dispara sin esperar: nada se `await`ea mientras la compuerta está
     *  cerrada, así que un camino que se encole no cuelga el spec. El handler
     *  va puesto YA y no re-lanza, para no dejar una rejection sin dueño. */
    function movimiento(
      tipo: 'entrada' | 'salida',
      token: string,
      concepto: string,
    ) {
      const estado = { respondio: false };
      const promesa = request(app.getHttpServer())
        .post(`/api/caja/${cajaParisId}/movimientos`)
        .set('Authorization', `Bearer ${token}`)
        .send({ tipo, concepto, monto: '1000.0000' })
        .then(
          (r) => {
            estado.respondio = true;
            return r;
          },
          () => {
            estado.respondio = true;
            return undefined;
          },
        );
      return { estado, promesa };
    }

    /** Se enciende SOLO si la entrada del control se commiteó de verdad.
     *  ℹ️ Queda una cola inversa, conocida y no cubierta: si el `try` tirara
     *  ENTRE el disparo del control y esta bandera —un `ds.query` del sondeo,
     *  o el propio `rollbackTransaction()`—, la request en vuelo commitea sus
     *  $1.000 y nadie los devuelve. Es mucho más angosta que la que esto
     *  arregla (aquélla la disparaba el `401` fantasma, cuyo mecanismo se cerró el
     *  2026-08-27 — `docs/agent/resueltos.md`) y
     *  cerrarla pediría leer el efectivo de la caja en el `finally` en vez de
     *  llevar bandera: más maquinaria de la que el riesgo justifica, hoy. Atarlo
     *  a "la disparé" saca $1.000 que nunca entraron cuando la request muere en
     *  el camino (un `401` del puerto efímero, un error de socket), y eso
     *  descuadra el arqueo del `afterAll` → la caja termina `en_conciliacion`,
     *  el cajón queda ocupado y el spec siguiente revienta con un 409 críptico. */
    let entroLaPlata = false;
    /** El `try` llegó hasta el final sin tirar. Sirve para no pisar el
     *  diagnóstico del test con el de la compensación. */
    let cerroLimpio = false;
    try {
      const retenida: { caja_id: string }[] = await runner.query(
        `SELECT caja_id FROM cajas
          WHERE caja_id = $1 AND eliminado_el IS NULL
          FOR UPDATE`,
        [cajaParisId],
      );
      // La compuerta enganchó. Sin esto, una que no enganchara dejaría pasar el
      // test aunque el lock ajeno se tomara igual.
      expect(retenida).toHaveLength(1);
      expect(await esperandoElLockDeCajas()).toBe(0);

      // 1) El OTRO tenant escribe con la compuerta cerrada.
      const ajeno = movimiento('entrada', tokenFalabella, 'E2E lock ajeno');
      let colaConElAjeno = 0;
      const limiteAjeno = Date.now() + 3000;
      while (!ajeno.estado.respondio && Date.now() < limiteAjeno) {
        await new Promise((r) => setTimeout(r, 25));
        colaConElAjeno = Math.max(
          colaConElAjeno,
          await esperandoElLockDeCajas(),
        );
      }
      const ajenoRespondioConLaCompuertaCerrada = ajeno.estado.respondio;

      // 2) ⚓ El control que separa este verde del verde de un test mudo: el
      //    MISMO POST, mismo endpoint y mismo body, hecho por el DUEÑO. Recorre
      //    el camino entero hasta ese mismo `SELECT … FOR UPDATE`, ahí sí
      //    matchea, y **tiene que encolarse**. Si algo cortara la request antes
      //    del lock (un guard, el `ValidationPipe`, el `401` del puerto
      //    efímero), la cola quedaría vacía y el test se pondría rojo por el
      //    motivo correcto, en vez de quedarse verde sin haber ejercitado nada.
      const propio = movimiento('entrada', tokenParis, 'E2E lock propio');
      let colaConElDueño = 0;
      const limitePropio = Date.now() + 5000;
      while (colaConElDueño === 0 && Date.now() < limitePropio) {
        await new Promise((r) => setTimeout(r, 25));
        colaConElDueño = await esperandoElLockDeCajas();
      }

      // Soltamos ANTES de afirmar y ANTES de esperar nada: lo que esté encolado
      // hay que destrabarlo igual, o el spec se cuelga en el `afterAll`.
      await runner.rollbackTransaction();
      const resAjeno = await ajeno.promesa;
      const resPropio = await propio.promesa;
      entroLaPlata = resPropio?.status === 201;

      // El ajeno volvió sin que soltáramos, y —lo que de verdad discrimina— no
      // llegó a encolarse: no es que esperó poco, es que no pasó por el lock.
      expect(ajenoRespondioConLaCompuertaCerrada).toBe(true);
      expect(colaConElAjeno).toBe(0);
      expect(resAjeno?.status).not.toBe(201);
      // El dueño sí se encoló, y al soltar escribió: su request estaba viva y
      // detenida en el lock, no muerta en el camino.
      expect(colaConElDueño).toBe(1);
      expect(resPropio?.status).toBe(201);
      cerroLimpio = true;
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
      // La entrada del control es plata de verdad en la caja: sin devolverla el
      // arqueo del `afterAll` no cuadra y la caja termina `en_conciliacion` en
      // vez de `cerrada`. El test deja la caja como la encontró.
      if (entroLaPlata) {
        const vuelta = await movimiento(
          'salida',
          tokenParis,
          'E2E lock propio (devolución)',
        ).promesa;
        // El `expect` solo cuando el `try` cerró limpio: si el test ya venía
        // rojo, un throw acá REEMPLAZA su diagnóstico —el día que el mutante lo
        // mate, el mensaje diría "expected 201" en vez de "el ajeno se encoló"—.
        if (cerroLimpio) {
          expect(vuelta?.status).toBe(201);
        } else if (vuelta?.status !== 201) {
          console.error(
            'La devolución de la compensación falló:',
            vuelta?.status,
            '— la caja queda descuadrada y el afterAll va a fallar por eso.',
          );
        }
      }
    }
  });
});

/**
 * Task 6b (insertada, `2026-08-11-testigo-cierre-forzado`): forzar el cierre
 * deja de exigir ser admin del tenant y pasa a exigir `Cajas:Actualizar`
 * (decisión del owner 2026-08-13) — la misma incoherencia que ya resolvía
 * `POST /caja/:id/testigos` (`Cajas:Actualizar` desde la Task 6), ahora
 * también en la puerta que abre el flujo.
 */
describe('Caja (e2e) — el encargado (Cajas:Actualizar, no admin) fuerza el cierre', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenCajero: string;
  let tokenEncargado: string;
  let tokenSupervisor: string;
  let cajonId: string;

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

    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    tokenCajero = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
    tokenEncargado = await login(app, ENCARGADO_EMAIL, ENCARGADO_PASS);
    tokenSupervisor = await login(app, SUPERVISOR_EMAIL, SUPERVISOR_PASS);

    const r = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `E2E Encargado ${Date.now()}` });
    expect(r.status).toBe(201);
    cajonId = (r.body as CajonResponse).id;
  }, 60000);

  afterAll(async () => {
    // El `close` va en un `finally`: cualquier paso de esta limpieza puede
    // tirar —un `query` que falla, una aserción de acá abajo— y sin esto la app
    // de Nest quedaba viva con su `@Cron` escribiéndole a la base desde un
    // módulo desmontado MIENTRAS corren las suites siguientes. El fallo sigue
    // propagando; lo que cambia es que ya no se lleva el cierre puesto.
    // Ver `docs/agent/pendientes.md` § 1.
    try {
      // Higiene: liberar al cajero si algún `it` lo dejó ocupado (abierta O
      // en_conciliacion — ver el docblock de `liberarCajeroSiQuedoOcupado`),
      // para no arrastrar un 409 a la próxima suite que use `vendedor@paris.cl`.
      await liberarCajeroSiQuedoOcupado(app, tokenCajero, tokenAdmin);
      if (cajonId) {
        await request(app.getHttpServer())
          .delete(`/api/cajones/${cajonId}`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
      }
    } finally {
      await app.close();
    }
  });

  it('el encargado (no admin) fuerza el conteo de la caja del cajero → en_conciliacion, y cierra fase 2 con comentario', async () => {
    const cajaId = await abrirOReusarCaja(app, tokenCajero, cajonId);

    const conteo = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/conteo`)
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send({ lineas: [{ metodoPagoId: null, montoContado: '10000' }] });
    expect(conteo.status).toBe(201);
    // Forzado: pasa por conciliación AUNQUE CUADRE, igual que un admin.
    expect((conteo.body as { estado: string }).estado).toBe('en_conciliacion');

    const sinComentario = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/cerrar`)
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send({ lineas: [] });
    expect(sinComentario.status).toBe(400);

    const cerrar = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/cerrar`)
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send({
        lineas: [],
        comentario: 'Cajero se fue, cierro yo (encargado, no admin)',
      });
    expect([200, 201]).toContain(cerrar.status);

    const detalle = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(detalle.status).toBe(200);
    expect((detalle.body as { estado: string }).estado).toBe('cerrada');
  });

  it('alguien con Cajas:Leer a secas (supervisor) sigue sin poder forzar el cierre: 403', async () => {
    const cajaId = await abrirOReusarCaja(app, tokenCajero, cajonId);

    const res = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/conteo`)
      .set('Authorization', `Bearer ${tokenSupervisor}`)
      .send({ lineas: [{ metodoPagoId: null, montoContado: '10000' }] });

    expect(res.status).toBe(403);
    // Cajas:Leer solo no alcanza ni para el piso de la ruta (ni MiCaja:Actualizar
    // ni Cajas:Actualizar): `resolverEscrituraCompartida` rechaza antes de que el
    // service llegue a mirar si la caja es ajena.
    expect((res.body as { message: string }).message).toBe(
      'No tienes permiso para esta acción',
    );

    // Higiene: el dueño real cierra su propia caja, sin forzado.
    await cerrarEnDosFases(app, cajaId, tokenCajero, [
      { metodoPagoId: null, montoContado: '10000' },
    ]);
  });
});

/**
 * Task 6b — decisión 2: el encargado que fuerza cuenta A CIEGAS igual que
 * cualquier no-admin (`!esAdmin` en `obtenerArqueo`/`cajonesEstado`/
 * `resumenMovimientos`/historial, sin tocar). Antes de esta task, forzar
 * exigía ser admin y el admin está exento del ciego — así que quien forzaba
 * SIEMPRE veía el esperado. Ahora que forzar es operativo, existe por
 * primera vez alguien que fuerza Y cuenta a ciegas: es la razón de ser del
 * cambio (`docs/agent/pendientes.md`, entrada del encargado a ciegas).
 */
describe('Caja (e2e) — el modo ciego SÍ aplica al encargado que fuerza (no admin)', () => {
  let app: INestApplication<App>;
  let tokenCajero: string;
  let tokenAdmin: string;
  let tokenEncargado: string;
  let cajonId: string;
  let ds: DataSource;

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
    ds = app.get(DataSource);

    tokenCajero = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);
    tokenEncargado = await login(app, ENCARGADO_EMAIL, ENCARGADO_PASS);
    const r = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `E2E Ciego Encargado ${Date.now()}` });
    expect(r.status).toBe(201);
    cajonId = (r.body as CajonResponse).id;
  }, 60000);

  afterAll(async () => {
    // El `close` va en un `finally`: cualquier paso de esta limpieza puede
    // tirar —un `query` que falla, una aserción de acá abajo— y sin esto la app
    // de Nest quedaba viva con su `@Cron` escribiéndole a la base desde un
    // módulo desmontado MIENTRAS corren las suites siguientes. El fallo sigue
    // propagando; lo que cambia es que ya no se lleva el cierre puesto.
    // Ver `docs/agent/pendientes.md` § 1.
    try {
      await ds.query(
        'UPDATE tenants SET arqueo_ciego = false WHERE tenant_id = $1',
        [PARIS_TENANT_ID],
      );
      // Higiene best-effort, sin afirmar status: ver el `afterAll` gemelo de
      // más arriba.
      const activa = await request(app.getHttpServer())
        .get('/api/caja/activa')
        .set('Authorization', `Bearer ${tokenCajero}`);
      // status-tolerante: red de limpieza: un rojo de la higiene taparía el del test que la hizo falta
      const abiertaId = (activa.body as CajaResponse | null)?.id;
      if (abiertaId) {
        const motivos = await request(app.getHttpServer())
          .get('/api/motivos-diferencia?soloActivas=true')
          .set('Authorization', `Bearer ${tokenAdmin}`);
        // status-tolerante: red de limpieza: un rojo de la higiene taparía el del test que la hizo falta
        const motivoId = (motivos.body as { id: string }[])[0]?.id;
        await cerrarEnDosFases(
          app,
          abiertaId,
          tokenCajero,
          [{ metodoPagoId: null, montoContado: '0' }],
          [{ metodoPagoId: null, motivoDiferenciaId: motivoId }],
        );
      }
      // Red de seguridad adicional: lo de arriba asume que la caja seguía
      // `abierta` (el conteo con motivo la resuelve si descuadra). Si algún
      // `it` la dejó ya `en_conciliacion` (p.ej. una aserción que aborta el
      // test antes de llegar a cerrarla), esto la libera igual — ver
      // `liberarCajeroSiQuedoOcupado`.
      await liberarCajeroSiQuedoOcupado(app, tokenCajero, tokenAdmin);
      if (cajonId) {
        await request(app.getHttpServer())
          .delete(`/api/cajones/${cajonId}`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
      }
    } finally {
      await app.close();
    }
  });

  it('caja abierta ajena en tenant ciego: el encargado que puede forzar la ve sin el esperado; el admin sí lo ve; forzar el conteo no cambia eso', async () => {
    const cajaId = await abrirOReusarCaja(app, tokenCajero, cajonId);
    await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/movimientos`)
      .set('Authorization', `Bearer ${tokenCajero}`)
      .send({
        tipo: 'entrada',
        concepto: 'venta efectivo',
        monto: '3000.0000',
      });
    await ds.query(
      'UPDATE tenants SET arqueo_ciego = true WHERE tenant_id = $1',
      [PARIS_TENANT_ID],
    );

    // El encargado LLEGA a la caja ajena (Cajas:Leer ⇒ verTodas) y PUEDE
    // forzar su cierre (Cajas:Actualizar) — pero mientras la caja sigue
    // `abierta`, el ciego le retiene igual el esperado: forzar es operativo,
    // el ciego sigue siendo del admin únicamente.
    const arqueoEncargado = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/arqueo`)
      .set('Authorization', `Bearer ${tokenEncargado}`);
    expect(arqueoEncargado.status).toBe(200);
    const bodyEncargado = arqueoEncargado.body as {
      ciego: boolean;
      lineas: ArqueoLinea[];
    };
    expect(bodyEncargado.ciego).toBe(true);
    expect(bodyEncargado.lineas.length).toBeGreaterThan(0);
    for (const linea of bodyEncargado.lineas) {
      expect(linea.esperado).toBeNull();
    }

    // Contraste: el admin sigue exento (decisión del owner, §3.4) — matando
    // el mutante de "el controller ya no distingue admin vs encargado".
    const arqueoAdmin = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/arqueo`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(arqueoAdmin.status).toBe(200);
    const bodyAdmin = arqueoAdmin.body as {
      ciego: boolean;
      lineas: ArqueoLinea[];
    };
    expect(bodyAdmin.ciego).toBe(false);
    expect(bodyAdmin.lineas.find((l) => l.esEfectivo)?.esperado).not.toBeNull();

    // El encargado fuerza el conteo igual, a ciegas: no necesitó ver el
    // esperado para poder cerrar la caja de otro.
    const conteo = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/conteo`)
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send({ lineas: [{ metodoPagoId: null, montoContado: '13000' }] });
    expect(conteo.status).toBe(201);
    expect((conteo.body as { estado: string }).estado).toBe('en_conciliacion');

    const cerrar = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/cerrar`)
      .set('Authorization', `Bearer ${tokenEncargado}`)
      .send({
        lineas: [],
        comentario: 'Cierro a ciegas, nadie firmó como testigo',
      });
    expect([200, 201]).toContain(cerrar.status);

    // El apagado del ciego y el cierre de la caja los hace el `afterAll`
    // como red de seguridad si algo falló antes; acá ya quedó cerrada.
  });
});
