import { randomUUID } from 'crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loginSegundoTenant } from './helpers/segundo-tenant';

/**
 * **Compras, pieza 3 — pagar y anular un pago** (spec
 * `docs/superpowers/specs/2026-09-28-compras-deuda-proveedor-design.md` § 5,
 * § 8, § 9 y § 11).
 *
 * El fondeo (saldo a favor, anticipo, "usar el saldo"), el efectivo por la
 * MISMA validación de caja que la salida manual (con su rastro de intento
 * rechazado), anular (con la caja abierta, cerrada y ajena), la idempotencia
 * del cobro, los permisos (`Pagar`, con el rol real del bodeguero) y el
 * aislamiento entre tenants.
 *
 * No toca `por-pagar` ni `confirmar` con `pago` (tareas 3 y 4): las compras
 * de este archivo se pagan siempre desde `POST /compras/pagos`.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
/** `Leer, Crear, Actualizar, Anular` — SIN `Pagar` (decisión 7b): el bodeguero. */
const BODEGUERO_EMAIL = 'encargado.compras@paris.cl';
/** Las cuatro de siempre MÁS `Pagar` (decisión 7): el dueño que paga. */
const PAGA_EMAIL = 'compras.paga@paris.cl';
const PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface TipoDocumento {
  id: string;
  nombre: string;
  codigo: string | null;
  requiereFolio: boolean;
  totalDocumento: string;
}
interface MedioPago {
  id: string;
  nombre: string;
  esEfectivo: boolean;
}
interface PagoProveedorInfo {
  id: string | null;
  proveedorId: string;
  monto: string;
  metodoPagoId: string | null;
  cajaId: string | null;
  estado: string | null;
  aplicaciones: { compraId: string; monto: string }[];
  sobranteAFavor: string;
  repetida?: true;
}
interface CajaResponse {
  id: string;
  estado: string;
}
interface ArqueoLinea {
  metodoPagoId: string | null;
  esperado: string | null;
  diferencia?: string | null;
}
interface CompraConDeuda {
  id: string;
  estado: string;
  deuda?: string | null;
}
interface MovimientoCaja {
  id: string;
  tipo: string;
  concepto: string;
}
interface PaginadoMovimientos {
  data: MovimientoCaja[];
  meta: { total: number };
}

describe('Compras — pagar y anular un pago (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let tokenPaga: string;
  let tokenBodeguero: string;
  let proveedorId: string;
  let ubicacionId: string;
  let productoId: string;
  let sinDocumento: TipoDocumento;
  let efectivo: MedioPago;
  let otroMedio: MedioPago;

  const nombreUnico = (base: string) =>
    `${base} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  async function login(email: string): Promise<string> {
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: PASS });
    expect(resLogin.status).toBe(200);
    const resTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set(
        'Cookie',
        (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
      )
      .set(
        'Authorization',
        `Bearer ${(resLogin.body as TokenResponse).access_token}`,
      )
      .send({ tenantId: PARIS_TENANT_ID });
    expect(resTenant.status).toBe(200);
    return (resTenant.body as TokenResponse).access_token;
  }

  async function post<T>(
    url: string,
    body: Record<string, unknown>,
    esperado = 201,
    conToken = token,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const req = request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${conToken}`);
    for (const [k, v] of Object.entries(extraHeaders)) req.set(k, v);
    const res = await req.send(body);
    expect(res.status).toBe(esperado);
    return res.body as T;
  }

  async function get<T>(
    url: string,
    esperado = 200,
    conToken = token,
  ): Promise<T> {
    const res = await request(app.getHttpServer())
      .get(url)
      .set('Authorization', `Bearer ${conToken}`);
    expect(res.status).toBe(esperado);
    return res.body as T;
  }

  /** El intento crudo: status y mensaje, para afirmar sobre los dos. */
  async function intentar(
    metodo: 'post' | 'get',
    url: string,
    body: Record<string, unknown> = {},
    conToken = token,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; message: string }> {
    const req = request(app.getHttpServer())
      [metodo](url)
      .set('Authorization', `Bearer ${conToken}`);
    for (const [k, v] of Object.entries(extraHeaders)) req.set(k, v);
    const res = await req.send(body);
    const message = (res.body as { message?: string | string[] }).message;
    return {
      status: res.status,
      message: Array.isArray(message) ? message.join(' ') : (message ?? ''),
    };
  }

  /** Compra `confirmada`, suma_lineas, con una línea de `monto` — la deuda queda en `monto`. */
  async function compraConfirmada(
    monto: string,
    conToken = tokenPaga,
    conProveedorId = proveedorId,
  ): Promise<string> {
    const creado = await post<{ id: string }>(
      '/api/compras',
      {
        proveedorId: conProveedorId,
        tipoDocumentoCompraId: sinDocumento.id,
        fechaDocumento: '2026-09-01',
        ubicacionId,
        lineas: [
          {
            itemId: productoId,
            cantidad: '1',
            unidadCodigo: 'kg',
            precioUnitario: monto,
          },
        ],
      },
      201,
      conToken,
    );
    await post(`/api/compras/${creado.id}/confirmar`, {}, 201, conToken);
    return creado.id;
  }

  /**
   * Abre una caja para `conToken`. Solo dos desenlaces: 201 (recién abierta)
   * o 409 (este mismo actor ya tiene una abierta EN ESTA CORRIDA — se
   * reusa vía `GET /caja/activa`). Cualquier otro status revienta con
   * `expect(...).toBe(201)`: no hay reuso silencioso de una caja ajena o de
   * una corrida anterior — ese silencio fue justo lo que dejaba `admin.paris`
   * con una caja abierta entre suites (fix round 2).
   */
  async function abrirOReusarCaja(conToken: string): Promise<string> {
    const cajon = await post<IdResponse>(
      '/api/cajones',
      { nombre: nombreUnico('Cajón pagos E2E') },
      201,
      token,
    );
    const resAbrir = await request(app.getHttpServer())
      .post('/api/caja/abrir')
      .set('Authorization', `Bearer ${conToken}`)
      .send({
        cajonId: cajon.id,
        saldoInicial: '1000.0000',
        comentario: 'Apertura E2E pagos',
      });
    if (resAbrir.status === 409) {
      const activa = await get<CajaResponse>('/api/caja/activa', 200, conToken);
      return activa.id;
    }
    expect(resAbrir.status).toBe(201);
    return (resAbrir.body as CajaResponse).id;
  }

  /**
   * Cierra la caja de `conToken` si quedó abierta, contando EXACTO el
   * esperado (patrón `liberarCajeroSiQuedoOcupado` de `caja.e2e-spec.ts`):
   * sin esto, `afterAll` dejaría la caja de `compras.paga` abierta y este
   * spec repetiría exactamente el bug que vino a arreglar.
   */
  async function cerrarCajaSiQuedoAbierta(conToken: string): Promise<void> {
    const resActiva = await request(app.getHttpServer())
      .get('/api/caja/activa')
      .set('Authorization', `Bearer ${conToken}`);
    // status-tolerante: higiene de afterAll, mismo patrón que liberarCajeroSiQuedoOcupado
    const caja = resActiva.body as (CajaResponse & { id?: string }) | null;
    if (!caja?.id) return;

    const leerArqueo = async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/caja/${caja.id}/arqueo`)
        .set('Authorization', `Bearer ${token}`);
      // status-tolerante: higiene de afterAll, ídem arriba
      return res.body as { lineas: ArqueoLinea[] };
    };

    if (caja.estado === 'abierta') {
      const { lineas } = await leerArqueo();
      await request(app.getHttpServer())
        .post(`/api/caja/${caja.id}/conteo`)
        .set('Authorization', `Bearer ${conToken}`)
        .send({
          lineas: lineas.map((l) => ({
            metodoPagoId: l.metodoPagoId,
            montoContado: l.esperado ?? '0',
          })),
        });
    }

    const { lineas } = await leerArqueo();
    const descuadres = lineas.filter(
      (l) => l.diferencia != null && Number(l.diferencia) !== 0,
    );
    await request(app.getHttpServer())
      .post(`/api/caja/${caja.id}/cerrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: descuadres.map((l) => ({
          metodoPagoId: l.metodoPagoId,
          comentarioDiferencia: 'Higiene E2E compras-pagos: cierre de afterAll',
        })),
        comentario: 'Higiene E2E compras-pagos: cierre de afterAll',
      });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();

    token = await login(ADMIN_EMAIL);
    tokenPaga = await login(PAGA_EMAIL);
    tokenBodeguero = await login(BODEGUERO_EMAIL);

    proveedorId = (
      await post<IdResponse>('/api/terceros', {
        tipo: 'proveedor',
        nombre: nombreUnico('Don Pedro E2E'),
      })
    ).id;

    // Bodega PROPIA del spec, no "la primera de la lista": `GET /ubicaciones`
    // incluye las desactivadas y ordena por nombre con la collation real del
    // servidor (no la de este host), así que una bodega apagada de otra
    // suite puede colar primero (anti-patterns.md "Tomar 'el primero' de un
    // listado que comparten todas las suites").
    ubicacionId = (
      await post<IdResponse>('/api/ubicaciones', {
        nombre: nombreUnico('Bodega pagos E2E'),
        tipo: 'bodega',
      })
    ).id;

    productoId = (
      await post<IdResponse>('/api/items', {
        nombre: nombreUnico('Insumo pagos E2E'),
        precioBase: '1000',
        precioIncluyeImpuesto: true,
        monedaId: '550e8400-e29b-41d4-a716-446655440003',
        tipo: 'producto',
        unidadMedida: 'kg',
        stock: '1',
        costo: '500',
      })
    ).id;

    const tipos = await get<TipoDocumento[]>('/api/compras/tipos-documento');
    sinDocumento = tipos.find((t) => !t.requiereFolio)!;

    const medios = await get<MedioPago[]>(
      '/api/compras/medios-pago',
      200,
      tokenPaga,
    );
    efectivo = medios.find((m) => m.esEfectivo)!;
    otroMedio = medios.find((m) => !m.esEfectivo)!;
  }, 120000);

  afterAll(async () => {
    // `compras.paga` (rol `Compras · Paga`, seed) opera su propia caja
    // (spec § 2, decisión 3; fix round 3 del seed) y es el ÚNICO actor de
    // este archivo que abre una: cerrarla acá es lo único que hace falta
    // para no dejar nada abierto entre suites. `try/finally` (mismo molde
    // que `items-pausados.e2e-spec.ts` ~783): si el cierre revienta, `app`
    // igual se cierra — sin esto, un fallo acá deja la conexión de Nest
    // abierta y se lleva puesto el resto de la corrida (fix round 4).
    try {
      await cerrarCajaSiQuedoAbierta(tokenPaga);
    } finally {
      await app.close();
    }
  });

  it('medios-pago devuelve los habilitados con esEfectivo, y sin Pagar es 403', async () => {
    expect(efectivo.esEfectivo).toBe(true);
    expect(otroMedio.esEfectivo).toBe(false);
    const r = await intentar(
      'get',
      '/api/compras/medios-pago',
      {},
      tokenBodeguero,
    );
    expect(r.status).toBe(403);
  });

  it('paga una compra entera por transferencia (sin tocar caja), y GET /compras/pagos la muestra', async () => {
    const compraId = await compraConfirmada('1000');
    const pago = await post<PagoProveedorInfo>(
      '/api/compras/pagos',
      {
        proveedorId,
        monto: '1000',
        metodoPagoId: otroMedio.id,
        aplicaciones: [{ compraId, monto: '1000' }],
      },
      201,
      tokenPaga,
      { 'Idempotency-Key': randomUUID() },
    );
    expect(pago.id).not.toBeNull();
    expect(pago.cajaId).toBeNull();
    expect(pago.aplicaciones).toEqual([{ compraId, monto: '1000.0000' }]);

    const pagos = await get<PagoProveedorInfo[]>(
      `/api/compras/pagos?proveedorId=${proveedorId}`,
      200,
      tokenPaga,
    );
    expect(pagos.some((p) => p.id === pago.id)).toBe(true);
  });

  it('anticipo: aplicaciones vacía, todo queda a favor', async () => {
    const pago = await post<PagoProveedorInfo>(
      '/api/compras/pagos',
      {
        proveedorId,
        monto: '300',
        metodoPagoId: otroMedio.id,
        aplicaciones: [],
      },
      201,
      tokenPaga,
      { 'Idempotency-Key': randomUUID() },
    );
    expect(pago.aplicaciones).toEqual([]);
    expect(pago.sobranteAFavor).toBe('300.0000');
  });

  it('usar el saldo a favor: monto 0 con aplicaciones no crea pago ni toca caja', async () => {
    // El anticipo del test anterior dejó $300 a favor de este proveedor.
    const compraId = await compraConfirmada('300');
    const pago = await post<PagoProveedorInfo>(
      '/api/compras/pagos',
      {
        proveedorId,
        monto: '0',
        aplicaciones: [{ compraId, monto: '300' }],
      },
      201,
      tokenPaga,
      { 'Idempotency-Key': randomUUID() },
    );
    expect(pago.id).toBeNull();
    expect(pago.estado).toBeNull();
    expect(pago.aplicaciones).toEqual([{ compraId, monto: '300.0000' }]);
  });

  it('una aplicación que supera la deuda conocida es 400', async () => {
    const compraId = await compraConfirmada('100');
    const r = await intentar(
      'post',
      '/api/compras/pagos',
      {
        proveedorId,
        monto: '500',
        metodoPagoId: otroMedio.id,
        aplicaciones: [{ compraId, monto: '500' }],
      },
      tokenPaga,
      { 'Idempotency-Key': randomUUID() },
    );
    expect(r.status).toBe(400);
    expect(r.message).toContain('supera su deuda');
  });

  it('efectivo sin caja abierta es 400', async () => {
    const compraId = await compraConfirmada('50');
    const r = await intentar(
      'post',
      '/api/compras/pagos',
      {
        proveedorId,
        monto: '50',
        metodoPagoId: efectivo.id,
        aplicaciones: [{ compraId, monto: '50' }],
      },
      tokenPaga,
      { 'Idempotency-Key': randomUUID() },
    );
    expect(r.status).toBe(400);
    expect(r.message).toContain('caja abierta');
  });

  describe('efectivo con caja: el esperado baja, y sin plata deja su fila en el rastro', () => {
    let cajaId: string;

    // `compras.paga` opera su propia caja (rol del seed, fix round 3):
    // abrir y pagar acá van con SU token, no con admin — la caja de este
    // describe se cierra en `afterAll` (ver `cerrarCajaSiQuedoAbierta`), así
    // que ningún otro spec la encuentra abierta.
    beforeAll(async () => {
      cajaId = await abrirOReusarCaja(tokenPaga);
    });

    it('con caja y plata alcanza: 201, y el esperado baja (la siguiente ya no alcanza)', async () => {
      const compra1 = await compraConfirmada('700', tokenPaga);
      const pago = await post<PagoProveedorInfo>(
        '/api/compras/pagos',
        {
          proveedorId,
          monto: '700',
          metodoPagoId: efectivo.id,
          aplicaciones: [{ compraId: compra1, monto: '700' }],
        },
        201,
        tokenPaga,
        { 'Idempotency-Key': randomUUID() },
      );
      expect(pago.cajaId).toBe(cajaId);

      // Saldo inicial 1000 − 700 = 300 esperado. Pedir 400 ahora no alcanza.
      const compra2 = await compraConfirmada('400', tokenPaga);
      const r = await intentar(
        'post',
        '/api/compras/pagos',
        {
          proveedorId,
          monto: '400',
          metodoPagoId: efectivo.id,
          aplicaciones: [{ compraId: compra2, monto: '400' }],
        },
        tokenPaga,
        { 'Idempotency-Key': randomUUID() },
      );
      expect(r.status).toBe(422);
      expect(r.message).not.toContain('300');

      // El rastro: una fila `pago_proveedor` para esta caja, visible con `Cajas:Leer` (admin).
      const rastro = await get<{
        data: { cajaId: string; tipo: string }[];
      }>(`/api/caja/intentos-rechazados?cajaId=${cajaId}`, 200, token);
      expect(rastro.data.some((r2) => r2.tipo === 'pago_proveedor')).toBe(true);
    });
  });

  it('el reintento con la misma Idempotency-Key reproduce el pago (uno solo)', async () => {
    const compraId = await compraConfirmada('150');
    const clave = randomUUID();
    const body = {
      proveedorId,
      monto: '150',
      metodoPagoId: otroMedio.id,
      aplicaciones: [{ compraId, monto: '150' }],
    };
    const primero = await post<PagoProveedorInfo>(
      '/api/compras/pagos',
      body,
      201,
      tokenPaga,
      { 'Idempotency-Key': clave },
    );
    const segundo = await post<PagoProveedorInfo>(
      '/api/compras/pagos',
      body,
      201,
      tokenPaga,
      { 'Idempotency-Key': clave },
    );
    expect(segundo.id).toBe(primero.id);
    expect(segundo.repetida).toBe(true);

    const pagos = await get<PagoProveedorInfo[]>(
      `/api/compras/pagos?proveedorId=${proveedorId}`,
      200,
      tokenPaga,
    );
    expect(pagos.filter((p) => p.id === primero.id)).toHaveLength(1);
  });

  describe('anular un pago (spec § 5.2)', () => {
    it('con la caja todavía abierta del dueño: la deuda vuelve y entra la reversa', async () => {
      // Misma caja que `compras.paga` abrió (o reusa) arriba, con SU token.
      const cajaId = await abrirOReusarCaja(tokenPaga);
      const compraId = await compraConfirmada('120', tokenPaga);
      const pago = await post<PagoProveedorInfo>(
        '/api/compras/pagos',
        {
          proveedorId,
          monto: '120',
          metodoPagoId: efectivo.id,
          aplicaciones: [{ compraId, monto: '120' }],
        },
        201,
        tokenPaga,
        { 'Idempotency-Key': randomUUID() },
      );

      const anulado = await post<PagoProveedorInfo>(
        `/api/compras/pagos/${pago.id}/anular`,
        { motivo: 'Monto mal tipeado' },
        201,
        tokenPaga,
      );
      expect(anulado.estado).toBe('anulado');

      // La deuda volvió: se puede volver a pagar la MISMA compra.
      const rePago = await post<PagoProveedorInfo>(
        '/api/compras/pagos',
        {
          proveedorId,
          monto: '120',
          metodoPagoId: efectivo.id,
          aplicaciones: [{ compraId, monto: '120' }],
        },
        201,
        tokenPaga,
        { 'Idempotency-Key': randomUUID() },
      );
      expect(rePago.cajaId).toBe(cajaId);
    });

    it('anular ya anulado es 409', async () => {
      const compraId = await compraConfirmada('60');
      const pago = await post<PagoProveedorInfo>(
        '/api/compras/pagos',
        {
          proveedorId,
          monto: '60',
          metodoPagoId: otroMedio.id,
          aplicaciones: [{ compraId, monto: '60' }],
        },
        201,
        tokenPaga,
        { 'Idempotency-Key': randomUUID() },
      );
      await post(
        `/api/compras/pagos/${pago.id}/anular`,
        { motivo: 'Motivo 1' },
        201,
        tokenPaga,
      );
      const r = await intentar(
        'post',
        `/api/compras/pagos/${pago.id}/anular`,
        { motivo: 'Motivo 2' },
        tokenPaga,
      );
      expect(r.status).toBe(409);
    });

    it('efectivo con la caja ajena todavía abierta: 403', async () => {
      // La misma caja de `compras.paga` (reusada, no una nueva): admin no la
      // abre — solo intenta anular sin ser su dueño.
      const cajaId = await abrirOReusarCaja(tokenPaga);
      const compraId = await compraConfirmada('40', tokenPaga);
      const pago = await post<PagoProveedorInfo>(
        '/api/compras/pagos',
        {
          proveedorId,
          monto: '40',
          metodoPagoId: efectivo.id,
          aplicaciones: [{ compraId, monto: '40' }],
        },
        201,
        tokenPaga,
        { 'Idempotency-Key': randomUUID() },
      );
      expect(pago.cajaId).toBe(cajaId);

      // admin NO es dueño de la caja de compras.paga: 403 (tiene Pagar por
      // rol fijo, así que llega al chequeo de dueño, no se lo frena el guard).
      const r = await intentar(
        'post',
        `/api/compras/pagos/${pago.id}/anular`,
        { motivo: 'No era mía' },
        token,
      );
      expect(r.status).toBe(403);
    });

    it('con la caja ya CERRADA: no toca ninguna caja, y la deuda vuelve (decisión 6)', async () => {
      const cajaId = await abrirOReusarCaja(tokenPaga);
      const compraId = await compraConfirmada('75', tokenPaga);
      const pago = await post<PagoProveedorInfo>(
        '/api/compras/pagos',
        {
          proveedorId,
          monto: '75',
          metodoPagoId: efectivo.id,
          aplicaciones: [{ compraId, monto: '75' }],
        },
        201,
        tokenPaga,
        { 'Idempotency-Key': randomUUID() },
      );
      expect(pago.cajaId).toBe(cajaId);

      // Cierre COMPLETO de dos fases (conteo exacto + cerrar), reusando el
      // mismo helper de higiene de `afterAll`: es el único lugar del archivo
      // que ya sabe contar el esperado exacto y cerrar limpio.
      await cerrarCajaSiQuedoAbierta(tokenPaga);
      const cajaCerrada = await get<CajaResponse>(
        `/api/caja/${cajaId}`,
        200,
        token,
      );
      expect(cajaCerrada.estado).toBe('cerrada');

      // El total de movimientos de la caja YA cerrada, ANTES de anular —
      // con `token` (admin) para no toparse con el ciego.
      const antes = await get<PaginadoMovimientos>(
        `/api/caja/${cajaId}/movimientos?pageSize=100`,
        200,
        token,
      );

      const anulado = await post<PagoProveedorInfo>(
        `/api/compras/pagos/${pago.id}/anular`,
        { motivo: 'Se pagó de más, la caja ya cerró' },
        201,
        tokenPaga,
      );
      expect(anulado.estado).toBe('anulado');

      // La deuda volvió: se lee por la API (GET /compras/:id, con Pagar).
      const compra = await get<CompraConDeuda>(
        `/api/compras/${compraId}`,
        200,
        tokenPaga,
      );
      expect(Number(compra.deuda)).toBe(75);

      // Ninguna caja se tocó: mismo total y mismos ids de movimientos que
      // antes de anular (decisión 6 — "no toca ninguna caja").
      const despues = await get<PaginadoMovimientos>(
        `/api/caja/${cajaId}/movimientos?pageSize=100`,
        200,
        token,
      );
      expect(despues.meta.total).toBe(antes.meta.total);
      expect(despues.data.map((m) => m.id).sort()).toEqual(
        antes.data.map((m) => m.id).sort(),
      );

      // `compras.paga` no tiene caja abierta después de esto: `afterAll` no
      // tiene nada que reabrir ni volver a cerrar.
      const activaTrasAnular = await request(app.getHttpServer())
        .get('/api/caja/activa')
        .set('Authorization', `Bearer ${tokenPaga}`);
      expect(activaTrasAnular.status).toBe(200);
      const cuerpoActiva = activaTrasAnular.body as { id?: string } | null;
      expect(cuerpoActiva?.id).toBeFalsy();
    });
  });

  describe('permisos: el rol real del bodeguero (encargado.compras, sin Pagar)', () => {
    it('POST /compras/pagos, GET /compras/pagos y anular dan 403', async () => {
      const compraId = await compraConfirmada('10');
      expect(
        (
          await intentar(
            'post',
            '/api/compras/pagos',
            {
              proveedorId,
              monto: '10',
              metodoPagoId: otroMedio.id,
              aplicaciones: [{ compraId, monto: '10' }],
            },
            tokenBodeguero,
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await intentar(
            'get',
            `/api/compras/pagos?proveedorId=${proveedorId}`,
            {},
            tokenBodeguero,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await intentar(
            'post',
            `/api/compras/pagos/${randomUUID()}/anular`,
            { motivo: 'x' },
            tokenBodeguero,
          )
        ).status,
      ).toBe(403);
    });
  });

  describe('aislamiento entre tenants', () => {
    it('proveedor, compra y pago de otro tenant son 404', async () => {
      const otro = await loginSegundoTenant(app);
      const r1 = await intentar(
        'post',
        '/api/compras/pagos',
        {
          proveedorId,
          monto: '10',
          metodoPagoId: otroMedio.id,
          aplicaciones: [],
        },
        otro,
        { 'Idempotency-Key': randomUUID() },
      );
      expect(r1.status).toBe(404);

      const compraId = await compraConfirmada('10');
      const r2 = await intentar(
        'post',
        '/api/compras/pagos',
        {
          proveedorId: (
            await post<IdResponse>(
              '/api/terceros',
              {
                tipo: 'proveedor',
                nombre: nombreUnico('Proveedor otro tenant'),
              },
              201,
              otro,
            )
          ).id,
          monto: '10',
          metodoPagoId: otroMedio.id,
          aplicaciones: [{ compraId, monto: '10' }],
        },
        otro,
        { 'Idempotency-Key': randomUUID() },
      );
      expect(r2.status).toBe(404);

      const r3 = await intentar(
        'post',
        `/api/compras/pagos/${randomUUID()}/anular`,
        { motivo: 'x' },
        otro,
      );
      expect(r3.status).toBe(404);
    });
  });
});
