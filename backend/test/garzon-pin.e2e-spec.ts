import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * SDD `2026-08-14-pin-propio-garzon`, Task 5: el ciclo entero del PIN propio,
 * contra la API real. Lo que ningún unit ve: que las rutas `mi-pin` no las
 * coma `:id` (orden de declaración de Nest), que la tabla
 * `garzon_pin_evento` exista de verdad, y que el aislamiento —entre garzones
 * del mismo tenant, y entre tenants para la misma cuenta— lo sostenga el
 * backend y no el frontend.
 *
 * Fixture propia, exclusiva de este spec (nunca Ana Torres, Bruno Díaz ni
 * Carla Rojas — su sesión de garzón la comparten seis specs, ver
 * `docs/agent/README.md` / memoria de sesión): `garzon.pin@paris.cl` y el
 * garzón "PIN Fixture" (IDs `…440346`/`…440347`), sembrados por
 * `seeder.service.ts` ya vinculados y sin PIN usable — el mismo estado en el
 * que nace cualquier garzón con cuenta en producción.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const FALABELLA_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';

const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
const GARZON = { email: 'garzon.pin@paris.cl', pass: 'admin' };
const GARZON_USUARIO_ID = '550e8400-e29b-41d4-a716-446655440346';

// El admin real es_fijo de Falabella (superadmin, rol Administrador ahí
// también) — no `admin.paris`, que no tiene ningún poder sobre Falabella.
// Mismo patrón que `cajones.e2e-spec.ts` / `uso-reglas.e2e-spec.ts`.
const ADMIN_FALABELLA = { email: 'admin@sistema.com', pass: 'admin' };

// Bruno Díaz: garzón del seed con PIN de dev conocido (`222222`,
// `seedGarzones`). `verificar-pin` es de solo lectura —un `findOne` y un
// `bcrypt.compare`, sin sesión ni escritura—, así que usarlo acá no toca la
// fixture de sesión que comparten seis specs (esa restricción es sobre
// abrir/cerrar turno, no sobre esto).
const BRUNO_GARZON_ID = '550e8400-e29b-41d4-a716-446655440239';

// contador@paris.cl: cuenta del seed que ningún spec vincula jamás a un
// garzón (solo la usa recuentos.e2e-spec.ts para loguearse). Sirve de
// "cuenta cualquiera" para probar que el alta con cuenta no devuelve PIN,
// sin tocar ninguna fixture que otro spec necesite.
const CONTADOR_USUARIO_ID = '550e8400-e29b-41d4-a716-446655440328';

interface TokenResponse {
  access_token: string;
}

describe('PIN propio del garzón (e2e)', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let tokenGarzon: string;
  let garzonId: string;
  // Cuántos eventos de historia tenía la fixture ANTES de que esta corrida
  // tocara nada — ver el test "antes de fijarlo" y la nota en "la historia
  // quedó completa" sobre por qué la lista no puede afirmarse vacía/exacta.
  let eventosBase = 0;

  async function loginConTenant(
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
      .set('Authorization', `Bearer ${initialToken}`)
      .send({ tenantId });
    expect(resTenant.status).toBe(200);
    return (resTenant.body as TokenResponse).access_token;
  }

  async function login(email: string, password: string): Promise<string> {
    return loginConTenant(email, password, PARIS_TENANT_ID);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    tokenAdmin = await login(ADMIN.email, ADMIN.pass);
    tokenGarzon = await login(GARZON.email, GARZON.pass);

    const vinculo = await request(app.getHttpServer())
      .get('/api/garzones/mi-vinculo')
      .set('Authorization', `Bearer ${tokenGarzon}`);
    expect(vinculo.status).toBe(200);
    garzonId = (vinculo.body as { garzonId: string | null }).garzonId ?? '';
    expect(garzonId).toBeTruthy();
  }, 60000);

  /**
   * Misma disciplina que `caja-testigo.e2e-spec.ts`: la limpieza acumula
   * fallos en un array y recién los afirma DESPUÉS de `app.close()`, que va
   * en el `finally`. Si el `expect` fuera antes del `close`, un fallo acá
   * dejaría la app de Nest viva con su pool abierto y la suite se cuelga sin
   * output — no un fallo visible, siete minutos de nada.
   *
   * Lo único que limpiar es el PIN: `regenerarPin` sobre un garzón CON cuenta
   * siempre vuelve a dejarlo en `PIN_INUTILIZABLE` (el mismo efecto que ya
   * ejerce el test "el encargado lo invalida"), así que repetirlo acá es
   * idempotente y deja la fixture lista para la próxima corrida aunque algún
   * `it` de arriba haya fallado a mitad de camino.
   *
   * Lo que NO limpia, a propósito: `garzon_pin_evento` (la historia). No es
   * que no se pueda —un `DELETE` físico en la limpieza de un test es un
   * patrón ya aceptado en este repo para filas que el propio test sembró
   * (`liquidacion-propinas.e2e-spec.ts`, sesiones de garzón; el pre-commit
   * lo contempla explícitamente con `--no-verify`)—, es que ACÁ no
   * corresponde: es una tabla de auditoría (el docblock de la entity dice
   * "hechos con hora", nunca editados ni borrados en producción), y purgarla
   * en un test entrenaría el reflejo equivocado justo al lado del código que
   * la sostiene. El costo de no purgar es una fila de más por corrida local
   * sin `reset-db.sh` entre medio — inocuo, y CI nunca lo ve. Los tests que
   * leen el historial asumen esa acumulación (ver `eventosBase`) en vez de
   * fingir que no existe.
   */
  afterAll(async () => {
    const fallos: string[] = [];
    try {
      const status = await request(app.getHttpServer())
        .patch(`/api/garzones/${garzonId}/pin`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .then((r) => r.status);
      if (status !== 200) {
        fallos.push(`invalidar PIN de la fixture → ${status}`);
      }
    } catch (e) {
      fallos.push(`invalidar PIN de la fixture → ${(e as Error).message}`);
    } finally {
      await app.close();
    }

    expect(fallos).toEqual([]);
  });

  it('el alta con cuenta no devuelve PIN', async () => {
    const alta = await request(app.getHttpServer())
      .post('/api/garzones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: `Alta con cuenta ${Date.now()}`,
        usuarioId: CONTADOR_USUARIO_ID,
      })
      .expect(201);

    const nuevoId = (alta.body as { id: string }).id;
    try {
      expect(alta.body.pin).toBeNull();
    } finally {
      // Throwaway: se borra pase lo que pase la aserción de arriba. Si NO
      // estuviera en un `finally`, un fallo de esa aserción —que es
      // justamente el escenario para el que existe este test— dejaba el
      // garzón vivo y vinculado a `contador@paris.cl`: la corrida siguiente
      // moría en `assertVinculable` con un 409 que no apunta a la causa real.
      // No se afirma el status: es limpieza de mejor esfuerzo, no una
      // aserción del test — si tirara acá, taparía el error original.
      await request(app.getHttpServer())
        .delete(`/api/garzones/${nuevoId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
    }
  });

  it('antes de fijarlo, mi-pin dice que no está fijado', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/garzones/mi-pin')
      .set('Authorization', `Bearer ${tokenGarzon}`)
      .expect(200);

    // Capturado ANTES del `expect(fijado)` a propósito: si ese assert
    // cayera, `eventosBase` tiene que quedar con el valor real igual —si
    // asignarlo fuera DESPUÉS, un fallo acá dejaría `eventosBase` en su
    // default (0) y el test de historial más abajo fallaría con un conteo
    // engañoso en vez de con la causa real.
    //
    // Punto de partida, no "vacío": `garzon_pin_evento` es un registro de
    // auditoría real que sobrevive entre corridas locales sin
    // `reset-db.sh` (ver el docblock del `afterAll`). Lo único
    // determinístico es "todavía no hay eventos nuevos desde acá", que es
    // justamente lo que este test puede afirmar sin mentir.
    eventosBase = (res.body.eventos as unknown[]).length;

    expect(res.body.fijado).toBe(false);
  });

  it('el garzón fija su PIN y con eso entra por el tótem', async () => {
    await request(app.getHttpServer())
      .patch('/api/garzones/mi-pin')
      .set('Authorization', `Bearer ${tokenGarzon}`)
      .send({ pin: '481502', confirmarPin: '481502' })
      .expect(204);

    // `verificarPin` es el oráculo del tótem: prueba que el PIN sirve de verdad.
    await request(app.getHttpServer())
      .post('/api/garzones/verificar-pin')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ garzonId, pin: '481502' })
      .expect(200);
  });

  /**
   * Radio de impacto: la escritura de `fijarMiPin` tiene que tocar SOLO la
   * fila de la fixture. Bruno Díaz no tiene nada que ver con este flujo —si
   * `guardarConEvento` (`garzones.service.ts`) alguna vez actualizara por
   * `tenantId` sin filtrar `garzon_id`, o si un `UPDATE` sin `WHERE`
   * ajustado tocara más de una fila, el PIN de Bruno dejaría de sevir sin
   * que ningún otro test de este spec se enterara.
   */
  it('fijar el PIN propio no le toca el PIN a ningún otro garzón (radio de impacto)', async () => {
    await request(app.getHttpServer())
      .post('/api/garzones/verificar-pin')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ garzonId: BRUNO_GARZON_ID, pin: '222222' })
      .expect(200);
  });

  it('el encargado lo invalida sin ver ningún PIN, y el viejo deja de servir', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/garzones/${garzonId}/pin`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    expect(res.body.pin).toBeNull();

    await request(app.getHttpServer())
      .post('/api/garzones/verificar-pin')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ garzonId, pin: '481502' })
      .expect(400);
  });

  it('la historia quedó completa, en orden y con nombre del actor', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/garzones/${garzonId}/pin-eventos`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);

    // Los DOS eventos que esta corrida generó son los más nuevos
    // (`listarEventosPin` ordena `creado_el DESC`), así que quedan primeros
    // sin importar cuánta historia acumulada tenga la fixture de corridas
    // anteriores sin `reset-db.sh` — se afirma el PREFIJO exacto y el total
    // relativo a `eventosBase`, no la lista entera (ver docblock del
    // `afterAll`: el historial no se limpia ni se debería limpiar).
    const eventos = res.body as { tipo: string; usuarioNombre: string }[];
    expect(eventos.length).toBe(eventosBase + 2);
    expect(eventos.slice(0, 2).map((e) => e.tipo)).toEqual([
      'invalidado_por_encargado',
      'fijado_por_garzon',
    ]);
    expect(eventos[0].usuarioNombre).toBeTruthy();
  });

  /**
   * Aislamiento REAL por tenant — no "no soy garzón en ningún lado", que es
   * una regla distinta y ya la prueban indirectamente los demás tests de
   * este spec vía `miGarzonOrThrow`. Esto arma el único escenario donde la
   * MISMA cuenta vinculada como garzón en Paris pide un token de OTRO
   * tenant donde nunca fue vinculada:
   *
   * 1. El admin real de Falabella (`admin@sistema.com`, superadmin con rol
   *    fijo también ahí) suma la cuenta de la fixture como miembro de
   *    Falabella (`POST /tenants/members` — idempotente, restaura si ya
   *    estuvo de una corrida anterior).
   * 2. La fixture cambia de tenant activo (`switch-tenant`) y pide su
   *    propio PIN con ESE token.
   *
   * Si el 404 saliera por accidente —por ejemplo, si `garzonPersonalDe`
   * (`garzones.service.ts`) perdiera el filtro `g.tenant_id = ut.tenant_id`
   * del JOIN con `garzones`— la misma consulta encontraría igual al garzón
   * de Paris (el único que tiene esa cuenta vinculada), y esto daría 204: el
   * PIN de la fixture quedaría escrito por una request que dice operar en
   * Falabella. Mutante verificado, ver `task-5-report.md`.
   */
  it('en un tenant donde la cuenta no es garzón, mi-pin da 404 (aislamiento real por tenant)', async () => {
    const tokenAdminFalabella = await loginConTenant(
      ADMIN_FALABELLA.email,
      ADMIN_FALABELLA.pass,
      FALABELLA_TENANT_ID,
    );

    try {
      await request(app.getHttpServer())
        .post('/api/tenants/members')
        .set('Authorization', `Bearer ${tokenAdminFalabella}`)
        .send({ usuarioId: GARZON_USUARIO_ID })
        .expect(201);

      const tokenGarzonFalabella = await loginConTenant(
        GARZON.email,
        GARZON.pass,
        FALABELLA_TENANT_ID,
      );

      await request(app.getHttpServer())
        .patch('/api/garzones/mi-pin')
        .set('Authorization', `Bearer ${tokenGarzonFalabella}`)
        .send({ pin: '481504', confirmarPin: '481504' })
        .expect(404);
    } finally {
      // Best-effort, fuera de la aserción: si el `patch` de arriba fallara,
      // igual hay que devolver a la fixture a "solo miembro de Paris" para
      // que la próxima corrida no la encuentre ya sumada a Falabella con
      // estado a medio armar.
      await request(app.getHttpServer())
        .delete(`/api/tenants/members/${GARZON_USUARIO_ID}`)
        .set('Authorization', `Bearer ${tokenAdminFalabella}`);
    }
  });

  it('rechaza un PIN obvio', async () => {
    await request(app.getHttpServer())
      .patch('/api/garzones/mi-pin')
      .set('Authorization', `Bearer ${tokenGarzon}`)
      .send({ pin: '123456', confirmarPin: '123456' })
      .expect(400);
  });
});
