import { randomUUID } from 'crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * **Compras, pieza 3 — el gesto de confirmar, el recorte y las lecturas**
 * (spec `docs/superpowers/specs/2026-09-28-compras-deuda-proveedor-design.md`
 * § 6, § 7, § 8, § 9 y § 12).
 *
 * Confirmar con `pago` en un solo gesto (con caja, sin `Pagar`, con un pago
 * que falla, con reintento de la misma clave); el recorte de aplicaciones al
 * corregir el total transcrito, al corregir una línea de un tipo con total
 * transcrito (no cambia la deuda) y al anular una compra pagada; `por-pagar`
 * y `por-pagar/:proveedorId`; y decisión 12 — con el rol real del
 * bodeguero (`Leer` sin `Pagar`): 403 en las lecturas de deuda y el listado
 * y el detalle de compras SIN los campos de pago.
 *
 * No repite lo de `compras-pagos.e2e-spec.ts` (`POST /compras/pagos` y
 * `.../anular` en sí): acá una compra se paga sobre todo vía `confirmar`.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
/** `Leer, Crear, Actualizar, Anular` — SIN `Pagar` (decisión 7b): el bodeguero. */
const BODEGUERO_EMAIL = 'encargado.compras@paris.cl';
/** Las cuatro de siempre MÁS `Pagar` (decisión 7): el dueño que paga. */
const PAGA_EMAIL = 'compras.paga@paris.cl';
/** `Leer, Crear, Actualizar`, SIN `Pagar` ni `Anular`. */
const CORRECCION_EMAIL = 'compras.correccion@paris.cl';
const PASS = 'admin';
/**
 * La fecha de documento de toda compra de este archivo: la de HOY, no una
 * fija. Con el plazo por defecto (`PLAZO_PAGO_DIAS_DEFAULT`, 30 días) una
 * fecha fija vence sola — `'2026-09-01'` dio `vencida = true` desde el
 * 2026-10-02 y dejó el CI rojo. Es el día UTC, no el del negocio del tenant
 * (`hoyNegocio`): puede diferir en uno, y no importa — el vencimiento cae a
 * 30 días y el DTO no rechaza fechas futuras. Una sola para todo el archivo,
 * como era la fija: las compras de un mismo proveedor siguen empatadas en
 * fecha, así que el orden "la más vieja primero" del reparto no cambia.
 */
const HOY = new Date().toISOString().slice(0, 10);

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
interface CajaResponse {
  id: string;
  estado: string;
}
interface ArqueoLinea {
  metodoPagoId: string | null;
  esperado: string | null;
  diferencia?: string | null;
}
interface PagoInfo {
  id: string | null;
}
interface IntentoRechazado {
  cajaId: string;
  tipo: string;
}
interface CompraDetalle {
  id: string;
  estado: string;
  total: string | null;
  totalDocumento: string | null;
  estadoPago?: string;
  deuda?: string | null;
  /** La deuda mínima conocida ("al menos $X"): solo en `falta_precio` (spec § 4.1, decisión 8). */
  deudaMinima?: string | null;
  vencida?: boolean;
  aplicado?: string;
  pagos?: { id: string | null; estado: string | null }[];
}
interface Paginado<T> {
  data: T[];
  meta: { total: number };
}
interface PorPagarProveedorItem {
  proveedorId: string;
  deuda: string;
  vencido: string;
  saldoAFavor: string;
  comprasTotalDesconocido: number;
}
interface PorPagarDetalle {
  compras: {
    id: string;
    estadoPago: string;
    deuda: string | null;
    deudaMinima: string | null;
  }[];
  pagos: unknown[];
}

describe('Compras — confirmar con pago, el recorte y las lecturas de deuda (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let tokenPaga: string;
  let tokenBodeguero: string;
  /** `Leer, Crear, Actualizar` — sin `Pagar` ni `Anular`: corrige, no paga (fixture del 403 de anular, reusado acá para el 403 de los campos de pago). */
  let tokenCorreccion: string;
  let proveedorId: string;
  let ubicacionId: string;
  let productoId: string;
  let sinDocumento: TipoDocumento;
  let factura: TipoDocumento;
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

  async function patch<T>(
    url: string,
    body: Record<string, unknown>,
    esperado = 200,
    conToken = token,
  ): Promise<T> {
    const res = await request(app.getHttpServer())
      .patch(url)
      .set('Authorization', `Bearer ${conToken}`)
      .send(body);
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
    metodo: 'post' | 'get' | 'patch',
    url: string,
    body: Record<string, unknown> = {},
    conToken = token,
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; message: string; body: unknown }> {
    const req = request(app.getHttpServer())
      [metodo](url)
      .set('Authorization', `Bearer ${conToken}`);
    for (const [k, v] of Object.entries(extraHeaders)) req.set(k, v);
    const res = await req.send(body);
    const message = (res.body as { message?: string | string[] }).message;
    return {
      status: res.status,
      message: Array.isArray(message) ? message.join(' ') : (message ?? ''),
      body: res.body as unknown,
    };
  }

  /** Un borrador `sinDocumento` (suma_lineas) con una línea de `monto`, sin confirmar. */
  async function borradorSinDocumento(
    monto: string,
    conProveedorId = proveedorId,
    conToken = tokenPaga,
  ): Promise<string> {
    const creado = await post<{ id: string }>(
      '/api/compras',
      {
        proveedorId: conProveedorId,
        tipoDocumentoCompraId: sinDocumento.id,
        fechaDocumento: HOY,
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
    return creado.id;
  }

  /** Compra `confirmada`, `sinDocumento` (suma_lineas), deuda = `monto`. */
  async function compraConfirmada(
    monto: string,
    conToken = tokenPaga,
    conProveedorId = proveedorId,
  ): Promise<string> {
    const id = await borradorSinDocumento(monto, conProveedorId, conToken);
    await post(`/api/compras/${id}/confirmar`, {}, 201, conToken);
    return id;
  }

  /** Un borrador de "Factura de compra" (`obligatorio`) con `totalDocumento`, folio único. */
  async function borradorFactura(
    totalDocumento: string,
    conProveedorId = proveedorId,
  ): Promise<string> {
    const creado = await post<{ id: string }>(
      '/api/compras',
      {
        proveedorId: conProveedorId,
        tipoDocumentoCompraId: factura.id,
        folio: `F-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        fechaDocumento: HOY,
        ubicacionId,
        totalDocumento,
        lineas: [
          {
            itemId: productoId,
            cantidad: '1',
            unidadCodigo: 'kg',
            precioUnitario: '1', // el neto de la línea no gobierna la deuda (decisión 10)
          },
        ],
      },
      201,
      tokenPaga,
    );
    return creado.id;
  }

  async function abrirOReusarCaja(conToken: string): Promise<string> {
    const cajon = await post<IdResponse>(
      '/api/cajones',
      { nombre: nombreUnico('Cajón deuda E2E') },
      201,
      token,
    );
    const resAbrir = await request(app.getHttpServer())
      .post('/api/caja/abrir')
      .set('Authorization', `Bearer ${conToken}`)
      .send({
        cajonId: cajon.id,
        saldoInicial: '1000.0000',
        comentario: 'Apertura E2E deuda',
      });
    if (resAbrir.status === 409) {
      const activa = await get<CajaResponse>('/api/caja/activa', 200, conToken);
      return activa.id;
    }
    expect(resAbrir.status).toBe(201);
    return (resAbrir.body as CajaResponse).id;
  }

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
          comentarioDiferencia: 'Higiene E2E compras-deuda: cierre de afterAll',
        })),
        comentario: 'Higiene E2E compras-deuda: cierre de afterAll',
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
    tokenCorreccion = await login(CORRECCION_EMAIL);

    proveedorId = (
      await post<IdResponse>('/api/terceros', {
        tipo: 'proveedor',
        nombre: nombreUnico('Andina E2E'),
      })
    ).id;

    // Bodega PROPIA del spec, no "la primera de la lista": `GET /ubicaciones`
    // incluye las desactivadas y ordena por nombre con la collation real del
    // servidor (no la de este host), así que una bodega apagada de otra
    // suite puede colar primero (anti-patterns.md "Tomar 'el primero' de un
    // listado que comparten todas las suites").
    ubicacionId = (
      await post<IdResponse>('/api/ubicaciones', {
        nombre: nombreUnico('Bodega deuda E2E'),
        tipo: 'bodega',
      })
    ).id;

    productoId = (
      await post<IdResponse>('/api/items', {
        nombre: nombreUnico('Insumo deuda E2E'),
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
    factura = tipos.find((t) => t.totalDocumento === 'obligatorio')!;

    const medios = await get<MedioPago[]>(
      '/api/compras/medios-pago',
      200,
      tokenPaga,
    );
    efectivo = medios.find((m) => m.esEfectivo)!;
    otroMedio = medios.find((m) => !m.esEfectivo)!;
  }, 120000);

  afterAll(async () => {
    try {
      await cerrarCajaSiQuedoAbierta(tokenPaga);
    } finally {
      await app.close();
    }
  });

  describe('confirmar con pago, en un solo gesto (spec § 7)', () => {
    it('con caja: confirma y paga en la misma transacción, el efectivo baja', async () => {
      await abrirOReusarCaja(tokenPaga);
      const id = await borradorSinDocumento('90');
      const confirmada = await post<CompraDetalle>(
        `/api/compras/${id}/confirmar`,
        { pago: { monto: '90', metodoPagoId: efectivo.id } },
        201,
        tokenPaga,
        { 'Idempotency-Key': randomUUID() },
      );
      expect(confirmada.estado).toBe('confirmada');
      expect(confirmada.estadoPago).toBe('pagada');
      expect(Number(confirmada.deuda)).toBe(0);
    });

    it('sin pago: sigue funcionando igual que antes (nadie necesita Pagar para confirmar)', async () => {
      const id = await borradorSinDocumento('40', proveedorId, tokenBodeguero);
      const confirmada = await post<{ estado: string }>(
        `/api/compras/${id}/confirmar`,
        {},
        201,
        tokenBodeguero,
      );
      expect(confirmada.estado).toBe('confirmada');
    });

    it('sin pago, el BODY de la respuesta ya trae los campos de pago si el caller tiene Pagar (fix round 1)', async () => {
      // Con Pagar (compras.paga): el body de la propia respuesta de
      // confirmar trae `deuda`, sin necesitar un GET posterior — es la
      // misma garantía que `GET /compras/:id`, no una aparte.
      const idConPagar = await borradorSinDocumento(
        '45',
        proveedorId,
        tokenPaga,
      );
      const confirmadaConPagar = await post<CompraDetalle>(
        `/api/compras/${idConPagar}/confirmar`,
        {},
        201,
        tokenPaga,
      );
      expect(confirmadaConPagar.estado).toBe('confirmada');
      expect(confirmadaConPagar.deuda).not.toBeUndefined();
      expect(Number(confirmadaConPagar.deuda)).toBe(45);
      expect(confirmadaConPagar.estadoPago).toBe('pendiente');

      // Sin Pagar (el bodeguero): el mismo body NO trae esos campos.
      const idSinPagar = await borradorSinDocumento(
        '45',
        proveedorId,
        tokenBodeguero,
      );
      const confirmadaSinPagar = await post<CompraDetalle>(
        `/api/compras/${idSinPagar}/confirmar`,
        {},
        201,
        tokenBodeguero,
      );
      expect(confirmadaSinPagar.estado).toBe('confirmada');
      expect(confirmadaSinPagar.deuda).toBeUndefined();
      expect(confirmadaSinPagar.deudaMinima).toBeUndefined();
      expect(confirmadaSinPagar.estadoPago).toBeUndefined();
      expect(confirmadaSinPagar.vencida).toBeUndefined();
    });

    it('con pago, sin Pagar (bodeguero): 403 y la compra sigue como borrador', async () => {
      const id = await borradorSinDocumento('50', proveedorId, tokenBodeguero);
      const r = await intentar(
        'post',
        `/api/compras/${id}/confirmar`,
        { pago: { monto: '50', metodoPagoId: efectivo.id } },
        tokenBodeguero,
        { 'Idempotency-Key': randomUUID() },
      );
      expect(r.status).toBe(403);

      const compra = await get<{ estado: string }>(
        `/api/compras/${id}`,
        200,
        tokenPaga,
      );
      expect(compra.estado).toBe('borrador');
    });

    it('con un pago en efectivo que falla DENTRO de la transacción (caja sin plata): no se confirma nada (pre-review, concern 5)', async () => {
      // El fallo tiene que salir de `pagarEnTransaccion` (un 422 real,
      // `IntentoRechazadoError`), no de una validación previa (403 de
      // permiso, 400 de un medio inexistente): eso es lo que prueba que "si
      // el pago falla, no se confirma nada" sale de compartir una sola
      // transacción, y no de una guarda que ni siquiera llega a intentar
      // pagar. Para eso, `compras.paga` cierra la caja que traiga abierta de
      // otros tests y abre una PROPIA con un saldo chico.
      await cerrarCajaSiQuedoAbierta(tokenPaga);
      const cajon = await post<IdResponse>(
        '/api/cajones',
        { nombre: nombreUnico('Cajón chico E2E') },
        201,
        token,
      );
      const resAbrir = await request(app.getHttpServer())
        .post('/api/caja/abrir')
        .set('Authorization', `Bearer ${tokenPaga}`)
        .send({
          cajonId: cajon.id,
          saldoInicial: '5.0000',
          comentario: 'Caja chica E2E — concern 5',
        });
      expect(resAbrir.status).toBe(201);
      const cajaChicaId = (resAbrir.body as CajaResponse).id;

      const pagosAntes = await get<PagoInfo[]>(
        `/api/compras/pagos?proveedorId=${proveedorId}`,
        200,
        tokenPaga,
      );

      const id = await borradorSinDocumento('9999', proveedorId, tokenPaga);
      const r = await intentar(
        'post',
        `/api/compras/${id}/confirmar`,
        // La caja solo tiene $5: pedir $9999 en efectivo revienta DENTRO de
        // `pagarEnTransaccion` (mismo chequeo que la salida manual).
        { pago: { monto: '9999', metodoPagoId: efectivo.id } },
        tokenPaga,
        { 'Idempotency-Key': randomUUID() },
      );
      expect(r.status).toBe(422);
      // Modo ciego: el 422 no interpola el disponible (spec § 5.3).
      expect(r.message).not.toContain('5.0000');

      // Nada se confirmó: la compra sigue como borrador.
      const compra = await get<{ estado: string }>(
        `/api/compras/${id}`,
        200,
        tokenPaga,
      );
      expect(compra.estado).toBe('borrador');

      // Ningún pago se creó (ni siquiera uno huérfano): mismo total de
      // `GET /compras/pagos` que antes del intento.
      const pagosDespues = await get<PagoInfo[]>(
        `/api/compras/pagos?proveedorId=${proveedorId}`,
        200,
        tokenPaga,
      );
      expect(pagosDespues.length).toBe(pagosAntes.length);

      // Y el rastro SÍ quedó: una fila `pago_proveedor` para esta caja,
      // visible con `Cajas:Leer` (admin) aunque la operación entera haya
      // revertido — es justamente lo que `conRastroDeRechazo` existe para
      // sostener (se escribe con `db.sinTransaccion`, fuera del rollback).
      const rastro = await get<{ data: IntentoRechazado[] }>(
        `/api/caja/intentos-rechazados?cajaId=${cajaChicaId}`,
        200,
        token,
      );
      expect(rastro.data.some((x) => x.tipo === 'pago_proveedor')).toBe(true);
    });

    it('el reintento con la MISMA Idempotency-Key no paga ni confirma dos veces', async () => {
      await abrirOReusarCaja(tokenPaga);
      const id = await borradorSinDocumento('35');
      const clave = randomUUID();
      const primera = await post<CompraDetalle & { repetida?: true }>(
        `/api/compras/${id}/confirmar`,
        { pago: { monto: '35', metodoPagoId: otroMedio.id } },
        201,
        tokenPaga,
        { 'Idempotency-Key': clave },
      );
      expect(primera.estado).toBe('confirmada');

      const segunda = await post<CompraDetalle & { repetida?: true }>(
        `/api/compras/${id}/confirmar`,
        { pago: { monto: '35', metodoPagoId: otroMedio.id } },
        201,
        tokenPaga,
        { 'Idempotency-Key': clave },
      );
      expect(segunda.repetida).toBe(true);

      // Un solo pago cubriendo la compra: el detalle sigue pagada, no el
      // doble (si hubiera pagado dos veces, quedaría "a favor" de más).
      const detalle = await get<CompraDetalle>(
        `/api/compras/${id}`,
        200,
        tokenPaga,
      );
      expect(detalle.estadoPago).toBe('pagada');
      expect(Number(detalle.aplicado)).toBe(35);
    });
  });

  describe('el recorte de aplicaciones (spec § 6)', () => {
    it('corregir el total transcrito a MENOS deja saldo a favor, usado en la próxima compra', async () => {
      const compraId = await borradorFactura('100');
      await post(`/api/compras/${compraId}/confirmar`, {}, 201, tokenPaga);
      await post(
        '/api/compras/pagos',
        {
          proveedorId,
          monto: '100',
          metodoPagoId: otroMedio.id,
          aplicaciones: [{ compraId, monto: '100' }],
        },
        201,
        tokenPaga,
        { 'Idempotency-Key': randomUUID() },
      );
      let detalle = await get<CompraDetalle>(
        `/api/compras/${compraId}`,
        200,
        tokenPaga,
      );
      expect(detalle.estadoPago).toBe('pagada');

      // Se corrige a $90: el recorte deja $10 a favor del proveedor.
      await patch(
        `/api/compras/${compraId}/documento`,
        { totalDocumento: '90' },
        200,
        tokenPaga,
      );
      detalle = await get<CompraDetalle>(
        `/api/compras/${compraId}`,
        200,
        tokenPaga,
      );
      expect(detalle.estadoPago).toBe('pagada');
      expect(Number(detalle.aplicado)).toBe(90);

      const porPagar = await get<PorPagarDetalle>(
        `/api/compras/por-pagar/${proveedorId}`,
        200,
        tokenPaga,
      );
      expect(porPagar.pagos.length).toBeGreaterThan(0);

      // Ese saldo a favor se usa en la próxima compra: un anticipo de $0 con
      // aplicaciones que se fondea SOLO del saldo (monto: '0').
      const nuevaCompraId = await compraConfirmada('10');
      const usoDeSaldo = await post<{ aplicaciones: unknown[] }>(
        '/api/compras/pagos',
        {
          proveedorId,
          monto: '0',
          aplicaciones: [{ compraId: nuevaCompraId, monto: '10' }],
        },
        201,
        tokenPaga,
        { 'Idempotency-Key': randomUUID() },
      );
      expect(usoDeSaldo.aplicaciones).toEqual([
        { compraId: nuevaCompraId, monto: '10.0000' },
      ]);
      const nuevaDetalle = await get<CompraDetalle>(
        `/api/compras/${nuevaCompraId}`,
        200,
        tokenPaga,
      );
      expect(nuevaDetalle.estadoPago).toBe('pagada');
    });

    it('corregir una línea de una factura (obligatorio) NO cambia la deuda (decisión 10)', async () => {
      const compraId = await borradorFactura('50');
      const detalleBorrador = await get<{
        lineas: { id: string }[];
      }>(`/api/compras/${compraId}`, 200, tokenPaga);
      await post(`/api/compras/${compraId}/confirmar`, {}, 201, tokenPaga);
      await post(
        '/api/compras/pagos',
        {
          proveedorId,
          monto: '50',
          metodoPagoId: otroMedio.id,
          aplicaciones: [{ compraId, monto: '50' }],
        },
        201,
        tokenPaga,
        { 'Idempotency-Key': randomUUID() },
      );
      let detalle = await get<CompraDetalle>(
        `/api/compras/${compraId}`,
        200,
        tokenPaga,
      );
      expect(detalle.estadoPago).toBe('pagada');

      const lineaId = detalleBorrador.lineas[0].id;
      await patch(
        `/api/compras/${compraId}/lineas/${lineaId}`,
        { precioUnitario: '3' },
        200,
        tokenPaga,
      );

      // La deuda sigue en 0: el total de una `obligatorio` es SOLO lo
      // transcrito, la línea no lo mueve.
      detalle = await get<CompraDetalle>(
        `/api/compras/${compraId}`,
        200,
        tokenPaga,
      );
      expect(detalle.totalDocumento).toBe('50.0000');
      expect(detalle.estadoPago).toBe('pagada');
      expect(Number(detalle.aplicado)).toBe(50);
    });

    it('anular una compra pagada deja lo pagado a favor (decisión 6b)', async () => {
      const compraId = await compraConfirmada('65');
      await post(
        '/api/compras/pagos',
        {
          proveedorId,
          monto: '65',
          metodoPagoId: otroMedio.id,
          aplicaciones: [{ compraId, monto: '65' }],
        },
        201,
        tokenPaga,
        { 'Idempotency-Key': randomUUID() },
      );

      const antesSaldo = await get<PorPagarDetalle>(
        `/api/compras/por-pagar/${proveedorId}`,
        200,
        tokenPaga,
      );
      const antesFavor = antesSaldo.pagos.length;

      await post(
        `/api/compras/${compraId}/anular`,
        { motivo: 'Se devolvió' },
        201,
        tokenPaga,
      );

      // La compra anulada no debe nada (§ 4.1: "solo cuentan las confirmada").
      const detalle = await get<CompraDetalle>(
        `/api/compras/${compraId}`,
        200,
        tokenPaga,
      );
      expect(detalle.estado).toBe('anulada');
      expect(detalle.estadoPago).toBeUndefined();

      // Y lo pagado quedó a favor: el mismo pago financia otra compra SOLO
      // con saldo (monto 0).
      const otraCompraId = await compraConfirmada('65');
      const usoDeSaldo = await post<{ aplicaciones: unknown[] }>(
        '/api/compras/pagos',
        {
          proveedorId,
          monto: '0',
          aplicaciones: [{ compraId: otraCompraId, monto: '65' }],
        },
        201,
        tokenPaga,
        { 'Idempotency-Key': randomUUID() },
      );
      expect(usoDeSaldo.aplicaciones).toEqual([
        { compraId: otraCompraId, monto: '65.0000' },
      ]);
      void antesFavor;
    });
  });

  describe('las escrituras también devuelven los campos de pago solo con Pagar (pre-review, concern 2)', () => {
    it('PATCH /documento: como compras.paga (Pagar) trae deuda; como compras.correccion (sin Pagar) no', async () => {
      const compraId = await borradorFactura('80');
      await post(`/api/compras/${compraId}/confirmar`, {}, 201, tokenPaga);

      const conPagar = await patch<CompraDetalle>(
        `/api/compras/${compraId}/documento`,
        { totalDocumento: '95' },
        200,
        tokenPaga,
      );
      expect(conPagar.deuda).not.toBeUndefined();
      expect(Number(conPagar.deuda)).toBe(95);
      expect(conPagar.estadoPago).toBe('pendiente');

      // `compras.correccion`: Leer, Crear, Actualizar — SIN Pagar (fixture
      // del 403 de anular, spec § 9 seed). Puede corregir `totalDocumento`
      // (mismo permiso, `Actualizar`), pero la respuesta no trae los campos
      // de pago aunque la compra siga debiendo.
      const sinPagar = await patch<CompraDetalle>(
        `/api/compras/${compraId}/documento`,
        { totalDocumento: '70' },
        200,
        tokenCorreccion,
      );
      expect(sinPagar.deuda).toBeUndefined();
      expect(sinPagar.deudaMinima).toBeUndefined();
      expect(sinPagar.estadoPago).toBeUndefined();
      expect(sinPagar.vencida).toBeUndefined();
      expect(sinPagar.totalDocumento).toBe('70.0000');
    });
  });

  describe('lecturas de deuda (spec § 8, decisión 12)', () => {
    it('por-pagar: el proveedor con deuda aparece, con su total', async () => {
      const propio = (
        await post<IdResponse>('/api/terceros', {
          tipo: 'proveedor',
          nombre: nombreUnico('Solo para por-pagar'),
        })
      ).id;
      await compraConfirmada('220', tokenPaga, propio);

      const lista = await get<PorPagarProveedorItem[]>(
        '/api/compras/por-pagar',
        200,
        tokenPaga,
      );
      const fila = lista.find((p) => p.proveedorId === propio);
      expect(fila).toBeDefined();
      expect(Number(fila!.deuda)).toBe(220);
    });

    it('por-pagar/:proveedorId lista solo compras con deuda o total desconocido', async () => {
      const propio = (
        await post<IdResponse>('/api/terceros', {
          tipo: 'proveedor',
          nombre: nombreUnico('Detalle por-pagar'),
        })
      ).id;
      const conDeuda = await compraConfirmada('30', tokenPaga, propio);
      const pagadaEntera = await compraConfirmada('15', tokenPaga, propio);
      await post(
        '/api/compras/pagos',
        {
          proveedorId: propio,
          monto: '15',
          metodoPagoId: otroMedio.id,
          aplicaciones: [{ compraId: pagadaEntera, monto: '15' }],
        },
        201,
        tokenPaga,
        { 'Idempotency-Key': randomUUID() },
      );

      const detalle = await get<PorPagarDetalle>(
        `/api/compras/por-pagar/${propio}`,
        200,
        tokenPaga,
      );
      const ids = detalle.compras.map((c) => c.id);
      expect(ids).toContain(conDeuda);
      expect(ids).not.toContain(pagadaEntera);
    });

    it('GET /compras y GET /compras/:id, con Pagar, traen estadoPago/deuda/vencida', async () => {
      const compraId = await compraConfirmada('22');
      const detalle = await get<CompraDetalle>(
        `/api/compras/${compraId}`,
        200,
        tokenPaga,
      );
      expect(detalle.estadoPago).toBe('pendiente');
      expect(Number(detalle.deuda)).toBe(22);
      expect(detalle.vencida).toBe(false);

      const listado = await get<Paginado<CompraDetalle>>(
        `/api/compras?proveedorId=${proveedorId}&pageSize=100`,
        200,
        tokenPaga,
      );
      const fila = listado.data.find((c) => c.id === compraId);
      expect(fila?.estadoPago).toBeDefined();
    });

    it('con el rol real del bodeguero (Leer sin Pagar): 403 en por-pagar, el detalle y el filtro estadoPago', async () => {
      const r1 = await intentar(
        'get',
        '/api/compras/por-pagar',
        {},
        tokenBodeguero,
      );
      expect(r1.status).toBe(403);

      const r2 = await intentar(
        'get',
        `/api/compras/por-pagar/${proveedorId}`,
        {},
        tokenBodeguero,
      );
      expect(r2.status).toBe(403);

      const r3 = await intentar(
        'get',
        '/api/compras/pagos?proveedorId=' + proveedorId,
        {},
        tokenBodeguero,
      );
      expect(r3.status).toBe(403);

      const r4 = await intentar(
        'get',
        '/api/compras?estadoPago=pendiente',
        {},
        tokenBodeguero,
      );
      expect(r4.status).toBe(403);
    });

    it('con el rol real del bodeguero: el listado y el detalle NO traen los campos de pago', async () => {
      const compraId = await compraConfirmada('18');
      const detalle = await get<CompraDetalle>(
        `/api/compras/${compraId}`,
        200,
        tokenBodeguero,
      );
      expect(detalle.estadoPago).toBeUndefined();
      expect(detalle.deuda).toBeUndefined();
      expect(detalle.deudaMinima).toBeUndefined();
      expect(detalle.vencida).toBeUndefined();
      expect(detalle.aplicado).toBeUndefined();
      expect(detalle.pagos).toBeUndefined();
      // Lo que él mismo transcribe SÍ sigue llegando.
      expect(detalle.total).not.toBeUndefined();

      const listado = await get<Paginado<CompraDetalle>>(
        `/api/compras?proveedorId=${proveedorId}&pageSize=100`,
        200,
        tokenBodeguero,
      );
      const fila = listado.data.find((c) => c.id === compraId);
      expect(fila).toBeDefined();
      expect(fila?.estadoPago).toBeUndefined();
      expect(fila?.deuda).toBeUndefined();
      expect(fila?.deudaMinima).toBeUndefined();
      expect(fila?.vencida).toBeUndefined();
    });

    /**
     * La escena de Andina (spec § 4.1 y decisión 8): bebidas $60.000 (con
     * precio) + queso sin precio, en un tipo `sinDocumento` (suma_lineas).
     * Se paga $50.000 parcial y, mientras falte el precio del queso, la
     * deuda mínima conocida es "al menos $10.000" (60.000 − 50.000) — nunca
     * el total exacto, que sigue `null` (`falta_precio`).
     */
    it('sin documento con una línea sin precio: falta_precio con deudaMinima "al menos $X"', async () => {
      const propio = (
        await post<IdResponse>('/api/terceros', {
          tipo: 'proveedor',
          nombre: nombreUnico('Andina queso E2E'),
        })
      ).id;
      const quesoId = (
        await post<IdResponse>('/api/items', {
          nombre: nombreUnico('Queso E2E'),
          precioBase: '1000',
          precioIncluyeImpuesto: true,
          monedaId: '550e8400-e29b-41d4-a716-446655440003',
          tipo: 'producto',
          unidadMedida: 'kg',
          stock: '1',
          costo: '500',
        })
      ).id;

      const borrador = await post<IdResponse>(
        '/api/compras',
        {
          proveedorId: propio,
          tipoDocumentoCompraId: sinDocumento.id,
          fechaDocumento: HOY,
          ubicacionId,
          lineas: [
            {
              itemId: productoId,
              cantidad: '1',
              unidadCodigo: 'kg',
              precioUnitario: '60000',
            },
            { itemId: quesoId, cantidad: '1', unidadCodigo: 'kg' },
          ],
        },
        201,
        tokenPaga,
      );
      await post(`/api/compras/${borrador.id}/confirmar`, {}, 201, tokenPaga);
      await post(
        '/api/compras/pagos',
        {
          proveedorId: propio,
          monto: '50000',
          metodoPagoId: otroMedio.id,
          aplicaciones: [{ compraId: borrador.id, monto: '50000' }],
        },
        201,
        tokenPaga,
        { 'Idempotency-Key': randomUUID() },
      );

      const detalle = await get<CompraDetalle>(
        `/api/compras/${borrador.id}`,
        200,
        tokenPaga,
      );
      expect(detalle.estadoPago).toBe('falta_precio');
      expect(detalle.deuda).toBeNull();
      expect(Number(detalle.deudaMinima)).toBe(10000);

      // Mismo dato en `por-pagar/:proveedorId` (§ 8).
      const porPagarDetalle = await get<PorPagarDetalle>(
        `/api/compras/por-pagar/${propio}`,
        200,
        tokenPaga,
      );
      const fila = porPagarDetalle.compras.find((c) => c.id === borrador.id);
      expect(fila?.estadoPago).toBe('falta_precio');
      expect(fila?.deuda).toBeNull();
      expect(Number(fila?.deudaMinima)).toBe(10000);

      // Sin `Pagar` (con `Leer`, el bodeguero): el campo ni viaja (decisión 12).
      const sinPagar = await get<CompraDetalle>(
        `/api/compras/${borrador.id}`,
        200,
        tokenBodeguero,
      );
      expect(sinPagar.estadoPago).toBeUndefined();
      expect(sinPagar.deuda).toBeUndefined();
      expect(sinPagar.deudaMinima).toBeUndefined();
    });

    /**
     * Decisión 8b (owner, 2026-09-29, corrigiendo el round 1 del review):
     * "sin ningún precio cargado no hay mínimo" — cuando NINGUNA línea tiene
     * precio, `deudaMinima` es `null`, no `'0'`. La pantalla dice solo
     * "falta el precio de N línea(s)", nunca "al menos $0".
     */
    it('sin documento con TODAS las líneas sin precio: falta_precio con deudaMinima null (decisión 8b)', async () => {
      const propio = (
        await post<IdResponse>('/api/terceros', {
          tipo: 'proveedor',
          nombre: nombreUnico('Sin ningún precio E2E'),
        })
      ).id;

      const borrador = await post<IdResponse>(
        '/api/compras',
        {
          proveedorId: propio,
          tipoDocumentoCompraId: sinDocumento.id,
          fechaDocumento: HOY,
          ubicacionId,
          lineas: [{ itemId: productoId, cantidad: '1', unidadCodigo: 'kg' }],
        },
        201,
        tokenPaga,
      );
      await post(`/api/compras/${borrador.id}/confirmar`, {}, 201, tokenPaga);

      const detalle = await get<CompraDetalle>(
        `/api/compras/${borrador.id}`,
        200,
        tokenPaga,
      );
      expect(detalle.estadoPago).toBe('falta_precio');
      expect(detalle.deuda).toBeNull();
      expect(detalle.deudaMinima).toBeNull();

      const porPagarDetalle = await get<PorPagarDetalle>(
        `/api/compras/por-pagar/${propio}`,
        200,
        tokenPaga,
      );
      const fila = porPagarDetalle.compras.find((c) => c.id === borrador.id);
      expect(fila?.estadoPago).toBe('falta_precio');
      expect(fila?.deuda).toBeNull();
      expect(fila?.deudaMinima).toBeNull();
    });
  });
});
