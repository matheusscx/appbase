import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { CajaTestigo } from '../src/modules/caja/entities/caja-testigo.entity';

/**
 * Task 5 (SDD `2026-08-11-testigo-cierre-forzado`): el camino completo del
 * testigo de cierre forzado, contra Postgres real.
 *
 * El diseño de `resolver` tiene DOS vías (decisión del owner, 2026-08-12,
 * ver el docblock de `CajaTestigoService.resolver`):
 *
 * - **Vía cuenta** (prueba fuerte): garzón vinculado (`garzones.usuario_id`,
 *   y esa cuenta no es tótem) → la firma EXIGE que el JWT que llama sea esa
 *   cuenta. El PIN ni se mira. Es el caso que sostiene la feature (caso 2
 *   más abajo): si un encargado pudiera firmar por un garzón vinculado con
 *   solo el PIN, la vía fuerte se podría esquivar siempre.
 * - **Vía PIN** (identifica, no prueba cuenta): sin vínculo, el PIN correcto
 *   alcanza, venga de quien venga. Es un límite ACEPTADO y documentado
 *   (`docs/agent/pendientes.md`), no un descuido — el caso 3 lo deja escrito
 *   en vez de esconderlo.
 *
 * Fixtures propias (nunca Ana Torres — su sesión la comparten seis specs,
 * `docs/agent/README.md` / memoria de sesión): dos garzones nuevos (A sin
 * vínculo, B vinculado por API a `vendedor@paris.cl`) y un turno propio,
 * todo creado en `beforeAll` y limpiado en `afterAll` con status afirmado
 * (mitigación registrada del 401 intermitente, hoy cerrado en
 * `docs/agent/resueltos.md`).
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

// Admin del tenant: rol fijo → short-circuit de permisos (todos). Fuerza el
// cierre de la caja ajena, pide testigos y resuelve por PIN cuando hace falta.
const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
// Dueño real de las cajas de este spec: rol Vendedor, tiene MiCaja pero NO
// Salones — no puede pedir testigos ni operar el salón, solo abrir/cerrar su
// propia caja. Candidato de vínculo para el garzón B (miembro de Paris, no
// tótem, sin garzón propio en el seed).
const VENDEDOR = { email: 'vendedor@paris.cl', pass: 'admin' };
// Tótem: Salones:Operar + es_totem → siempre pide credencial, nunca opera
// "como sí mismo". Es el dispositivo compartido del salón.
const TOTEM = { email: 'totem@paris.cl', pass: 'admin' };

// Cuenta cuadrada exacto con el saldo inicial de `abrirCajaVendedor`: cero
// descuadre, así que la única razón para caer en conciliación es el forzado.
const CONTEO_CUADRA = [{ metodoPagoId: null, montoContado: '10000' }];

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface Member {
  usuarioId: string;
  correo: string;
}
interface GarzonConPinResponse {
  id: string;
  pin: string;
}
interface CajaResponse {
  id: string;
  estado?: string;
}
interface CajaDetalle {
  id: string;
  estado: string;
  usuarioId: string;
  cerradaPor: string | null;
  testigosDisponibles: number | null;
}
interface TestigoResponse {
  id: string;
  cajaId: string;
  garzonId: string;
  estado: string;
  viaFirma: 'cuenta' | 'pin' | null;
  resueltaPorUsuarioId: string | null;
}
interface SolicitudPublicaResponse {
  id: string;
  cajaId: string;
  garzonVinculado: boolean;
  lineas: Record<string, unknown>[];
}
interface GarzonActualizadoResponse {
  advertencias: string[];
}

describe('CajaTestigo (e2e) — camino completo del testigo de cierre forzado', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  let tokenAdmin: string;
  let tokenVendedor: string;
  let tokenTotem: string;

  let adminUsuarioId: string;
  let vendedorUsuarioId: string;
  let totemUsuarioId: string;

  let cajonId: string;
  let turnoId: string;

  let garzonAId: string; // sin vínculo — vía PIN
  let pinA: string;
  let garzonBId: string; // vinculado a VENDEDOR — vía cuenta
  let pinB: string;
  let garzonCId: string; // nunca abre sesión — "sin sesión"
  // Se vincula a la cuenta del ADMIN, y solo dentro de su propio describe:
  // es la única cuenta del seed en Paris que tiene `Salones:Operar` (rol
  // fijo) y no está ya vinculada, así que es la única forma de ejercer la
  // vía cuenta EN POSITIVO por API. Mientras dura el vínculo,
  // `garzonPersonalDe(admin)` deja de ser null, así que se ata y se
  // desata dentro del test (`finally`) y nunca en `beforeAll`.
  let garzonDId: string;
  let pinD: string;

  // Sesiones de A, B y D, para poder cerrarlas en `afterAll` por sesión y no
  // por PIN — B y D quedan con el PIN muerto (ver el comentario de
  // `beforeAll`), así que el cierre de limpieza no puede depender de él.
  let sesionAId: string;
  let sesionBId: string;
  let sesionDId: string;

  async function login(email: string, password: string): Promise<string> {
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
      .send({ tenantId: PARIS_TENANT_ID });
    expect(resTenant.status).toBe(200);
    return (resTenant.body as TokenResponse).access_token;
  }

  async function usuarioIdDe(email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get('/api/tenants/members')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    const miembro = (res.body as Member[]).find((m) => m.correo === email);
    if (!miembro) {
      throw new Error(`No se encontró en /tenants/members el correo ${email}`);
    }
    return miembro.usuarioId;
  }

  async function crearGarzon(nombre: string): Promise<GarzonConPinResponse> {
    const res = await request(app.getHttpServer())
      .post('/api/garzones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre });
    expect(res.status).toBe(201);
    return res.body as GarzonConPinResponse;
  }

  /** Devuelve el id de la sesión — hace falta para cerrarla por sesión en `afterAll`. */
  async function abrirSesion(garzonId: string, pin: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/sesiones-garzon/iniciar')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ turnoId, garzonId, pin });
    expect(res.status).toBe(201);
    return (res.body as { id: string }).id;
  }

  /**
   * Cierre forzado por el encargado (`POST /sesiones-garzon/:id/cerrar`,
   * `Salones:Actualizar`), por SESIÓN y no por PIN. Es el único camino que
   * le queda a `afterAll` para B y D: vincular una cuenta invalida el PIN
   * en el momento (`garzones.service.ts` → `actualizar()`), B queda
   * vinculado todo el spec y D queda con el PIN muerto aunque se desvincule
   * después —desvincular NO lo restaura—, así que ninguno de los dos puede
   * cerrar más por PIN.
   */
  async function cerrarSesionAdmin(
    sesionId: string,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post(`/api/sesiones-garzon/${sesionId}/cerrar`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
  }

  /** Estado de las solicitudes de testigo de una caja, vía `Cajas:Leer` — no depende de PIN ni de cuenta vinculada. */
  async function listarTestigos(
    cajaId: string,
  ): Promise<{ id: string; estado: string }[]> {
    const res = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/testigos`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    return res.body as { id: string; estado: string }[];
  }

  /**
   * Si el vendedor quedó con una caja abierta o en conciliación —residuo de
   * una corrida local abortada, o de un `it` anterior que falló a mitad de
   * su propio lifecycle antes de llegar a `cerrarFase2`—, la cierra del
   * todo. Sin esto, un solo assert que falla en un `describe` deja al
   * vendedor "ocupado" y cada `describe` posterior revienta en cascada por
   * `ux_cajas_activa_por_usuario`, disfrazando de "muchos tests rotos" lo
   * que en realidad es un solo fallo real más arriba.
   */
  async function cerrarCualquierCajaAbiertaDelVendedor(): Promise<void> {
    const resActiva = await request(app.getHttpServer())
      .get('/api/caja/activa')
      .set('Authorization', `Bearer ${tokenVendedor}`);
    const activa = resActiva.body as CajaResponse | null;
    if (!activa?.id) return;

    if (activa.estado === 'abierta') {
      await request(app.getHttpServer())
        .post(`/api/caja/${activa.id}/conteo`)
        .set('Authorization', `Bearer ${tokenVendedor}`)
        .send({ lineas: CONTEO_CUADRA });
    }
    // El conteo de arriba puede haber dejado la caja `cerrada` directo
    // (cuadra, dueño real) o en `en_conciliacion` si el vendedor no era el
    // dueño original — cualquiera de las dos, `cerrar` fase 2 la termina;
    // sobre una caja ya `cerrada` el service la rechaza con 400, que acá se
    // ignora a propósito (higiene, no una aserción).
    await request(app.getHttpServer())
      .post(`/api/caja/${activa.id}/cerrar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        lineas: [],
        comentario: 'Higiene E2E: cierre de residuo entre tests',
      });
  }

  /**
   * Abre una caja física para el vendedor sobre el cajón dedicado de este
   * spec, garantizando que arranca limpia (ver
   * `cerrarCualquierCajaAbiertaDelVendedor`).
   */
  async function abrirCajaVendedor(): Promise<string> {
    await cerrarCualquierCajaAbiertaDelVendedor();
    const resAbrir = await request(app.getHttpServer())
      .post('/api/caja/abrir')
      .set('Authorization', `Bearer ${tokenVendedor}`)
      .send({
        cajonId,
        saldoInicial: '10000.0000',
        comentario: 'Apertura E2E testigo',
      });
    expect(resAbrir.status).toBe(201);
    return (resAbrir.body as CajaResponse).id;
  }

  /** Fase 1, forzada por el admin (dueño real: el vendedor). */
  async function conteoForzado(
    cajaId: string,
    comentario?: string,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/conteo`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ lineas: CONTEO_CUADRA, ...(comentario ? { comentario } : {}) });
  }

  async function detalleCaja(cajaId: string): Promise<CajaDetalle> {
    const res = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    return res.body as CajaDetalle;
  }

  async function pedirTestigos(
    cajaId: string,
    garzonIds: string[],
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/testigos`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ garzonIds });
  }

  async function pendientes(
    token: string,
    credencial: { garzonId?: string; pin?: string } = {},
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post('/api/caja/testigos/pendientes')
      .set('Authorization', `Bearer ${token}`)
      .send(credencial);
  }

  async function resolverTestigo(
    token: string,
    testigoId: string,
    body: { firma: boolean; pin?: string; comentario?: string },
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post(`/api/caja/testigos/${testigoId}/resolver`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  async function cerrarFase2(
    cajaId: string,
    token: string,
    comentario?: string,
  ): Promise<request.Response> {
    return request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/cerrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [], ...(comentario ? { comentario } : {}) });
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
    dataSource = app.get(DataSource);

    tokenAdmin = await login(ADMIN.email, ADMIN.pass);
    tokenVendedor = await login(VENDEDOR.email, VENDEDOR.pass);
    tokenTotem = await login(TOTEM.email, TOTEM.pass);

    adminUsuarioId = await usuarioIdDe(ADMIN.email);
    vendedorUsuarioId = await usuarioIdDe(VENDEDOR.email);
    totemUsuarioId = await usuarioIdDe(TOTEM.email);

    const resCajon = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `E2E Testigo ${Date.now()}` });
    expect(resCajon.status).toBe(201);
    cajonId = (resCajon.body as IdResponse).id;

    const resTurno = await request(app.getHttpServer())
      .post('/api/turnos')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `E2E Testigo ${Date.now()}`,
        horaInicio: '08:00',
        horaFin: '23:00',
      });
    expect(resTurno.status).toBe(201);
    turnoId = (resTurno.body as IdResponse).id;

    const gA = await crearGarzon(`Testigo A ${Date.now()}`);
    garzonAId = gA.id;
    pinA = gA.pin;
    const gB = await crearGarzon(`Testigo B ${Date.now()}`);
    garzonBId = gB.id;
    pinB = gB.pin;
    const gC = await crearGarzon(`Testigo C sin sesión ${Date.now()}`);
    garzonCId = gC.id;
    const gD = await crearGarzon(`Testigo D con cuenta ${Date.now()}`);
    garzonDId = gD.id;
    pinD = gD.pin;

    // A, B y D quedan con sesión abierta todo el spec — la "sesión abierta
    // ahora" que exige `solicitar`. C nunca abre sesión: es el garzón "sin
    // sesión" del caso 10. Las tres se abren por PIN ANTES de vincular a
    // B: `iniciar` resuelve la credencial con `verificarPin`, que compara
    // contra `garzones.pin_hash`, y vincular una cuenta lo pisa con
    // `PIN_INUTILIZABLE` en el mismo instante (`garzones.service.ts` →
    // `actualizar()`). Si B se vinculara antes, `abrirSesion(garzonBId,
    // pinB)` fallaría con 400 acá mismo, en `beforeAll`.
    sesionAId = await abrirSesion(garzonAId, pinA);
    sesionBId = await abrirSesion(garzonBId, pinB);
    sesionDId = await abrirSesion(garzonDId, pinD);

    // B se vincula por API (PATCH), no por SQL — es justo el camino que
    // `assertVinculable` protege. Va DESPUÉS de abrir su sesión (ver arriba):
    // la sesión ya está creada y vive independiente de lo que le pase al PIN
    // después.
    const vincular = await request(app.getHttpServer())
      .patch(`/api/garzones/${garzonBId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ usuarioId: vendedorUsuarioId });
    expect(vincular.status).toBe(200);

    // Cobertura e2e de `puede_operar_salon` contra Postgres real (revisión
    // independiente: el SQL de 8 JOIN + 2 EXISTS de `assertVinculable` no
    // estaba asertado en ningún lado — en unit el valor viene de un mock).
    // vendedor@paris.cl (VENDEDOR, `:41-42` de este archivo) tiene rol
    // Vendedor, SIN `Salones` — el caso real, no inventado, de una cuenta
    // que vincula pero no puede operar el salón. B ya tiene sesión abierta
    // (línea de arriba), así que acá tienen que salir LAS DOS advertencias:
    // la de permiso (aplica siempre que vincula) y la de sesión abierta
    // (bifurcada porque no tiene el permiso). Se distinguen por "sesión
    // abierta", que solo la segunda menciona — sin eso, dos copias
    // accidentales de la misma advertencia pasarían el `toHaveLength(2)`
    // igual.
    const advertenciasB = (vincular.body as GarzonActualizadoResponse)
      .advertencias;
    expect(advertenciasB).toHaveLength(2);
    const [conSesionB, sinSesionB] = [
      advertenciasB.filter((a) => a.includes('sesión abierta')),
      advertenciasB.filter((a) => !a.includes('sesión abierta')),
    ];
    expect(conSesionB).toHaveLength(1);
    expect(sinSesionB).toHaveLength(1);
    for (const msg of advertenciasB) {
      expect(msg).toContain('permiso');
      expect(msg).toContain('modo personal');
      expect(msg).toContain('tótem');
    }
  }, 60000);

  /**
   * La limpieza **afirma su status** —una limpieza que falla en silencio deja
   * una caja o una sesión abiertas y rompe a OTRO spec con un error que no
   * tiene nada que ver (`docs/agent/pendientes.md`, mitigación del 401
   * intermitente)—, pero `app.close()` corre SIEMPRE, en el `finally`.
   *
   * Medido con el mutante M2 de esta task: con la limpieza afirmando
   * derecho, un fallo en el `delete` del cajón (409, quedaba ocupado por el
   * `it` que ya había fallado) tiraba la excepción ANTES del `close`, la app
   * de Nest quedaba viva con su pool abierto y **jest imprimía el resultado y
   * después no terminaba nunca** — 7 minutos sin CPU ni queries. Un mutante
   * que mata un test se veía igual que un entorno colgado. Por eso los
   * errores se acumulan y se afirman DESPUÉS de cerrar: el diagnóstico se
   * conserva sin costar la salida del proceso.
   */
  afterAll(async () => {
    const fallos: string[] = [];
    const limpiar = async (que: string, ejecutar: () => Promise<number>) => {
      try {
        const status = await ejecutar();
        if (status !== 200) fallos.push(`${que} → ${status}`);
      } catch (e) {
        fallos.push(`${que} → ${(e as Error).message}`);
      }
    };

    try {
      // Liberar al vendedor ANTES que nada (revisión independiente,
      // hallazgo 6). `vendedor@paris.cl` es del seed y lo comparten
      // `caja.e2e-spec.ts` y `motivos-diferencia.e2e-spec.ts`, y la suite
      // corre serial (`jest-e2e.json`, maxWorkers 1). Si un `it` falla a
      // mitad de su ciclo, su caja queda `abierta` o `en_conciliacion`:
      // `ux_cajas_activa_por_usuario` cuenta las dos, así que el vendedor
      // sigue ocupado para los specs siguientes. El borrado del cajón NO lo
      // detecta —solo bloquea con estado `abierta`— así que sin esta línea
      // la limpieza "pasa" y deja la mina puesta.
      await limpiar('liberar caja del vendedor', async () => {
        await cerrarCualquierCajaAbiertaDelVendedor();
        return 200;
      });

      // Cerrar sesión ANTES de borrar: `eliminar()`/`turnos.eliminar()`
      // rechazan con sesión abierta (`assertSinSesionAbierta`).
      //
      // Por SESIÓN (`cerrarSesionAdmin`, admin forzando el cierre), no por
      // PIN: vincular una cuenta invalida el PIN del garzón en el mismo
      // instante (`garzones.service.ts` → `actualizar()`, transición
      // `usuarioId: null → uuid`), y acá B queda vinculado durante TODO el
      // spec (nunca se desvincula) y D queda con el PIN muerto aunque su
      // propio test lo desvincule después —desvincular NO restaura el PIN
      // que la vinculación mató—. El cierre "por PIN" que usaba esta
      // limpieza antes de este fix dejó de poder cerrar la sesión de
      // NINGUNO de los dos: no es un bug de la limpieza, es la consecuencia
      // esperada de que el PIN que el encargado conocía dejó de servir. El
      // cierre por sesión no depende de esa prueba de identidad, así que
      // sirve para los tres (A incluido, por uniformidad).
      for (const [garzonId, sesionId] of [
        [garzonAId, sesionAId],
        [garzonBId, sesionBId],
        [garzonDId, sesionDId],
      ]) {
        await limpiar(`cerrar sesión ${garzonId}`, async () => {
          const res = await cerrarSesionAdmin(sesionId);
          // `cerrar` responde 201 (POST), no 200.
          return res.status === 201 ? 200 : res.status;
        });
      }

      for (const id of [garzonAId, garzonBId, garzonCId, garzonDId]) {
        await limpiar(
          `borrar garzón ${id}`,
          async () =>
            (
              await request(app.getHttpServer())
                .delete(`/api/garzones/${id}`)
                .set('Authorization', `Bearer ${tokenAdmin}`)
            ).status,
        );
      }
      await limpiar(
        'borrar turno',
        async () =>
          (
            await request(app.getHttpServer())
              .delete(`/api/turnos/${turnoId}`)
              .set('Authorization', `Bearer ${tokenAdmin}`)
          ).status,
      );
      await limpiar(
        'borrar cajón',
        async () =>
          (
            await request(app.getHttpServer())
              .delete(`/api/cajones/${cajonId}`)
              .set('Authorization', `Bearer ${tokenAdmin}`)
          ).status,
      );
    } finally {
      await app.close();
    }

    expect(fallos).toEqual([]);
  });

  it('la app levanta con CajaTestigo registrada en el DataSource', () => {
    expect(dataSource.isInitialized).toBe(true);
    expect(dataSource.getMetadata(CajaTestigo).tableName).toBe('caja_testigo');
  });

  /**
   * Caso 1 (camino feliz, vía PIN) + caso 10 (garzón sin sesión no escribe
   * nada) + caso 4 (cierre ciego: `pendientes` nunca devuelve `esperado`).
   * Se comparten porque conviven naturalmente en la misma caja: el chequeo
   * de "no escribe nada" se prueba justo ANTES de pedir la firma real de A.
   */
  describe('caso 1 — camino feliz vía PIN (+ caso 10, + caso 4)', () => {
    let cajaId: string;

    it('vendedor abre, admin fuerza el conteo (cuadra) → en_conciliacion', async () => {
      cajaId = await abrirCajaVendedor();
      const res = await conteoForzado(cajaId);
      expect(res.status).toBe(201);
      expect((res.body as { estado: string }).estado).toBe('en_conciliacion');
    });

    it('caso 10 — [A, sinSesión] no escribe nada: la lista completa o nada', async () => {
      const fallida = await pedirTestigos(cajaId, [garzonAId, garzonCId]);
      expect(fallida.status).toBe(400);

      // Si la fila de A se hubiera guardado igual, este segundo pedido —solo
      // A, sobre la MISMA caja— chocaría con el índice único de "solicitud
      // viva" (23505 traducido a 400). Que pase en verde prueba que nada
      // quedó escrito del intento anterior.
      const solaA = await pedirTestigos(cajaId, [garzonAId]);
      expect(solaA.status).toBe(201);
    });

    let testigoAId: string;

    it('caso 4 — el tótem con garzonId+pin de A ve la solicitud, nunca "esperado"', async () => {
      const res = await pendientes(tokenTotem, {
        garzonId: garzonAId,
        pin: pinA,
      });
      expect(res.status).toBe(201);
      const solicitudes = res.body as SolicitudPublicaResponse[];
      expect(solicitudes).toHaveLength(1);
      expect(solicitudes[0].cajaId).toBe(cajaId);
      expect(solicitudes[0].garzonVinculado).toBe(false);
      testigoAId = solicitudes[0].id;

      // Las claves EXACTAS, no `arrayContaining` (revisión independiente,
      // hallazgo 4): con `arrayContaining` cualquier clave de más pasa
      // verde, y un `esperadoTotal` o un `diferencia` que se filtre a
      // futuro es exactamente la puerta de atrás del cierre ciego que este
      // test existe para cerrar. Sobre las CLAVES y no sobre valores: un
      // `esperado: null` también sería una filtración de forma.
      expect(Object.keys(solicitudes[0]).sort()).toEqual([
        'cajaId',
        'garzonVinculado',
        'id',
        'lineas',
        'solicitadaEl',
      ]);
      expect(solicitudes[0].lineas.length).toBeGreaterThan(0);
      for (const linea of solicitudes[0].lineas) {
        expect(Object.keys(linea).sort()).toEqual([
          'contado',
          'esEfectivo',
          'metodoPagoId',
          'nombre',
        ]);
      }
    });

    it('el tótem firma por A (vía PIN) y el cierre sin comentario funciona', async () => {
      const firmar = await resolverTestigo(tokenTotem, testigoAId, {
        firma: true,
        pin: pinA,
      });
      expect(firmar.status).toBe(201);
      const testigo = firmar.body as TestigoResponse;
      expect(testigo.estado).toBe('firmada');
      expect(testigo.viaFirma).toBe('pin');
      // El hecho crudo de quién tecleó: la cuenta del tótem, no el garzón.
      expect(testigo.resueltaPorUsuarioId).toBe(totemUsuarioId);

      const cerrar = await cerrarFase2(cajaId, tokenAdmin);
      expect(cerrar.status).toBe(201);

      const detalle = await detalleCaja(cajaId);
      expect(detalle.estado).toBe('cerrada');
      expect(detalle.usuarioId).toBe(vendedorUsuarioId);
      // Cerró un admin que no es el dueño.
      expect(detalle.cerradaPor).toBe(adminUsuarioId);
      expect(detalle.cerradaPor).not.toBe(detalle.usuarioId);
      // Al menos A y B, que quedan en sesión todo el spec — no un valor
      // exacto: otros specs del mismo tenant pueden dejar sesiones propias
      // abiertas en la misma corrida completa de test:e2e.
      expect(typeof detalle.testigosDisponibles).toBe('number');
      expect(detalle.testigosDisponibles as number).toBeGreaterThanOrEqual(2);
    });
  });

  /**
   * Caso 2 (el que más importa: con cuenta vinculada el encargado NO puede
   * firmar, aunque tenga el PIN correcto) + caso 3 (el límite aceptado de
   * la vía PIN, sin vínculo) + caso 5 (el tótem no puede espiar a otro
   * garzón). Comparten la misma caja porque las tres necesitan a A y B
   * pedidos juntos.
   */
  describe('caso 2 — vía cuenta bloquea al encargado (+ caso 3, + caso 5)', () => {
    let cajaId: string;
    let testigoAId: string;
    let testigoBId: string;

    it('vendedor abre, admin fuerza el conteo, se pide testigo a A y B', async () => {
      cajaId = await abrirCajaVendedor();
      const conteo = await conteoForzado(cajaId);
      expect(conteo.status).toBe(201);
      expect((conteo.body as { estado: string }).estado).toBe(
        'en_conciliacion',
      );

      const pedido = await pedirTestigos(cajaId, [garzonAId, garzonBId]);
      expect(pedido.status).toBe(201);
      const [tA, tB] = pedido.body as TestigoResponse[];
      testigoAId = (tA.garzonId === garzonAId ? tA : tB).id;
      testigoBId = (tB.garzonId === garzonBId ? tB : tA).id;
    });

    it('caso 5 — el tótem sin credencial no ve nada: 400', async () => {
      const res = await pendientes(tokenTotem);
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain(
        'Elegí el garzón',
      );
    });

    it('caso 5 — garzonId de B con el PIN de A no revela nada de B (hoy: cualquier PIN falla, B está vinculado)', async () => {
      const res = await pendientes(tokenTotem, {
        garzonId: garzonBId,
        pin: pinA,
      });
      // B está vinculado (`beforeAll`): su `pinHash` quedó en
      // `PIN_INUTILIZABLE` ('!'), así que CUALQUIER PIN falla acá — no
      // específicamente el de A. Este 400 ya no prueba por sí solo "el PIN
      // se verifica contra el garzón indicado, no contra cualquiera" (esa
      // discriminación quedó cubierta a nivel unit, con un garzón SIN
      // vincular: `garzones.service.spec.ts` → `describe('verificarPin')`,
      // "lanza 400 si el PIN no coincide" + "hace UNA sola consulta y no
      // recorre a los demás garzones"); lo que este caso sigue probando en
      // e2e es que ni siquiera un PIN ajeno "real" cuela contra un
      // vinculado.
      expect(res.status).toBe(400);
      // El motivo, no solo el número: un 400 acá también podría venir del
      // `ValidationPipe` si mañana `CredencialGarzonOpcionalDto` se
      // endurece, y eso dejaría de probar que el request llegó a
      // `verificarPin`/`bcrypt.compare` (revisión independiente, hallazgo 5).
      expect((res.body as { message: string }).message).toContain(
        'PIN inválido',
      );
    });

    it('el PIN QUE B TENÍA antes de vincularse ya no sirve ni para él mismo', async () => {
      // Entrada 9 de `docs/agent/pendientes.md` (grupo e2e): el caso de
      // arriba usa el PIN de A contra B, que fallaría igual aunque B nunca
      // se hubiera vinculado — es un PIN ajeno, nunca coincidió con el hash
      // de B. Este usa `pinB`, el PIN que SÍ era correcto para garzonBId
      // hasta el `PATCH` de vínculo en `beforeAll` (`garzones.service.ts` →
      // `actualizar()`, rama `vincular`: `garzon.pinHash =
      // PIN_INUTILIZABLE`). Si esa línea no corriera, `bcrypt.compare(pinB,
      // garzon.pinHash)` seguiría dando `true` y `pendientesDeGarzon` no
      // tiraría 400 acá — es el ángulo que el docblock de "vía cuenta en
      // positivo" (más abajo, con D) deja anotado como sin caso dedicado.
      const res = await pendientes(tokenTotem, {
        garzonId: garzonBId,
        pin: pinB,
      });
      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain(
        'PIN inválido',
      );
    });

    it('caso 2 — el encargado con el PIN que emitió para B (vinculado) recibe 403', async () => {
      // `pinB` ya NO es "el PIN correcto de B" — B está vinculado
      // (`beforeAll`) y su `pinHash` quedó en `PIN_INUTILIZABLE`, así que
      // ningún PIN es correcto para B a esta altura. Se manda igual a
      // propósito: prueba que la rama "vía cuenta" de `resolver()` ni
      // siquiera LLEGA a mirar el PIN —`esVinculacionValida` corta antes—,
      // así que da lo mismo si el que se manda es el que el encargado
      // conocía, uno inventado, o ninguno.
      const res = await resolverTestigo(tokenAdmin, testigoBId, {
        firma: true,
        pin: pinB,
      });
      expect(res.status).toBe(403);
      // El MOTIVO, no solo el número (revisión independiente, hallazgo 1):
      // sin esto, un mutante que tire 403 apenas ve `usuarioId` seteado —sin
      // compararlo con el que llama— deja verde este caso Y el caso 3, con
      // la vía fuerte inservible. El mensaje ata el 403 a la rama de
      // `resolver`, no al `PermisosGuard` (el admin tiene rol fijo: el guard
      // nunca lo rechaza, y el caso 3 lo prueba usando el MISMO token y la
      // MISMA ruta para obtener un 201).
      expect((res.body as { message: string }).message).toContain(
        'vinculado a una cuenta',
      );
    });

    it('caso 3 — sin vínculo, el encargado con el PIN correcto de A SÍ firma (límite aceptado de la vía PIN)', async () => {
      // Documentado, no un descuido (docs/agent/pendientes.md, entrada del
      // PIN): el PIN identifica al garzón, no prueba quién lo tecleó. Sin
      // vínculo personal es la única prueba disponible, y el registro dice
      // la verdad de quién mandó el request (`resueltaPorUsuarioId`), no de
      // quién estaba físicamente frente al garzón.
      const res = await resolverTestigo(tokenAdmin, testigoAId, {
        firma: true,
        pin: pinA,
      });
      expect(res.status).toBe(201);
      const testigo = res.body as TestigoResponse;
      expect(testigo.estado).toBe('firmada');
      expect(testigo.viaFirma).toBe('pin');
      expect(testigo.resueltaPorUsuarioId).toBe(adminUsuarioId);
    });

    it('con A firmada, el cierre sin comentario funciona y la pendiente de B se cancela', async () => {
      // ANTES de cerrar: B sigue pendiente. B está vinculado (`beforeAll`),
      // así que su PIN ya está muerto (`actualizar()` lo invalida en el
      // mismo PATCH que lo ata) y el tótem no tiene forma de demostrar que
      // es B para leer `pendientes`. Se lee por la vía del ENCARGADO
      // (`Cajas:Leer`, sin PIN ni cuenta de por medio) — el mismo dato que
      // vería el panel de resumen del turno.
      const antes = await listarTestigos(cajaId);
      expect(antes.find((t) => t.id === testigoBId)?.estado).toBe('pendiente');

      const cerrar = await cerrarFase2(cajaId, tokenAdmin);
      expect(cerrar.status).toBe(201);

      // DESPUÉS: cancelada, no colgada. Sin esta aserción, `cancelarPendientes`
      // (`caja.service.ts`) se puede borrar entero y el spec sigue verde
      // (revisión independiente, hallazgo 3).
      const despues = await listarTestigos(cajaId);
      expect(despues.find((t) => t.id === testigoBId)?.estado).toBe(
        'cancelada',
      );
    });
  });

  /**
   * La otra mitad del caso 2, que el fixture original no podía montar
   * (revisión independiente, hallazgo 2): el caso 2 prueba que el encargado
   * **no** puede firmar por un garzón con cuenta, pero nadie probaba que la
   * cuenta dueña **sí** pueda. Sin este test, `via_firma: 'cuenta'` no se
   * ejerce nunca por HTTP: si el cableado de esa rama estuviera roto, la
   * feature quedaría inservible justo en su configuración más fuerte y la
   * suite seguiría verde.
   *
   * No se puede usar a B: está vinculado a `vendedor@paris.cl`, cuyo rol no
   * tiene `Salones` (`seedVendedorPermisosCaja`), así que esa cuenta comería
   * 403 del `PermisosGuard` antes de llegar a `resolver` — un 403 que
   * parecería el mismo del caso 2 y no probaría nada. Por eso D se ata a la
   * cuenta del admin, que sí tiene `Salones:Operar`, y solo mientras dura
   * este test.
   */
  describe('vía cuenta en positivo — el garzón vinculado firma desde su cuenta', () => {
    it('con D atado a esa cuenta, el mismo token que antes daba 403 ahora firma como "cuenta"', async () => {
      const cajaId = await abrirCajaVendedor();
      expect((await conteoForzado(cajaId)).status).toBe(201);

      const pedido = await pedirTestigos(cajaId, [garzonDId]);
      expect(pedido.status).toBe(201);
      const testigoDId = (pedido.body as TestigoResponse[])[0].id;

      const vincular = await request(app.getHttpServer())
        .patch(`/api/garzones/${garzonDId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ usuarioId: adminUsuarioId });
      expect(vincular.status).toBe(200);

      // El caso positivo de `puede_operar_salon`, contra Postgres real: el
      // admin SÍ tiene `Salones:Operar` (rol fijo), así que la advertencia
      // de "no puede operar el salón" no tiene que aparecer acá — solo la
      // de sesión abierta (D ya tenía una desde `beforeAll`), y con el
      // texto que promete la cuenta, no el que la niega.
      const advertenciasD = (vincular.body as GarzonActualizadoResponse)
        .advertencias;
      expect(advertenciasD).toHaveLength(1);
      expect(advertenciasD[0]).toContain('puede seguir trabajando');
      expect(advertenciasD[0]).not.toContain('permiso');

      try {
        // La pantalla ya lo anuncia: con vínculo válido no se pide PIN. Y ya
        // no PUEDE pedirlo: el PATCH de arriba mató el PIN de D en el mismo
        // instante en que lo ató (`actualizar()`), así que el tótem no
        // tiene forma de demostrar que es D. Se lee desde LA CUENTA
        // vinculada (admin, sin credencial: `resolverGarzonActuante` la
        // resuelve directo por el JWT), que es justo la vía que esta prueba
        // existe para ejercer.
        //
        // ⚠️ Con este cambio, `garzonVinculado` quedó TAUTOLÓGICO acá: al
        // resolver por `garzonPersonalDe` (personal, sin credencial),
        // `esVinculacionValida` ya exige `usuario_id` seteado — no puede
        // dar otra cosa que `true`. Es fiel a la vía cuenta (lo que este
        // test existe para probar), pero YA NO discrimina el caso
        // "vinculado pero se lee desde afuera, tótem + PIN" que sí ejercía
        // la versión vieja de este mismo test.
        //
        // Esa discriminación SÍ sigue cubierta —corregido: dije lo
        // contrario en una revisión anterior de este comentario, y era
        // falso— pero en OTROS dos lugares, no acá:
        // - `caso 5` de este mismo archivo (`'garzonId de B con el PIN de A
        //   no revela nada de B'`, más arriba): tótem + `pendientes` contra
        //   B (vinculado) con un PIN ajeno → 400. Mismo endpoint
        //   (`pendientesDeGarzon`) que este test, mismo mecanismo.
        // - `garzon-modo-personal.e2e-spec.ts` ('un garzón vinculado sigue
        //   en el selector del tótem, pero su PIN viejo ya no abre la
        //   puerta'): tótem + `/sesiones-garzon/activa` contra Ana
        //   (vinculada) con su PIN REAL viejo (no uno ajeno inventado) →
        //   400, más la aserción de que sigue en el selector.
        //
        // Lo que NINGUNO de los dos prueba es el caso exacto que ESTE test
        // perdió: tótem + `pendientes` contra un vinculado usando el PIN
        // QUE ESE GARZÓN tenía antes de vincularse (acá sería D con su
        // `pinD` viejo, no un PIN ajeno) — caso 5 usa un PIN de otro
        // garzón, no el propio viejo. Ese ángulo específico no tiene caso
        // dedicado.
        const verPendientes = await pendientes(tokenAdmin);
        expect(verPendientes.status).toBe(201);
        expect(
          (verPendientes.body as SolicitudPublicaResponse[]).find(
            (s) => s.id === testigoDId,
          )?.garzonVinculado,
        ).toBe(true);

        // Y firma SIN mandar PIN: la identidad la prueba el JWT.
        const firmar = await resolverTestigo(tokenAdmin, testigoDId, {
          firma: true,
        });
        expect(firmar.status).toBe(201);
        const testigo = firmar.body as TestigoResponse;
        expect(testigo.estado).toBe('firmada');
        expect(testigo.viaFirma).toBe('cuenta');
        expect(testigo.resueltaPorUsuarioId).toBe(adminUsuarioId);
      } finally {
        // Desatar SIEMPRE: con el vínculo puesto, `garzonPersonalDe(admin)`
        // devuelve D y toda credencial que el admin mande después se
        // ignora — rompería el resto del spec y la limpieza.
        const desvincular = await request(app.getHttpServer())
          .patch(`/api/garzones/${garzonDId}`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ usuarioId: null });
        expect(desvincular.status).toBe(200);
      }

      expect((await cerrarFase2(cajaId, tokenAdmin)).status).toBe(201);
    });
  });

  /** Caso 6 — rechazo: no cuenta como firma, el cierre exige comentario. */
  describe('caso 6 — rechazo', () => {
    let cajaId: string;

    it('A rechaza con comentario; cerrar sin comentario 400, con comentario 201', async () => {
      cajaId = await abrirCajaVendedor();
      const conteo = await conteoForzado(cajaId);
      expect(conteo.status).toBe(201);

      const pedido = await pedirTestigos(cajaId, [garzonAId]);
      expect(pedido.status).toBe(201);
      const testigoId = (pedido.body as TestigoResponse[])[0].id;

      const rechazo = await resolverTestigo(tokenTotem, testigoId, {
        firma: false,
        pin: pinA,
        comentario: 'No coincide con lo que conté en mi turno',
      });
      expect(rechazo.status).toBe(201);
      expect((rechazo.body as TestigoResponse).estado).toBe('rechazada');

      // Rechazo ≠ firma: `hayFirmaDe` sigue en false, el cierre exige
      // explicación igual que si nadie hubiera respondido.
      const sinComentario = await cerrarFase2(cajaId, tokenAdmin);
      expect(sinComentario.status).toBe(400);

      const conComentario = await cerrarFase2(
        cajaId,
        tokenAdmin,
        'Testigo rechazó; cierro igual con explicación',
      );
      expect(conComentario.status).toBe(201);
    });
  });

  /**
   * Caso 7 — sin testigo pedido: fase 2 exige comentario, y el de fase 1
   * alcanza como fallback (para no dejar el cierre inoperable si el
   * comentario de fase 1 ya explicó qué pasó).
   */
  describe('caso 7 — sin testigo', () => {
    it('sin comentario en ninguna fase → 400; con comentario en fase 2 → 201', async () => {
      const cajaId = await abrirCajaVendedor();
      const conteo = await conteoForzado(cajaId);
      expect(conteo.status).toBe(201);
      expect((conteo.body as { estado: string }).estado).toBe(
        'en_conciliacion',
      );

      const sinComentario = await cerrarFase2(cajaId, tokenAdmin);
      expect(sinComentario.status).toBe(400);

      const conComentario = await cerrarFase2(
        cajaId,
        tokenAdmin,
        'Nadie firmó, cierro con explicación en fase 2',
      );
      expect(conComentario.status).toBe(201);
    });

    it('el comentario de fase 1 alcanza como fallback: fase 2 sin comentario cierra igual', async () => {
      const cajaId = await abrirCajaVendedor();
      const conteo = await conteoForzado(
        cajaId,
        'Cajero se fue sin cerrar, cuento yo',
      );
      expect(conteo.status).toBe(201);
      expect((conteo.body as { estado: string }).estado).toBe(
        'en_conciliacion',
      );

      const sinComentario = await cerrarFase2(cajaId, tokenAdmin);
      expect(sinComentario.status).toBe(201);
    });
  });

  /** Caso 8 — cierre normal intacto: el dueño cierra su propia caja que cuadra. */
  describe('caso 8 — cierre normal intacto', () => {
    it('el dueño cierra su propia caja cuadrada → cerrada directo, sin conciliación', async () => {
      const cajaId = await abrirCajaVendedor();
      const conteo = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/conteo`)
        .set('Authorization', `Bearer ${tokenVendedor}`)
        .send({ lineas: CONTEO_CUADRA });
      expect(conteo.status).toBe(201);
      expect((conteo.body as { estado: string }).estado).toBe('cerrada');

      const detalle = await detalleCaja(cajaId);
      expect(detalle.estado).toBe('cerrada');
      expect(detalle.cerradaPor).toBe(vendedorUsuarioId);
      expect(detalle.cerradaPor).toBe(detalle.usuarioId);
    });
  });

  /** Caso 9 — orden: pedir testigo sin el conteo congelado no tiene sentido. */
  describe('caso 9 — orden', () => {
    it('pedir testigo sobre una caja abierta (sin congelar) → 400', async () => {
      const cajaId = await abrirCajaVendedor();

      const pedido = await pedirTestigos(cajaId, [garzonAId]);
      expect(pedido.status).toBe(400);

      // Higiene: dejar la caja cerrada para no ocupar al vendedor ni el
      // cajón entre tests.
      const conteo = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/conteo`)
        .set('Authorization', `Bearer ${tokenVendedor}`)
        .send({ lineas: CONTEO_CUADRA });
      expect(conteo.status).toBe(201);
      expect((conteo.body as { estado: string }).estado).toBe('cerrada');
    });
  });
});
