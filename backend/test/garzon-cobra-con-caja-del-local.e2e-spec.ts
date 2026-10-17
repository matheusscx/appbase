import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { cerrarCaja, type CajaAbierta } from './helpers/caja';
import { loginSegundoTenant } from './helpers/segundo-tenant';

/**
 * **El garzón cobra la mesa con la caja del local** (02.2, owner 2026-10-17).
 *
 * Las cajas son del local: quien cobra una mesa no necesita una propia. El cobro
 * entra en la sesión abierta de la caja PRINCIPAL; si no está abierta, en otra
 * caja abierta del local; con más de una el garzón elige; con ninguna no se cobra.
 * Quien cobra y tiene su propia caja abierta (una cajera) cobra en la suya.
 *
 * Quién es quién, con los usuarios del seed:
 * - **TOTEM** (`totem@paris.cl`): `Salones:Operar`, sin `MiCaja`, nunca tiene
 *   caja propia. Es el "garzón sin caja"; el garzón que cobra va por PIN.
 * - **ADMIN**: cajera con caja propia cuando abre una.
 * - **VENDEDOR**: `MiCaja:Crear`; abre la segunda caja abierta del local.
 *
 * Cajones, garzón, salón e ítem son PROPIOS de este archivo (la sesión del
 * garzón es única y varias suites la comparten). Cada test deja el local sin
 * cajas abiertas: la regla "ninguna abierta" lo necesita.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
const TOTEM = { email: 'totem@paris.cl', pass: 'admin' };
const VENDEDOR = { email: 'vendedor@paris.cl', pass: 'admin' };
/** `Salones:Leer` + `Salones:Actualizar`, SIN `Salones:Operar`. */
const ENCARGADO_SALON = { email: 'encargado.salon@paris.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface GarzonCreado {
  id: string;
  pin: string;
  nombre: string;
}
interface CajaDelLocal {
  modo: 'propia' | 'principal' | 'unica' | 'elegir' | 'ninguna';
  cajaId: string | null;
  cajas: {
    cajaId: string;
    cajon: string | null;
    cajero: string | null;
    principal: boolean;
    propia: boolean;
  }[];
}
interface CierreCuenta {
  ventaId: string;
  repetida?: true;
}
interface Arqueo {
  lineas: { esEfectivo: boolean; esperado: string | null }[];
  cobradoPorGarzones: { garzonId: string; nombre: string; monto: string }[];
}
interface CajonResponse {
  id: string;
  principal: boolean;
}

describe('El garzón cobra la mesa con la caja del local (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let tokenAdmin: string;
  let tokenTotem: string;
  let tokenVendedor: string;
  let tokenEncargadoSalon: string;
  let garzon: GarzonCreado;
  let salonId: string;
  let itemId: string;
  let marca: number;
  let n = 0;
  /** Cajones propios: A es la que se marca principal; B y C son "otras". */
  let cajonA: string;
  let cajonB: string;
  let cajonC: string;
  /** Todo lo que un test abre, para cerrarlo en el `afterEach`. */
  let abiertas: { caja: CajaAbierta; token: string }[] = [];

  async function login(
    email: string,
    password: string,
    tenantId = PARIS_TENANT_ID,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });
    expect(res.status).toBe(200);
    const enTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set('Cookie', (res.headers['set-cookie'] as unknown as string[]) ?? [])
      .set(
        'Authorization',
        `Bearer ${(res.body as TokenResponse).access_token}`,
      )
      .send({ tenantId });
    expect(enTenant.status).toBe(200);
    return (enTenant.body as TokenResponse).access_token;
  }

  async function post<T>(
    token: string,
    url: string,
    body: Record<string, unknown> = {},
    esperado = 201,
  ): Promise<T> {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    if (res.status !== esperado) {
      throw new Error(
        `POST ${url} → ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    return res.body as T;
  }

  async function marcarPrincipal(cajonId: string, principal: boolean) {
    const res = await request(app.getHttpServer())
      .patch(`/api/cajones/${cajonId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ principal });
    expect(res.status).toBe(200);
  }

  /** Abre una sesión en el cajón con el usuario del token. */
  async function abrir(
    token: string,
    cajonId: string,
    saldoInicial = '100000.0000',
  ): Promise<CajaAbierta> {
    const res = await request(app.getHttpServer())
      .post('/api/caja/abrir')
      .set('Authorization', `Bearer ${token}`)
      .send({
        cajonId,
        saldoInicial,
        comentario: 'Apertura E2E cobro de mesa',
      });
    expect(res.status).toBe(201);
    const caja = { id: (res.body as IdResponse).id, saldoInicial };
    abiertas.push({ caja, token });
    return caja;
  }

  async function cerrar(token: string, caja: CajaAbierta) {
    await cerrarCaja(app, token, caja);
    abiertas = abiertas.filter((a) => a.caja.id !== caja.id);
  }

  async function cajaDelLocal(token: string): Promise<CajaDelLocal> {
    const res = await request(app.getHttpServer())
      .get('/api/salones/caja-del-local')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as CajaDelLocal;
  }

  /** Una mesa nueva con una cuenta de un plato: un cobro fallido no frena al siguiente. */
  async function cuentaConPlato(): Promise<string> {
    const mesa = await post<IdResponse>(
      tokenAdmin,
      `/api/salones/${salonId}/mesas`,
      { nombre: `Mesa cobro local ${++n}` },
    );
    const cuenta = await post<IdResponse>(
      tokenAdmin,
      `/api/mesas/${mesa.id}/cuentas`,
      { garzonId: garzon.id, pin: garzon.pin },
    );
    await post(tokenAdmin, `/api/cuentas/${cuenta.id}/lineas`, {
      itemId,
      cantidad: '1',
    });
    return cuenta.id;
  }

  /** Cobra en efectivo con vuelto: a la caja entra el total, no los 100.000. */
  function cobrar(
    token: string,
    cuentaId: string,
    extra: Record<string, unknown> = {},
    clave: string = randomUUID(),
  ) {
    return request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/cerrar`)
      .set('Idempotency-Key', clave)
      .set('Authorization', `Bearer ${token}`)
      .send({
        garzonId: garzon.id,
        pin: garzon.pin,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000.0000' }],
        ...extra,
      });
  }

  /** Lo que la venta metió a cada caja, por `movimientos_caja` (la verdad de la plata). */
  async function entradasDe(
    ventaId: string,
  ): Promise<{ cajaId: string; monto: string }[]> {
    const filas: { caja_id: string; monto: string }[] = await ds.query(
      `SELECT caja_id, SUM(monto)::numeric(18,4)::text AS monto
         FROM movimientos_caja
        WHERE venta_id = $1 AND tipo = 'entrada' AND eliminado_el IS NULL
        GROUP BY caja_id`,
      [ventaId],
    );
    return filas.map((f) => ({ cajaId: f.caja_id, monto: f.monto }));
  }

  async function arqueo(token: string, cajaId: string): Promise<Arqueo> {
    const res = await request(app.getHttpServer())
      .get(`/api/caja/${cajaId}/arqueo`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as Arqueo;
  }

  const esperadoEfectivo = (a: Arqueo) =>
    a.lineas.find((l) => l.esEfectivo)!.esperado;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

    tokenAdmin = await login(ADMIN.email, ADMIN.pass);
    tokenTotem = await login(TOTEM.email, TOTEM.pass);
    tokenVendedor = await login(VENDEDOR.email, VENDEDOR.pass);
    tokenEncargadoSalon = await login(
      ENCARGADO_SALON.email,
      ENCARGADO_SALON.pass,
    );
    marca = Date.now();

    cajonA = (
      await post<IdResponse>(tokenAdmin, '/api/cajones', {
        nombre: `Cobro local A ${marca}`,
      })
    ).id;
    cajonB = (
      await post<IdResponse>(tokenAdmin, '/api/cajones', {
        nombre: `Cobro local B ${marca}`,
      })
    ).id;
    cajonC = (
      await post<IdResponse>(tokenAdmin, '/api/cajones', {
        nombre: `Cobro local C ${marca}`,
      })
    ).id;

    itemId = (
      await post<IdResponse>(tokenAdmin, '/api/items', {
        nombre: `Plato cobro local E2E ${marca}`,
        precioBase: '5000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
        clasificacionTributaria: 'afecto',
        precioIncluyeImpuesto: true,
      })
    ).id;
    garzon = await post<GarzonCreado>(tokenAdmin, '/api/garzones', {
      nombre: `Garzón cobro local E2E ${marca}`,
    });
    await post(tokenAdmin, '/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: TURNO_MANANA_ID,
    });
    salonId = (
      await post<IdResponse>(tokenAdmin, '/api/salones', {
        nombre: `Salón cobro local E2E ${marca}`,
      })
    ).id;
  }, 60000);

  afterEach(async () => {
    // El local vuelve a "sin cajas abiertas" y sin principal aunque el test haya
    // fallado a mitad: el siguiente parte de ahí.
    for (const { caja, token } of [...abiertas]) {
      await cerrar(token, caja);
    }
    for (const id of [cajonA, cajonB, cajonC]) {
      await marcarPrincipal(id, false);
    }
  });

  afterAll(async () => {
    try {
      await post(
        tokenAdmin,
        '/api/sesiones-garzon/cerrar',
        { garzonId: garzon.id, pin: garzon.pin },
        201,
      );
      for (const id of [cajonA, cajonB, cajonC]) {
        await request(app.getHttpServer())
          .delete(`/api/cajones/${id}`)
          .set('Authorization', `Bearer ${tokenAdmin}`);
      }
    } finally {
      await app.close();
    }
  });

  describe('la caja principal', () => {
    it('marcar una principal desmarca la anterior: nunca hay dos por tenant', async () => {
      await marcarPrincipal(cajonA, true);
      await marcarPrincipal(cajonB, true);

      const res = await request(app.getHttpServer())
        .get('/api/cajones')
        .set('Authorization', `Bearer ${tokenAdmin}`);
      expect(res.status).toBe(200);
      const propios = (res.body as (CajonResponse & { nombre: string })[])
        .filter((c) => [cajonA, cajonB, cajonC].includes(c.id))
        .filter((c) => c.principal)
        .map((c) => c.id);
      expect(propios).toEqual([cajonB]);
    });

    it('un cajón desactivado no puede ser la principal', async () => {
      await request(app.getHttpServer())
        .patch(`/api/cajones/${cajonC}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ activo: false })
        .expect(200);
      try {
        const res = await request(app.getHttpServer())
          .patch(`/api/cajones/${cajonC}`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ principal: true });
        expect(res.status).toBe(400);
      } finally {
        await request(app.getHttpServer())
          .patch(`/api/cajones/${cajonC}`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ activo: true })
          .expect(200);
      }
    });

    it('quien no es del módulo Cajas no la marca (403)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/cajones/${cajonA}`)
        .set('Authorization', `Bearer ${tokenTotem}`)
        .send({ principal: true });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /salones/caja-del-local', () => {
    it('exige Salones:Operar: el vendedor del POS, que no lo tiene, recibe 403', async () => {
      // No el encargado de salón: tiene `Operar` desde el 2026-09-16 (ver `seedRolEncargadoSalon`).
      const res = await request(app.getHttpServer())
        .get('/api/salones/caja-del-local')
        .set('Authorization', `Bearer ${tokenVendedor}`);
      expect(res.status).toBe(403);
    });

    it('el encargado de salón, que opera el salón, la ve', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/salones/caja-del-local')
        .set('Authorization', `Bearer ${tokenEncargadoSalon}`);
      expect(res.status).toBe(200);
    });

    it('sin cajas abiertas dice "ninguna"', async () => {
      const r = await cajaDelLocal(tokenTotem);
      // Si otra suite dejó una caja abierta, este test y los que siguen no
      // miden lo que dicen: se avisa acá y no como un 201 que no debía darse.
      expect(r.cajas).toEqual([]);
      expect(r.modo).toBe('ninguna');
      expect(r.cajaId).toBeNull();
    });

    it('no expone saldos ni esperado: solo dónde se cobra', async () => {
      await abrir(tokenVendedor, cajonA);

      const r = await cajaDelLocal(tokenTotem);

      expect(Object.keys(r.cajas[0]).sort()).toEqual([
        'cajaId',
        'cajero',
        'cajon',
        'principal',
        'propia',
      ]);
    });

    it('lista solo las cajas abiertas de este tenant', async () => {
      const otro = await loginSegundoTenant(app);
      const disp = await request(app.getHttpServer())
        .get('/api/caja/cajones-disponibles')
        .set('Authorization', `Bearer ${otro}`);
      expect(disp.status).toBe(200);
      const cajonAjeno = (disp.body as { cajonId: string }[])[0]?.cajonId;
      const ajena = await abrir(otro, cajonAjeno);

      const r = await cajaDelLocal(tokenTotem);

      expect(r.cajas.map((c) => c.cajaId)).not.toContain(ajena.id);
      expect(r.modo).toBe('ninguna');
    });
  });

  describe('a qué caja entra el cobro', () => {
    it('con la principal abierta entra ahí, aunque haya otras; el efectivo suma al esperado de esa caja', async () => {
      await marcarPrincipal(cajonA, true);
      const principal = await abrir(tokenVendedor, cajonA);
      const otra = await abrir(tokenAdmin, cajonB);
      const antes = esperadoEfectivo(await arqueo(tokenAdmin, principal.id));
      const antesOtra = esperadoEfectivo(await arqueo(tokenAdmin, otra.id));
      const cuentaId = await cuentaConPlato();

      const res = await cobrar(tokenTotem, cuentaId);

      expect(res.status).toBe(201);
      const { ventaId } = res.body as CierreCuenta;
      const entradas = await entradasDe(ventaId);
      expect(entradas).toHaveLength(1);
      expect(entradas[0].cajaId).toBe(principal.id);
      const despues = await arqueo(tokenAdmin, principal.id);
      const subio = (Number(esperadoEfectivo(despues)) - Number(antes)).toFixed(
        4,
      );
      expect(subio).toBe(entradas[0].monto);
      expect(Number(subio)).toBeGreaterThan(0);
      // La otra caja no se movió.
      expect(esperadoEfectivo(await arqueo(tokenAdmin, otra.id))).toBe(
        antesOtra,
      );
      // Y quien cobró queda en la cuenta, sin columna nueva.
      const cuenta: { garzon_cierre_id: string; venta_id: string }[] =
        await ds.query(
          `SELECT garzon_cierre_id, venta_id FROM cuentas WHERE cuenta_id = $1`,
          [cuentaId],
        );
      expect(cuenta[0].garzon_cierre_id).toBe(garzon.id);
      expect(cuenta[0].venta_id).toBe(ventaId);
      // El arqueo detalla "de eso, $X los cobró <garzón>".
      expect(despues.cobradoPorGarzones).toEqual([
        {
          garzonId: garzon.id,
          nombre: garzon.nombre,
          monto: entradas[0].monto,
        },
      ]);
    });

    it('con la principal cerrada y UNA otra abierta, entra en esa sin preguntar', async () => {
      await marcarPrincipal(cajonA, true);
      const otra = await abrir(tokenAdmin, cajonB);
      const cuentaId = await cuentaConPlato();

      const res = await cobrar(tokenTotem, cuentaId);

      expect(res.status).toBe(201);
      const entradas = await entradasDe((res.body as CierreCuenta).ventaId);
      expect(entradas.map((e) => e.cajaId)).toEqual([otra.id]);
      expect((await cajaDelLocal(tokenTotem)).modo).toBe('unica');
    });

    describe('con la principal cerrada y DOS otras abiertas', () => {
      let b: CajaAbierta;
      let c: CajaAbierta;

      beforeEach(async () => {
        await marcarPrincipal(cajonA, true);
        b = await abrir(tokenAdmin, cajonB);
        c = await abrir(tokenVendedor, cajonC);
      });

      it('la pantalla recibe "elegir" con las dos', async () => {
        const r = await cajaDelLocal(tokenTotem);

        expect(r.modo).toBe('elegir');
        expect(r.cajaId).toBeNull();
        expect(r.cajas.map((x) => x.cajaId).sort()).toEqual(
          [b.id, c.id].sort(),
        );
      });

      it('sin elegir: 400 que pide elegir, y la cuenta sigue abierta', async () => {
        const cuentaId = await cuentaConPlato();

        const res = await cobrar(tokenTotem, cuentaId);

        expect(res.status).toBe(400);
        expect((res.body as { message: string }).message).toContain('elige');
        const cuenta: { estado: string }[] = await ds.query(
          `SELECT estado FROM cuentas WHERE cuenta_id = $1`,
          [cuentaId],
        );
        expect(cuenta[0].estado).toBe('abierta');
      });

      it('elige una: entra en esa y no en la otra', async () => {
        const cuentaId = await cuentaConPlato();

        const res = await cobrar(tokenTotem, cuentaId, { cajaId: c.id });

        expect(res.status).toBe(201);
        const entradas = await entradasDe((res.body as CierreCuenta).ventaId);
        expect(entradas.map((e) => e.cajaId)).toEqual([c.id]);
      });

      it('un cajaId que no existe es 400', async () => {
        const res = await cobrar(tokenTotem, await cuentaConPlato(), {
          cajaId: randomUUID(),
        });

        expect(res.status).toBe(400);
      });

      it('un cajaId de una caja ya CERRADA es 400, aunque haya dos abiertas', async () => {
        // El id viejo de la vendedora: se cierra y se vuelve a abrir el cajón,
        // así quedan dos abiertas (elegir) y un id que ya no es ninguna de ellas.
        const vieja = c;
        await cerrar(tokenVendedor, vieja);
        await abrir(tokenVendedor, cajonC);

        const res = await cobrar(tokenTotem, await cuentaConPlato(), {
          cajaId: vieja.id,
        });

        expect(res.status).toBe(400);
        expect((res.body as { message: string }).message).toContain(
          'no está abierta',
        );
      });

      it('un cajaId de OTRO tenant es 400, aunque esa caja esté abierta', async () => {
        const otro = await loginSegundoTenant(app);
        const disp = await request(app.getHttpServer())
          .get('/api/caja/cajones-disponibles')
          .set('Authorization', `Bearer ${otro}`);
        expect(disp.status).toBe(200);
        const ajena = await abrir(
          otro,
          (disp.body as { cajonId: string }[])[0].cajonId,
        );

        const res = await cobrar(tokenTotem, await cuentaConPlato(), {
          cajaId: ajena.id,
        });

        expect(res.status).toBe(400);
        expect(
          await ds.query(
            `SELECT 1 FROM movimientos_caja WHERE caja_id = $1 AND tipo = 'entrada' AND venta_id IS NOT NULL`,
            [ajena.id],
          ),
        ).toHaveLength(0);
      });
    });

    it('con la principal abierta, mandar otra caja es 400: no se obedece en silencio', async () => {
      await marcarPrincipal(cajonA, true);
      await abrir(tokenVendedor, cajonA);
      const otra = await abrir(tokenAdmin, cajonB);

      const res = await cobrar(tokenTotem, await cuentaConPlato(), {
        cajaId: otra.id,
      });

      expect(res.status).toBe(400);
    });

    it('sin ninguna caja abierta no se cobra: 400 con el aviso, y la cuenta sigue abierta', async () => {
      const cuentaId = await cuentaConPlato();

      const res = await cobrar(tokenTotem, cuentaId);

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toBe(
        'No hay ninguna caja abierta en el local. Avísale a la cajera.',
      );
      const cuenta: { estado: string; venta_id: string | null }[] =
        await ds.query(
          `SELECT estado, venta_id FROM cuentas WHERE cuenta_id = $1`,
          [cuentaId],
        );
      expect(cuenta[0]).toEqual({ estado: 'abierta', venta_id: null });
    });

    it('una caja en conciliación no recibe cobros ni se ofrece', async () => {
      await marcarPrincipal(cajonA, true);
      const principal = await abrir(tokenVendedor, cajonA);
      // Conteo que no cuadra: la caja pasa a `en_conciliacion`.
      const conteo = await request(app.getHttpServer())
        .post(`/api/caja/${principal.id}/conteo`)
        .set('Authorization', `Bearer ${tokenVendedor}`)
        .send({ lineas: [{ metodoPagoId: null, montoContado: '1.0000' }] });
      expect(conteo.status).toBe(201);
      expect((conteo.body as { estado: string }).estado).toBe(
        'en_conciliacion',
      );

      const r = await cajaDelLocal(tokenTotem);
      const res = await cobrar(tokenTotem, await cuentaConPlato());

      expect(r.cajas.map((x) => x.cajaId)).not.toContain(principal.id);
      expect(res.status).toBe(400);
      // La limpieza: terminar el cierre con un motivo.
      const motivos = await request(app.getHttpServer())
        .get('/api/motivos-diferencia?soloActivas=true')
        .set('Authorization', `Bearer ${tokenVendedor}`);
      expect(motivos.status).toBe(200);
      const motivoId = (motivos.body as { id: string }[])[0]?.id;
      await request(app.getHttpServer())
        .post(`/api/caja/${principal.id}/cerrar`)
        .set('Authorization', `Bearer ${tokenVendedor}`)
        .send({
          lineas: [
            {
              metodoPagoId: null,
              motivoDiferenciaId: motivoId,
              comentarioDiferencia: 'Cierre de la suite e2e',
            },
          ],
        })
        .expect(201);
      abiertas = abiertas.filter((a) => a.caja.id !== principal.id);
    });

    it('quien tiene caja propia abierta (una cajera) cobra en la suya, aunque haya principal', async () => {
      await marcarPrincipal(cajonA, true);
      await abrir(tokenVendedor, cajonA);
      const suya = await abrir(tokenAdmin, cajonB);

      expect((await cajaDelLocal(tokenAdmin)).modo).toBe('propia');
      const res = await cobrar(tokenAdmin, await cuentaConPlato());

      expect(res.status).toBe(201);
      const entradas = await entradasDe((res.body as CierreCuenta).ventaId);
      expect(entradas.map((e) => e.cajaId)).toEqual([suya.id]);
    });

    it('la cajera no puede mandar la caja de otro: 400', async () => {
      await marcarPrincipal(cajonA, true);
      const principal = await abrir(tokenVendedor, cajonA);
      await abrir(tokenAdmin, cajonB);

      const res = await cobrar(tokenAdmin, await cuentaConPlato(), {
        cajaId: principal.id,
      });

      expect(res.status).toBe(400);
    });
  });

  describe('el reintento y la concurrencia', () => {
    it('reintentar con la misma Idempotency-Key reproduce la venta y no cobra dos veces', async () => {
      const caja = await abrir(tokenVendedor, cajonA);
      const cuentaId = await cuentaConPlato();
      const clave = randomUUID();

      const primero = await cobrar(tokenTotem, cuentaId, {}, clave);
      const segundo = await cobrar(tokenTotem, cuentaId, {}, clave);

      expect(primero.status).toBe(201);
      expect(segundo.status).toBe(201);
      expect((segundo.body as CierreCuenta).repetida).toBe(true);
      expect((segundo.body as CierreCuenta).ventaId).toBe(
        (primero.body as CierreCuenta).ventaId,
      );
      const entradas = await entradasDe((primero.body as CierreCuenta).ventaId);
      expect(entradas.map((e) => e.cajaId)).toEqual([caja.id]);
    });

    it('dos garzones cobrando a la vez en la misma caja: los dos entran y el esperado suma ambos', async () => {
      const caja = await abrir(tokenVendedor, cajonA);
      const antes = esperadoEfectivo(await arqueo(tokenAdmin, caja.id));
      const [c1, c2] = await Promise.all([cuentaConPlato(), cuentaConPlato()]);

      const [r1, r2] = await Promise.all([
        cobrar(tokenTotem, c1),
        cobrar(tokenTotem, c2),
      ]);

      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      const e1 = await entradasDe((r1.body as CierreCuenta).ventaId);
      const e2 = await entradasDe((r2.body as CierreCuenta).ventaId);
      const suma = (Number(e1[0].monto) + Number(e2[0].monto)).toFixed(4);
      const despues = esperadoEfectivo(await arqueo(tokenAdmin, caja.id));
      expect((Number(despues) - Number(antes)).toFixed(4)).toBe(suma);
    });
  });
});
