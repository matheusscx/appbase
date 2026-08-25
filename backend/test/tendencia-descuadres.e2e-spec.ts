import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

// Admin del tenant: lee el arqueo sin que el modo ciego le retenga el esperado.
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
// Supervisor de verdad: rol 'Cajas · Supervisión', Cajas:Leer y nada más, NO
// admin del tenant. Es a quien está destinada esta lectura.
const SUPERVISOR_EMAIL = 'supervisor@paris.cl';
const SUPERVISOR_PASS = 'admin';
// Cajero: rol Vendedor, solo MiCaja. El que NO tiene que poder leerla.
const VENDEDOR_EMAIL = 'vendedor@paris.cl';
const VENDEDOR_PASS = 'admin';

const FALTA_EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440291';

interface TokenResponse {
  access_token: string;
}
interface ArqueoLinea {
  metodoPagoId: string | null;
  esEfectivo: boolean;
  esperado: string | null;
  requiereConteo: boolean;
  diferencia?: string | null;
}
interface Member {
  usuarioId: string;
  correo: string;
}
interface FilaTendencia {
  usuarioId: string;
  usuarioNombre: string;
  cierres: number;
  efectivoSuma: string;
  otrosMediosSuma: string;
  conFaltante: number;
  conSobrante: number;
  cuadrados: number;
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
  const initial = (resLogin.body as TokenResponse).access_token;

  // La cookie de refresh se REENVÍA a mano: `switch-tenant` la exige
  // (`auth.controller.ts` → 401 sin ella) y supertest no arrastra cookies entre
  // requests. Y responde 200, no 201: es `@HttpCode(HttpStatus.OK)`.
  const resSwitch = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set('Authorization', `Bearer ${initial}`)
    .send({ tenantId: PARIS_TENANT_ID });
  expect(resSwitch.status).toBe(200);
  return (resSwitch.body as TokenResponse).access_token;
}

describe('Tendencia de descuadres (e2e)', () => {
  let app: INestApplication<App>;
  let tokenCajero: string;
  let tokenSupervisor: string;
  let tokenAdmin: string;
  let cajonId: string;
  let cajeroId: string;

  const arqueoDe = async (cajaId: string): Promise<ArqueoLinea[]> =>
    (
      await request(app.getHttpServer())
        .get(`/api/caja/${cajaId}/arqueo`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
    ).body.lineas as ArqueoLinea[];

  /**
   * Cierra la caja contando el esperado EXACTO en cada línea, salvo el efectivo,
   * al que se le suma `delta` (negativo = faltante). Resuelve la fase 2 si el
   * descuadre la dispara.
   */
  async function cerrarConDelta(cajaId: string, delta: string): Promise<void> {
    const lineas = await arqueoDe(cajaId);
    const contadas = lineas.map((l) => ({
      metodoPagoId: l.metodoPagoId,
      montoContado: l.esEfectivo
        ? String(Number(l.esperado ?? '0') + Number(delta))
        : (l.esperado ?? '0'),
    }));
    const fase1 = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/conteo`)
      .set('Authorization', `Bearer ${tokenCajero}`)
      .send({ lineas: contadas });
    expect([200, 201]).toContain(fase1.status);

    if ((fase1.body as { estado?: string }).estado !== 'en_conciliacion')
      return;

    const congeladas = await arqueoDe(cajaId);
    const descuadres = congeladas.filter(
      (l) => l.diferencia != null && Number(l.diferencia) !== 0,
    );
    const fase2 = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/cerrar`)
      .set('Authorization', `Bearer ${tokenCajero}`)
      .send({
        lineas: descuadres.map((l) => ({
          metodoPagoId: l.metodoPagoId,
          motivoDiferenciaId: FALTA_EFECTIVO_ID,
          comentarioDiferencia: 'E2E tendencia',
        })),
      });
    expect([200, 201]).toContain(fase2.status);
  }

  /** Deja al cajero sin caja activa, venga como venga de otra suite. */
  async function liberarCajero(): Promise<void> {
    const activa = await request(app.getHttpServer())
      .get('/api/caja/activa')
      .set('Authorization', `Bearer ${tokenCajero}`);
    const caja = activa.body as { id?: string; estado?: string } | null;
    if (!caja?.id) return;
    if (caja.estado === 'abierta') {
      await cerrarConDelta(caja.id, '0');
      return;
    }
    const congeladas = await arqueoDe(caja.id);
    await request(app.getHttpServer())
      .post(`/api/caja/${caja.id}/cerrar`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        lineas: congeladas
          .filter((l) => l.diferencia != null && Number(l.diferencia) !== 0)
          .map((l) => ({
            metodoPagoId: l.metodoPagoId,
            motivoDiferenciaId: FALTA_EFECTIVO_ID,
            comentarioDiferencia: 'Higiene E2E',
          })),
        comentario: 'Higiene E2E: liberar caja atascada',
      });
  }

  async function abrirCaja(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/caja/abrir')
      .set('Authorization', `Bearer ${tokenCajero}`)
      .send({ cajonId, saldoInicial: '10000.0000' });
    expect(res.status).toBe(201);
    return (res.body as { id: string }).id;
  }

  const tendencia = async (
    token: string,
    qs = '',
  ): Promise<FilaTendencia[]> => {
    const res = await request(app.getHttpServer())
      .get(`/api/caja/tendencia${qs}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as FilaTendencia[];
  };

  /** La fila del cajero, o una en cero si todavía no tiene cierres. */
  const filaCajero = async (qs = ''): Promise<FilaTendencia> =>
    (await tendencia(tokenSupervisor, qs)).find(
      (f) => f.usuarioId === cajeroId,
    ) ?? {
      usuarioId: cajeroId,
      usuarioNombre: '',
      cierres: 0,
      efectivoSuma: '0',
      otrosMediosSuma: '0',
      conFaltante: 0,
      conSobrante: 0,
      cuadrados: 0,
    };

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

    tokenCajero = await login(app, VENDEDOR_EMAIL, VENDEDOR_PASS);
    tokenSupervisor = await login(app, SUPERVISOR_EMAIL, SUPERVISOR_PASS);
    tokenAdmin = await login(app, ADMIN_EMAIL, ADMIN_PASS);

    const resCajon = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: `E2E Tendencia ${Date.now()}` });
    expect(resCajon.status).toBe(201);
    cajonId = (resCajon.body as { id: string }).id;

    const resMiembros = await request(app.getHttpServer())
      .get('/api/tenants/members')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    cajeroId = (resMiembros.body as Member[]).find(
      (m) => m.correo === VENDEDOR_EMAIL,
    )!.usuarioId;

    await liberarCajero();
  });

  afterAll(async () => {
    // Acumular en vez de cortar: si un paso falla, los que siguen igual tienen
    // que correr — lo que dejen sin limpiar contamina las suites siguientes. El
    // `close` va en un `finally` y la aserción DESPUÉS: afirmar antes deja la
    // app de Nest viva con su `@Cron` escribiéndole a la base desde un módulo
    // desmontado (medido: cuelga jest para siempre). Molde:
    // `caja-testigo.e2e-spec.ts`. Ver `docs/agent/pendientes.md` § 1.
    const fallos: string[] = [];
    // `404` es legítimo acá: significa que un test ya lo borró antes que la
    // limpieza. Cualquier otro status sí es un problema.
    const limpiar = async (
      que: string,
      ejecutar: () => Promise<number>,
      ok: number[] = [200, 404],
    ) => {
      try {
        const status = await ejecutar();
        if (!ok.includes(status)) fallos.push(`${que} → ${status}`);
      } catch (e) {
        fallos.push(`${que} → ${(e as Error).message}`);
      }
    };

    try {
      // Liberar al cajero ANTES del borrado: `vendedor@paris.cl` es del seed y
      // lo comparten otras suites, así que una caja suya que quede abierta las
      // frena a ellas, no a ésta.
      await limpiar('liberar cajero', async () => {
        await liberarCajero();
        return 200;
      });
      // El cajón creado en beforeAll se borra: sin esto cada corrida local deja
      // uno más en la base compartida de desarrollo.
      await limpiar(
        `borrar cajón ${cajonId}`,
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

  // Las aserciones van por DELTA y no por valor absoluto: otras suites cierran
  // cajas del mismo cajero antes que esta, y una corrida local repetida acumula
  // sobre la anterior. El delta es la única forma que no miente en las dos.
  it('un cierre con faltante suma un cierre, resta plata y cuenta el faltante', async () => {
    const antes = await filaCajero();

    await cerrarConDelta(await abrirCaja(), '-500');

    const despues = await filaCajero();
    expect(despues.cierres).toBe(antes.cierres + 1);
    expect(Number(despues.efectivoSuma) - Number(antes.efectivoSuma)).toBe(
      -500,
    );
    expect(despues.conFaltante).toBe(antes.conFaltante + 1);
    expect(despues.conSobrante).toBe(antes.conSobrante);
  });

  it('un cierre con sobrante mueve la otra columna, y la suma es CON signo', async () => {
    const antes = await filaCajero();

    await cerrarConDelta(await abrirCaja(), '300');

    const despues = await filaCajero();
    expect(despues.conSobrante).toBe(antes.conSobrante + 1);
    expect(despues.conFaltante).toBe(antes.conFaltante);
    // +300 sobre un acumulado negativo: si la suma fuera de magnitudes en vez
    // de con signo, esto daría +300 igual pero el faltante y el sobrante se
    // taparían entre sí. Por eso además se afirma el signo del acumulado.
    expect(Number(despues.efectivoSuma) - Number(antes.efectivoSuma)).toBe(300);
  });

  it('un cierre que cuadra cuenta como cuadrado y no mueve la plata', async () => {
    const antes = await filaCajero();

    await cerrarConDelta(await abrirCaja(), '0');

    const despues = await filaCajero();
    expect(despues.cuadrados).toBe(antes.cuadrados + 1);
    expect(Number(despues.efectivoSuma) - Number(antes.efectivoSuma)).toBe(0);
  });

  it('viene ordenada por el faltante más grande arriba', async () => {
    const filas = await tendencia(tokenSupervisor);
    const sumas = filas.map((f) => Number(f.efectivoSuma));
    expect(sumas).toEqual([...sumas].sort((a, b) => a - b));
  });

  it('una ventana sin cierres no devuelve al cajero', async () => {
    const filas = await tendencia(
      tokenSupervisor,
      '?desde=2020-01-01&hasta=2020-01-31',
    );
    expect(filas.find((f) => f.usuarioId === cajeroId)).toBeUndefined();
  });

  it('la ventana de hoy SÍ lo devuelve — el borde superior no se come el día', async () => {
    // El bug de `cf8396be`: con `<= hasta` y fecha pura, "hasta hoy" dejaba
    // fuera el día entero, así que el cierre recién hecho no aparecía.
    // La fecha se calcula en la zona del TENANT, no en UTC ni en la del runner.
    // `toISOString()` daba UTC y este test se volvía flaky después de las 20:00
    // en Chile: a las 20:15 -04 el UTC ya es el día siguiente, así que la
    // ventana [mañana, mañana] no contenía el cierre recién hecho y el test
    // fallaba sin que nada estuviera roto. El backend siempre estuvo bien —
    // `bordeFechaSql`/`bordeHastaSql` resuelven la zona desde el país del
    // tenant—; era el test el que preguntaba por otro día. Paris es chileno.
    const hoy = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Santiago',
    }).format(new Date());
    const filas = await tendencia(
      tokenSupervisor,
      `?desde=${hoy}&hasta=${hoy}`,
    );
    expect(filas.find((f) => f.usuarioId === cajeroId)).toBeDefined();
  });

  it('solo devuelve cajeros de este tenant', async () => {
    const filas = await tendencia(tokenSupervisor);
    const resMiembros = await request(app.getHttpServer())
      .get('/api/tenants/members')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    const deParis = new Set(
      (resMiembros.body as Member[]).map((m) => m.usuarioId),
    );
    for (const f of filas) {
      expect(deParis.has(f.usuarioId)).toBe(true);
    }
  });

  it('un cajero con solo MiCaja no puede leerla', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/caja/tendencia')
      .set('Authorization', `Bearer ${tokenCajero}`);
    expect(res.status).toBe(403);
  });

  it('la ruta literal no la intercepta GET /caja/:id', async () => {
    // Declarada después de `@Get(':id')` esto daría 404/400 buscando una caja
    // con id 'tendencia'. Que devuelva un array es la prueba de la precedencia.
    const res = await request(app.getHttpServer())
      .get('/api/caja/tendencia')
      .set('Authorization', `Bearer ${tokenSupervisor}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
