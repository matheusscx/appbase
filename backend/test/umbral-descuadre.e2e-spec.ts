import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

// Admin del tenant: configura los umbrales (TenantAdminGuard) y lee el arqueo
// sin que el modo ciego le retenga el esperado.
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
// Supervisor: rol 'Cajas · Supervisión', `Cajas:Leer` y nada más. Es a quien
// está destinada la bandeja de pendientes de revisar.
const SUPERVISOR_EMAIL = 'supervisor@paris.cl';
const SUPERVISOR_PASS = 'admin';
// Cajero: rol Vendedor, solo `MiCaja`. El que NO tiene que poder leer la
// bandeja ni marcar visto — es el sujeto del control, no quien lo ejerce.
const VENDEDOR_EMAIL = 'vendedor@paris.cl';
const VENDEDOR_PASS = 'admin';

const FALTA_EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440291';

// Umbrales que fija esta suite. Paris es chileno (CLP, 0 decimales): montos
// enteros o `EscalaMonedaPipe` rechaza con 400.
const UMBRAL_AVISO = '1000';
const UMBRAL_ALTO = '5000';

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
interface PreferenciasFinancieras {
  calculoDescuentos: string;
  calculoRecargos: string;
  formula: string[];
  escalaCalculo: number;
  modoRedondeo: string;
  nivelRedondeo: string;
  montoTolerancia: string;
  umbralDescuadreAviso: string;
  umbralDescuadreAlto: string;
}
interface CierrePendiente {
  cajaId: string;
  usuarioId: string | null;
  usuarioNombre: string;
  estado: string;
  diferencia: string | null;
  peorDiferencia: string;
  explicacionDescuadre: string | null;
  forzado: boolean;
}
interface ResumenDia {
  fecha: string;
  cierres: number;
  conDescuadre: number;
  nivelAviso: number;
  nivelAlto: number;
  altoSinRevisar: number;
  efectivoSuma: string;
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

  // La cookie de refresh se REENVÍA a mano: `switch-tenant` la exige y
  // supertest no arrastra cookies entre requests. Responde 200, no 201.
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

describe('Umbral de descuadre al cierre (e2e)', () => {
  let app: INestApplication<App>;
  let tokenCajero: string;
  let tokenSupervisor: string;
  let tokenAdmin: string;
  let cajonId: string;
  let cajeroId: string;
  let adminId: string;
  /** Preferencias del tenant tal como estaban antes de la suite, para restaurar. */
  let prefsOriginales: PreferenciasFinancieras;

  const arqueoDe = async (cajaId: string): Promise<ArqueoLinea[]> =>
    (
      await request(app.getHttpServer())
        .get(`/api/caja/${cajaId}/arqueo`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
    ).body.lineas as ArqueoLinea[];

  async function abrirCaja(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/caja/abrir')
      .set('Authorization', `Bearer ${tokenCajero}`)
      .send({ cajonId, saldoInicial: '10000' });
    expect(res.status).toBe(201);
    return (res.body as { id: string }).id;
  }

  /**
   * Cierra contando el esperado EXACTO en cada línea salvo el efectivo, al que
   * le suma `delta` (negativo = faltante). Devuelve el `nivelDescuadre` que
   * informó la fase 1 — el dato que el cajero ve en pantalla al enviar el
   * conteo. Resuelve la fase 2 si el descuadre la dispara, mandando la
   * `explicacionDescuadre` cuando se le pasa una.
   */
  async function cerrarConDelta(
    cajaId: string,
    delta: string,
    opts: { token?: string; explicacion?: string } = {},
  ): Promise<string> {
    const token = opts.token ?? tokenCajero;
    const lineas = await arqueoDe(cajaId);
    const contadas = lineas.map((l) => ({
      metodoPagoId: l.metodoPagoId,
      montoContado: l.esEfectivo
        ? String(Number(l.esperado ?? '0') + Number(delta))
        : (l.esperado ?? '0'),
    }));
    const fase1 = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/conteo`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: contadas });
    expect([200, 201]).toContain(fase1.status);
    const nivel = (fase1.body as { nivelDescuadre: string }).nivelDescuadre;

    if ((fase1.body as { estado?: string }).estado === 'en_conciliacion') {
      const congeladas = await arqueoDe(cajaId);
      const descuadres = congeladas.filter(
        (l) => l.diferencia != null && Number(l.diferencia) !== 0,
      );
      const fase2 = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/cerrar`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: descuadres.map((l) => ({
            metodoPagoId: l.metodoPagoId,
            motivoDiferenciaId: FALTA_EFECTIVO_ID,
            comentarioDiferencia: 'E2E umbral',
          })),
          comentario: 'E2E umbral',
          explicacionDescuadre: opts.explicacion,
        });
      // NINGÚN nivel bloquea el cierre: que la fase 2 responda OK con un
      // descuadre de nivel alto ES la aserción central de esta suite.
      expect([200, 201]).toContain(fase2.status);
    }
    return nivel;
  }

  /**
   * Deja al cajero sin caja activa, venga como venga de otra suite. Sin aserción
   * de status: si el GET falla, se sale sin hacer nada en vez de tirar un rojo
   * de limpieza encima del fallo real.
   */
  async function liberarCajero(): Promise<void> {
    const activa = await request(app.getHttpServer())
      .get('/api/caja/activa')
      .set('Authorization', `Bearer ${tokenCajero}`);
    // status-tolerante: red de limpieza: un rojo de la higiene taparía el del test que la hizo falta
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

  const bandeja = async (token: string): Promise<CierrePendiente[]> => {
    const res = await request(app.getHttpServer())
      .get('/api/caja/pendientes-revision')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as CierrePendiente[];
  };

  const resumenDia = async (token: string): Promise<ResumenDia> => {
    const res = await request(app.getHttpServer())
      .get('/api/caja/resumen-descuadres-dia')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as ResumenDia;
  };

  const nivelDeLaCaja = async (cajaId: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    return (res.body as { nivelDescuadre: string }).nivelDescuadre;
  };

  async function setUmbrales(aviso: string, alto: string): Promise<void> {
    const res = await request(app.getHttpServer())
      .put('/api/tenants/preferencias-financieras')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        ...prefsOriginales,
        umbralDescuadreAviso: aviso,
        umbralDescuadreAlto: alto,
      });
    expect(res.status).toBe(200);
  }

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
      .send({ nombre: `E2E Umbral ${Date.now()}` });
    expect(resCajon.status).toBe(201);
    cajonId = (resCajon.body as { id: string }).id;

    const resMiembros = await request(app.getHttpServer())
      .get('/api/tenants/members')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resMiembros.status).toBe(200);
    const miembros = resMiembros.body as Member[];
    cajeroId = miembros.find((m) => m.correo === VENDEDOR_EMAIL)!.usuarioId;
    adminId = miembros.find((m) => m.correo === ADMIN_EMAIL)!.usuarioId;

    const resPrefs = await request(app.getHttpServer())
      .get('/api/tenants/preferencias-financieras')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resPrefs.status).toBe(200);
    prefsOriginales = resPrefs.body as PreferenciasFinancieras;

    await setUmbrales(UMBRAL_AVISO, UMBRAL_ALTO);
    await liberarCajero();
  });

  afterAll(async () => {
    try {
      await liberarCajero();
      // Restaurar la config del tenant: la suite la MUTA, y dejarla movida le
      // cambia la conducta a cualquier otra suite que cierre una caja después.
      await request(app.getHttpServer())
        .put('/api/tenants/preferencias-financieras')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send(prefsOriginales);
      await request(app.getHttpServer())
        .delete(`/api/cajones/${cajonId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
    } finally {
      await app.close();
    }
  });

  describe('los tres niveles, y que ninguno frena el cierre', () => {
    it('una diferencia BAJO el umbral de aviso no dispara nada', async () => {
      const cajaId = await abrirCaja();
      const nivel = await cerrarConDelta(cajaId, '-500');

      expect(nivel).toBe('ninguno');
      expect(await nivelDeLaCaja(cajaId)).toBe('ninguno');
      expect(
        (await bandeja(tokenSupervisor)).find((c) => c.cajaId === cajaId),
      ).toBeUndefined();
    });

    it('una diferencia sobre el AVISO se le informa al cajero y NO va a la bandeja', async () => {
      const cajaId = await abrirCaja();
      const nivel = await cerrarConDelta(cajaId, '-2000');

      // El cajero ve el nivel en la respuesta de su propio conteo: el aviso
      // existe para que confirme, no para que se entere el encargado.
      expect(nivel).toBe('aviso');
      expect(await nivelDeLaCaja(cajaId)).toBe('aviso');
      expect(
        (await bandeja(tokenSupervisor)).find((c) => c.cajaId === cajaId),
      ).toBeUndefined();
    });

    it('una diferencia sobre el ALTO cierra igual y queda en la bandeja con su explicación', async () => {
      const cajaId = await abrirCaja();
      const nivel = await cerrarConDelta(cajaId, '-8000', {
        explicacion: 'Faltó registrar una compra de insumos',
      });

      expect(nivel).toBe('alto');
      // Cerró: el nivel alto avisa, no bloquea (owner, 2026-08-23).
      const detalle = await request(app.getHttpServer())
        .get(`/api/caja/${cajaId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(detalle.status).toBe(200);
      expect((detalle.body as { estado: string }).estado).toBe('cerrada');

      const fila = (await bandeja(tokenSupervisor)).find(
        (c) => c.cajaId === cajaId,
      );
      expect(fila).toBeDefined();
      expect(fila!.usuarioId).toBe(cajeroId);
      expect(Number(fila!.peorDiferencia)).toBe(8000);
      expect(fila!.explicacionDescuadre).toBe(
        'Faltó registrar una compra de insumos',
      );
      expect(fila!.forzado).toBe(false);
    });

    it('el borde EXACTO del umbral alto no lo supera: queda en aviso', async () => {
      const cajaId = await abrirCaja();
      const nivel = await cerrarConDelta(cajaId, `-${UMBRAL_ALTO}`);

      expect(nivel).toBe('aviso');
      expect(
        (await bandeja(tokenSupervisor)).find((c) => c.cajaId === cajaId),
      ).toBeUndefined();
    });
  });

  describe('marcar visto', () => {
    it('sale de la bandeja y queda registrado quién lo revisó', async () => {
      const cajaId = await abrirCaja();
      await cerrarConDelta(cajaId, '-9000');
      expect(
        (await bandeja(tokenSupervisor)).find((c) => c.cajaId === cajaId),
      ).toBeDefined();

      const res = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/revisar`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect([200, 201]).toContain(res.status);
      expect((res.body as { revisadoPor: string }).revisadoPor).toBe(adminId);

      expect(
        (await bandeja(tokenSupervisor)).find((c) => c.cajaId === cajaId),
      ).toBeUndefined();

      const detalle = await request(app.getHttpServer())
        .get(`/api/caja/${cajaId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(detalle.status).toBe(200);
      const cuerpo = detalle.body as {
        revisadoPor: string;
        revisadoEl: string;
      };
      expect(cuerpo.revisadoPor).toBe(adminId);
      expect(cuerpo.revisadoEl).not.toBeNull();
    });

    it('un cierre ya revisado no se re-marca: se conserva quién miró primero', async () => {
      const cajaId = await abrirCaja();
      await cerrarConDelta(cajaId, '-9000');
      await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/revisar`)
        .set('Authorization', `Bearer ${tokenAdmin}`);

      const segunda = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/revisar`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(segunda.status).toBe(400);
    });

    it('un cierre que no llegó a nivel alto no se puede marcar visto', async () => {
      const cajaId = await abrirCaja();
      await cerrarConDelta(cajaId, '-2000'); // aviso

      const res = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/revisar`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(400);
    });
  });

  /**
   * El cruce con el cierre forzado, que la entrada de backlog dejó anotado como
   * la parte más frágil: ese cierre pasa por el umbral igual que cualquier otro
   * y queda en la bandeja igual. Quien lo marca visto queda registrado aunque
   * sea la misma persona que lo cerró — el control ahí es el rastro, no impedir.
   */
  describe('cruce con el cierre forzado', () => {
    it('el cierre forzado también entra en la bandeja, marcado como forzado', async () => {
      const cajaId = await abrirCaja();
      // La cierra el ADMIN, no el dueño del turno: cierre forzado.
      await cerrarConDelta(cajaId, '-9000', {
        token: tokenAdmin,
        explicacion: 'Cierre forzado E2E: el cajero se fue',
      });

      const fila = (await bandeja(tokenSupervisor)).find(
        (c) => c.cajaId === cajaId,
      );
      expect(fila).toBeDefined();
      expect(fila!.forzado).toBe(true);
      // La fila se atribuye al DUEÑO del turno, no a quien contó.
      expect(fila!.usuarioId).toBe(cajeroId);
    });

    it('quien forzó el cierre puede marcarlo visto, y queda registrado que fue él', async () => {
      const cajaId = await abrirCaja();
      await cerrarConDelta(cajaId, '-9000', { token: tokenAdmin });

      const res = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/revisar`)
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect([200, 201]).toContain(res.status);
      expect((res.body as { revisadoPor: string }).revisadoPor).toBe(adminId);
    });
  });

  describe('resumen del día', () => {
    it('cuenta los cierres de la jornada por nivel', async () => {
      const antes = await resumenDia(tokenSupervisor);

      const cajaId = await abrirCaja();
      await cerrarConDelta(cajaId, '-9000');

      const despues = await resumenDia(tokenSupervisor);
      expect(despues.cierres).toBe(antes.cierres + 1);
      expect(despues.conDescuadre).toBe(antes.conDescuadre + 1);
      expect(despues.nivelAlto).toBe(antes.nivelAlto + 1);
      expect(despues.altoSinRevisar).toBe(antes.altoSinRevisar + 1);
      expect(Number(despues.efectivoSuma) - Number(antes.efectivoSuma)).toBe(
        -9000,
      );
      // La fecha es la del día LOCAL del tenant (Chile), no la UTC.
      const hoy = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Santiago',
      }).format(new Date());
      expect(despues.fecha).toBe(hoy);
    });

    it('marcar visto baja el contador de altos sin revisar', async () => {
      const cajaId = await abrirCaja();
      await cerrarConDelta(cajaId, '-9000');
      const antes = await resumenDia(tokenSupervisor);

      await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/revisar`)
        .set('Authorization', `Bearer ${tokenAdmin}`);

      const despues = await resumenDia(tokenSupervisor);
      expect(despues.altoSinRevisar).toBe(antes.altoSinRevisar - 1);
      // El cierre no desaparece del resumen: sigue contando como alto del día.
      expect(despues.nivelAlto).toBe(antes.nivelAlto);
    });
  });

  /**
   * `MiCaja` vs `Cajas`: el cajero es el sujeto del control, no quien lo
   * ejerce. Sin este eje la bandeja sería un espejo donde el cajero se
   * autorevisa, que es exactamente el agujero que esta feature vino a tapar.
   */
  describe('permisos: MiCaja no alcanza, hace falta Cajas', () => {
    it('un cajero con solo MiCaja no puede leer la bandeja', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/caja/pendientes-revision')
        .set('Authorization', `Bearer ${tokenCajero}`);
      expect(res.status).toBe(403);
    });

    it('un cajero con solo MiCaja no puede leer el resumen del día', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/caja/resumen-descuadres-dia')
        .set('Authorization', `Bearer ${tokenCajero}`);
      expect(res.status).toBe(403);
    });

    it('un cajero con solo MiCaja no puede marcar visto ni su propio cierre', async () => {
      const cajaId = await abrirCaja();
      await cerrarConDelta(cajaId, '-9000');

      const res = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/revisar`)
        .set('Authorization', `Bearer ${tokenCajero}`);
      expect(res.status).toBe(403);
    });

    it('el supervisor con Cajas:Leer lee la bandeja pero no marca visto', async () => {
      // `Cajas:Leer` sin `Cajas:Actualizar`: lee, no escribe. Es el mismo eje
      // que separa `tendencia` de `forzar un cierre`.
      expect(Array.isArray(await bandeja(tokenSupervisor))).toBe(true);

      const cajaId = await abrirCaja();
      await cerrarConDelta(cajaId, '-9000');
      const res = await request(app.getHttpServer())
        .post(`/api/caja/${cajaId}/revisar`)
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(res.status).toBe(403);
    });
  });

  describe('precedencia de rutas', () => {
    it('las rutas literales no las intercepta GET /caja/:id', async () => {
      // Declaradas después de `@Get(':id')` esto daría 404/400 buscando una caja
      // con id 'pendientes-revision'. Que respondan su forma es la prueba.
      const bandejaRes = await request(app.getHttpServer())
        .get('/api/caja/pendientes-revision')
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(bandejaRes.status).toBe(200);
      expect(Array.isArray(bandejaRes.body)).toBe(true);

      const resumenRes = await request(app.getHttpServer())
        .get('/api/caja/resumen-descuadres-dia')
        .set('Authorization', `Bearer ${tokenSupervisor}`);
      expect(resumenRes.status).toBe(200);
      expect(resumenRes.body).toHaveProperty('altoSinRevisar');
    });
  });

  describe('la config del tenant manda', () => {
    it('con los dos umbrales en 0 la feature queda apagada: nada dispara', async () => {
      await setUmbrales('0', '0');
      try {
        const cajaId = await abrirCaja();
        // El faltante más grande que cabe: el fondo es 10.000 y un conteo
        // negativo no existe (`@IsDecimalNoNegativo`). Sobra contra el alto de 5.000.
        const nivel = await cerrarConDelta(cajaId, '-9000');
        expect(nivel).toBe('ninguno');
        expect(
          (await bandeja(tokenSupervisor)).find((c) => c.cajaId === cajaId),
        ).toBeUndefined();
      } finally {
        await setUmbrales(UMBRAL_AVISO, UMBRAL_ALTO);
      }
    });

    it('rechaza un umbral alto por debajo del de aviso', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/tenants/preferencias-financieras')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          ...prefsOriginales,
          umbralDescuadreAviso: '10000',
          umbralDescuadreAlto: '2000',
        });
      expect(res.status).toBe(400);
    });

    it('rechaza un umbral con más decimales de los que admite la moneda', async () => {
      // CLP no admite decimales: lo corta `EscalaMonedaPipe` en el borde HTTP.
      const res = await request(app.getHttpServer())
        .put('/api/tenants/preferencias-financieras')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ ...prefsOriginales, umbralDescuadreAviso: '1000.50' });
      expect(res.status).toBe(400);
    });

    it('un cajero no puede cambiar los umbrales', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/tenants/preferencias-financieras')
        .set('Authorization', `Bearer ${tokenCajero}`)
        .send({ ...prefsOriginales, umbralDescuadreAviso: '1' });
      expect(res.status).toBe(403);
    });
  });
});
