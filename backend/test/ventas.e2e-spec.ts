import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris
const ITEM_ID = '550e8400-e29b-41d4-a716-446655440116'; // Smartphone (stock = 10)
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const BOLETA_ID = '550e8400-e29b-41d4-a716-446655440145';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
// "Promo fija $5.000" — descuento monto_fijo sin condiciones (seedDescuentos()).
const DESCUENTO_FIJO_ID = '550e8400-e29b-41d4-a716-446655440338';

// Credentials seeded in dev (seed password: 'admin')
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

interface TokenResponse {
  access_token: string;
}
interface CajaResponse {
  id: string;
}
interface VentaResponse {
  id: string;
  estado: string;
  detalles: unknown[];
  pagos: unknown[];
  customer: unknown;
  advertencias?: string[];
}

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  const initialToken = (resLogin.body as TokenResponse).access_token;

  // Switch to Paris tenant so token carries tenant_id
  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  return (resTenant.body as TokenResponse).access_token;
}

async function abrirCaja(
  app: INestApplication<App>,
  token: string,
): Promise<string> {
  const disp = await request(app.getHttpServer())
    .get('/api/caja/cajones-disponibles')
    .set('Authorization', `Bearer ${token}`);
  const cajonId = (disp.body as Array<{ cajonId: string }>)[0]?.cajonId;
  const res = await request(app.getHttpServer())
    .post('/api/caja/abrir')
    .set('Authorization', `Bearer ${token}`)
    .send({ cajonId, saldoInicial: '10000.0000', comentario: 'Apertura E2E' });
  return (res.body as CajaResponse).id;
}

/**
 * El cierre es en DOS fases: `POST /:id/conteo` congela el arqueo y auto-cierra
 * si cuadra; si descuadra pasa a `en_conciliacion` y hay que resolver la fase 2
 * con `POST /:id/cerrar`. Llamar solo a `cerrar` no cierra nada y el cajón queda
 * ocupado para las suites siguientes (409 al abrir). El teardown **asegura** el
 * cierre en vez de ignorar el status: si vuelve a romperse, se ve acá y no como
 * una falla críptica en otra suite.
 */
async function cerrarCaja(
  app: INestApplication<App>,
  token: string,
  cajaId: string,
): Promise<void> {
  const conteo = await request(app.getHttpServer())
    .post(`/api/caja/${cajaId}/conteo`)
    .set('Authorization', `Bearer ${token}`)
    .send({ lineas: [{ metodoPagoId: null, montoContado: '10000' }] });

  if ((conteo.body as { estado?: string }).estado === 'en_conciliacion') {
    // El conteo declara solo el saldo inicial, así que las ventas en efectivo de
    // esta suite SIEMPRE descuadran. La fase 2 exige un motivo por línea
    // descuadrada: mandar `lineas: []` da 400 y deja el cajón ocupado.
    const motivos = await request(app.getHttpServer())
      .get('/api/motivos-diferencia?soloActivas=true')
      .set('Authorization', `Bearer ${token}`);
    const motivoId = (motivos.body as { id: string }[])[0]?.id;
    const cierre = await request(app.getHttpServer())
      .post(`/api/caja/${cajaId}/cerrar`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ metodoPagoId: null, motivoDiferenciaId: motivoId }] });
    expect([200, 201]).toContain(cierre.status);
  }
}

/** Lo efectivamente aplicado A LA VENTA (excluye la parte que fue a propina). */
async function getAplicadoVenta(
  ds: DataSource,
  ventaId: string,
): Promise<number> {
  const rows: { total: string }[] = await ds.query(
    `SELECT COALESCE(SUM(pa.monto), 0) AS total
       FROM pagos p
       JOIN pago_aplicaciones pa ON pa.pago_id = p.pago_id
            AND pa.eliminado_el IS NULL AND pa.tipo = 'venta'
      WHERE p.venta_id = $1 AND p.eliminado_el IS NULL`,
    [ventaId],
  );
  return parseFloat(rows[0]?.total ?? '0');
}

/**
 * Id del usuario autenticado, derivado del MISMO email con el que se loguea el
 * spec. Estaba hardcodeado en una constante marcada como no usada, y apuntaba a
 * otro usuario: nadie lo notó hasta que un test lo consumió de verdad.
 */
async function getUsuarioId(ds: DataSource): Promise<string> {
  const rows: { usuario_id: string }[] = await ds.query(
    `SELECT usuario_id FROM usuarios WHERE correo = $1 AND eliminado_el IS NULL`,
    [ADMIN_EMAIL],
  );
  return rows[0].usuario_id;
}

async function getStock(ds: DataSource, itemId: string): Promise<number> {
  const rows: { stock: string }[] = await ds.query(
    `SELECT ip.stock FROM item_producto ip
     JOIN items i ON i.item_id = ip.item_id
     WHERE ip.item_id = $1 AND i.eliminado_el IS NULL`,
    [itemId],
  );
  return parseFloat(rows[0]?.stock ?? '0');
}

describe('Ventas (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let cajaId: string;

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

    ds = app.get(DataSource);
    token = await login(app);
    cajaId = await abrirCaja(app, token);
  }, 60000);

  afterAll(async () => {
    if (cajaId) await cerrarCaja(app, token, cajaId);
    await app.close();
  });

  describe('POST /ventas', () => {
    it('crea venta con pago completo y queda en estado pagada', async () => {
      const stockAntes = await getStock(ds, ITEM_ID);

      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          tipoDocumentoId: BOLETA_ID,
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '1069810.0000' }],
        });

      const venta = res.body as VentaResponse;
      expect(res.status).toBe(201);
      expect(venta.estado).toBe('pagada');

      // Stock debe haber bajado en 1
      const stockDespues = await getStock(ds, ITEM_ID);
      expect(stockDespues).toBe(stockAntes - 1);

      // Movimiento de inventario registrado
      const movInv: { tipo: string; motivo: string }[] = await ds.query(
        `SELECT tipo, motivo FROM movimientos_inventario
         WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [venta.id],
      );
      expect(movInv.length).toBeGreaterThan(0);
      expect(movInv[0].tipo).toBe('salida');
      expect(movInv[0].motivo).toBe('venta');

      // Movimiento de caja registrado (efectivo)
      const movCaja: { tipo: string; concepto: string }[] = await ds.query(
        `SELECT tipo, concepto FROM movimientos_caja
         WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [venta.id],
      );
      expect(movCaja.length).toBeGreaterThan(0);
      expect(movCaja[0].tipo).toBe('entrada');
    });

    it('crea venta con pago menor y queda en estado pagada_parcial', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
        });

      // Abono parcial: total pagado > 0 y saldo < total_final → pagada_parcial
      // (docs/features/ventas.md). "pendiente" es solo sin pagos o total pagado 0.
      expect(res.status).toBe(201);
      expect((res.body as VentaResponse).estado).toBe('pagada_parcial');
    });

    it('retorna 400 si no hay caja abierta para el usuario', async () => {
      // Login como usuario sin caja abierta
      const resLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'vendedor@paris.cl', password: 'Vendedor1234!' });
      const vendedorToken = (resLogin.body as TokenResponse).access_token;

      if (!vendedorToken) {
        // Si el usuario vendedor no existe en seed, saltear
        return;
      }

      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${vendedorToken}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '119.0000' }],
        });

      expect(res.status).toBe(400);
    });

    it('retorna 400 cuando el excedente existe pero no hay método con vuelto', async () => {
      // Tarjeta de crédito (permite_vuelto = false) — pago mayor al total genera excedente sin vuelto
      const TARJETA_ID = '550e8400-e29b-41d4-a716-446655440107';
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: TARJETA_ID, monto: '2000000.0000' }],
        });

      expect(res.status).toBe(400);
    });

    // Un pago devuelto ÍNTEGRO como vuelto deja su movimiento de caja en neto
    // cero, y eso es una venta legítima: el cliente puso dos billetes y el
    // segundo alcanzaba solo. El movimiento de $0 no altera el esperado del
    // arqueo. Un guard de "monto > 0" sobre el movimiento tumbaría la venta
    // entera con 422 — la regresión que casi meto al endurecer el signo.
    it('acepta una venta donde un pago se devuelve entero (movimiento de caja en cero)', async () => {
      const precio = '500.0000';
      const venta = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1', precioUnitario: precio }],
          pagos: [
            { metodoPagoId: EFECTIVO_ID, monto: '300.0000' },
            { metodoPagoId: EFECTIVO_ID, monto: '595.0000' },
          ],
        });

      expect(venta.status).toBe(201);
      const ventaId = (venta.body as { id: string }).id;

      // El movimiento del pago devuelto entero existe y vale 0: se registra,
      // no se omite, así que la traza del pago queda completa.
      const movimientos: { monto: string }[] = await ds.query(
        `SELECT monto FROM movimientos_caja
          WHERE venta_id = $1 AND eliminado_el IS NULL
          ORDER BY monto ASC`,
        [ventaId],
      );
      expect(movimientos.map((m) => Number(m.monto))).toContain(0);
    });

    it('retorna 400 con payload vacío (validación DTO)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
    });

    // El motor topea "Promo fija $5.000" (monto_fijo, sin condición) contra el
    // disponible de una sola línea de $1.500: avisa, y ventas.service.ts
    // recompone `{ titulo, detalle }` a un string plano. Es la única venta de
    // toda la suite que dispara un descuento topeado al crear — sin ella, un
    // `map` roto que devuelva solo el título o solo el detalle no lo cacha nada
    // (ver Task 7).
    // El ítem es un SERVICIO que crea el propio test, no "Papas fritas": ese lo
    // consume `combos.e2e-spec.ts` como componente, y gastarle una unidad desde
    // acá aceleraba su agotamiento y afloraba como un fallo opaco en una suite
    // que no tiene nada que ver. Un servicio no tiene inventario, así que esta
    // venta no consume stock de nadie. La economía es idéntica a la de antes
    // —verificado contra `/calculo-precios/calcular`: subtotal 1500, descuento
    // topeado a 1500, `totalFinal` 0 en los dos casos—, así que las aserciones
    // no cambian.
    it('descuento de venta topeado devuelve la advertencia recompuesta completa', async () => {
      const resItem = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `Servicio advertencia E2E ${Date.now()}`,
          precioBase: '1500',
          monedaId: CLP_MONEDA_ID,
          tipo: 'servicio',
        });
      expect(resItem.status).toBe(201);
      const servicioId = (resItem.body as { id: string }).id;

      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: servicioId, cantidad: '1' }],
          descuentosVentaIds: [DESCUENTO_FIJO_ID],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000.0000' }],
        });

      expect(res.status).toBe(201);
      const venta = res.body as VentaResponse;
      expect(venta.advertencias).toHaveLength(1);
      const advertencia = venta.advertencias?.[0] ?? '';
      expect(advertencia).toContain('Promo fija $5.000');
      expect(advertencia).toContain('no se aplicó completo');
    });
  });

  describe('GET /tipos-documento', () => {
    interface TipoDocResponse {
      id: string;
      nombre: string;
      codigo: string | null;
      customerRequerido: boolean;
    }

    it('lista los tipos de documento del país del tenant con el flag customerRequerido', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tipos-documento')
        .set('Authorization', `Bearer ${token}`);

      const tipos = res.body as TipoDocResponse[];
      expect(res.status).toBe(200);
      expect(Array.isArray(tipos)).toBe(true);
      expect(tipos.length).toBeGreaterThan(0);

      const boleta = tipos.find((t) => t.codigo === '39');
      const factura = tipos.find((t) => t.codigo === '33');
      expect(boleta?.customerRequerido).toBe(false);
      expect(factura?.customerRequerido).toBe(true);
    });

    it('retorna 401 sin token', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/tipos-documento',
      );
      expect(res.status).toBe(401);
    });
  });

  describe('GET /ventas y GET /ventas/:id', () => {
    let ventaId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '200.0000' }],
          customer: { nombre: 'Juan Pérez', rut: '12.345.678-9' },
        });
      ventaId = (res.body as VentaResponse).id;
    });

    it('lista las ventas del tenant con paginación', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/ventas?page=1&pageSize=15')
        .set('Authorization', `Bearer ${token}`);

      const body = res.body as { data: unknown[]; meta: { total: number } };
      expect(res.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.meta.total).toBeGreaterThan(0);
    });

    it('GET /ventas/resumen retorna KPIs del tenant', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/ventas/resumen')
        .set('Authorization', `Bearer ${token}`);

      const body = res.body as {
        totalVentas: number;
        totalFacturado: string;
        saldoPendiente: string;
      };
      expect(res.status).toBe(200);
      expect(body.totalVentas).toBeGreaterThan(0);
      expect(body.totalFacturado).toBeDefined();
      expect(body.saldoPendiente).toBeDefined();
    });

    it('expande todos los campos en GET /ventas/:id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/ventas/${ventaId}`)
        .set('Authorization', `Bearer ${token}`);

      const venta = res.body as VentaResponse;
      expect(res.status).toBe(200);
      expect(venta.id).toBe(ventaId);
      expect(Array.isArray(venta.detalles)).toBe(true);
      expect(venta.detalles.length).toBe(1);
      expect(Array.isArray(venta.pagos)).toBe(true);
      expect(venta.pagos.length).toBe(1);
      expect(venta.customer).toBeDefined();
      expect((venta.customer as { nombre: string }).nombre).toBe('Juan Pérez');
    });

    it('retorna 404 para un ventaId inexistente', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/ventas/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('rollback completo ante stock insuficiente — no crea venta ni movimientos', async () => {
      // Pedir más stock del disponible
      const stockActual = await getStock(ds, ITEM_ID);
      const cantidadExcesiva = String(stockActual + 100);

      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: cantidadExcesiva }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '999999.0000' }],
        });

      expect(res.status).toBeGreaterThanOrEqual(400);

      // El stock no debe haber cambiado
      const stockDespues = await getStock(ds, ITEM_ID);
      expect(stockDespues).toBe(stockActual);
    });
  });

  describe('POST /ventas con propina directa (POS)', () => {
    const MOSTRADOR_ID = '550e8400-e29b-41d4-a716-446655440339';

    it('crea venta_propina en el Mostrador con atribución neutra', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000000.0000' }],
          propinaDirecta: { montoPagado: '5000', porcentajeSugerido: '0.10' },
        })
        .expect(201);

      const ventaId = (res.body as { id: string }).id;
      const rows: Array<{
        garzon_id: string;
        monto_pagado: string;
        tipo_garzon: string | null;
        sesion_garzon_id: string | null;
        turno_id: string | null;
        estado: string;
      }> = await ds.query(
        `SELECT garzon_id, monto_pagado, tipo_garzon, sesion_garzon_id, turno_id, estado
           FROM venta_propina WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [ventaId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].garzon_id).toBe(MOSTRADOR_ID);
      expect(rows[0].tipo_garzon).toBeNull();
      expect(rows[0].sesion_garzon_id).toBeNull();
      expect(rows[0].turno_id).toBeNull();
      expect(Number(rows[0].monto_pagado)).toBe(5000);
      expect(rows[0].estado).toBe('pagada');
    });

    it('el Mostrador no aparece en GET /garzones', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/garzones')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const ids = (res.body as Array<{ id: string }>).map((g) => g.id);
      expect(ids).not.toContain(MOSTRADOR_ID);
    });

    it('rechaza combinar propinaDirecta con propinaCierreMesa', async () => {
      await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '2000000.0000' }],
          propinaDirecta: { montoPagado: '5000' },
          propinaCierreMesa: {
            montoPagado: '5000',
            garzonId: '550e8400-e29b-41d4-a716-446655440238',
          },
        })
        .expect(400);
    });
  });

  describe('POST /pagos (abono) sobre una venta con propina', () => {
    const PROPINA = 2000;
    const PAGO_INICIAL = 3000;
    const ABONO = 1000;

    it('descuenta del saldo solo lo aplicado a la venta, nunca la propina', async () => {
      const resVenta = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: String(PAGO_INICIAL) }],
          propinaDirecta: { montoPagado: String(PROPINA) },
        })
        .expect(201);

      const venta = resVenta.body as {
        id: string;
        estado: string;
        totalFinal: string;
      };
      const totalFinal = Number(venta.totalFinal);
      expect(totalFinal).toBeGreaterThan(PAGO_INICIAL);
      expect(venta.estado).toBe('pagada_parcial');

      // Regla NO_VUELTO: la propina se sirve primero; a la venta llega el resto.
      const aplicadoInicial = await getAplicadoVenta(ds, venta.id);
      expect(aplicadoInicial).toBe(PAGO_INICIAL - PROPINA);

      const resAbono = await request(app.getHttpServer())
        .post('/api/pagos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          ventaId: venta.id,
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: String(ABONO) }],
        })
        .expect(201);

      const abono = (
        resAbono.body as { venta: { estado: string; saldo: string } }
      ).venta;

      // saldo = total − lo aplicado A LA VENTA. Si el saldo se calculara con la
      // suma bruta de pagos, la propina descontaría del saldo y la venta
      // quedaría cobrada de menos.
      expect(Number(abono.saldo)).toBe(
        totalFinal - (PAGO_INICIAL - PROPINA) - ABONO,
      );
      expect(abono.estado).toBe('pagada_parcial');
      expect(await getAplicadoVenta(ds, venta.id)).toBe(
        PAGO_INICIAL - PROPINA + ABONO,
      );
    });
  });

  describe('POST /ventas con un método de pago no contratado', () => {
    // UUID bien formado (pasa el DTO) que no está en tenant_metodo_pago.
    const METODO_AJENO = '550e8400-e29b-41d4-a716-446655440999';

    it('responde 400 por el método no habilitado y no escribe nada', async () => {
      const stockAntes = await getStock(ds, ITEM_ID);

      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          // Monto por debajo del total: si fuera excedente, el 400 vendría de
          // la regla del vuelto y este test pasaría sin probar el gate.
          pagos: [{ metodoPagoId: METODO_AJENO, monto: '1000.0000' }],
        })
        .expect(400);

      expect((res.body as { message: string }).message).toBe(
        'Método de pago no habilitado para este tenant',
      );

      // El gate corre dentro de la transacción y antes del commit: la venta no
      // queda a medias ni se descuenta stock.
      expect(await getStock(ds, ITEM_ID)).toBe(stockAntes);
    });
  });

  describe('POST /ventas con propina a un garzón de otro tenant', () => {
    // Garzón activo y válido, pero de Falabella. Está sembrado precisamente para
    // que el único motivo de rechazo posible sea el tenant: si el test usara un
    // UUID inexistente pasaría por "no encontrado" y no probaría el aislamiento.
    const GARZON_OTRO_TENANT = '550e8400-e29b-41d4-a716-446655440332';

    it('responde 400, no crea la propina ni descuenta stock', async () => {
      const stockAntes = await getStock(ds, ITEM_ID);

      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '1000.0000' }],
          propinaCierreMesa: {
            montoPagado: '5000',
            garzonId: GARZON_OTRO_TENANT,
          },
        })
        .expect(400);

      expect((res.body as { message: string }).message).toBe(
        'Garzón no encontrado o inactivo',
      );

      // La propina de otro tenant no quedó registrada en ninguna venta...
      const propinas: unknown[] = await ds.query(
        `SELECT 1 FROM venta_propina
          WHERE garzon_id = $1 AND eliminado_el IS NULL`,
        [GARZON_OTRO_TENANT],
      );
      expect(propinas).toHaveLength(0);
      // ...y la transacción revirtió entera.
      expect(await getStock(ds, ITEM_ID)).toBe(stockAntes);
    });
  });

  describe('POST /ventas/:id/anular', () => {
    /** Venta pendiente (sin pagos) — el único caso anulable. */
    async function crearPendiente(): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({ lineas: [{ itemId: ITEM_ID, cantidad: '2' }], pagos: [] })
        .expect(201);
      return (res.body as { id: string }).id;
    }

    it('anula, repone el stock y persiste quién y por qué', async () => {
      const stockAntes = await getStock(ds, ITEM_ID);
      const ventaId = await crearPendiente();
      expect(await getStock(ds, ITEM_ID)).toBe(stockAntes - 2);

      const res = await request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/anular`)
        .set('Authorization', `Bearer ${token}`)
        .send({ motivo: 'Ingresada por error en la caja 2' })
        .expect(201);

      expect((res.body as { estado: string }).estado).toBe('cancelada');
      // El stock volvió: la anulación no puede dejar el inventario corto.
      expect(await getStock(ds, ITEM_ID)).toBe(stockAntes);

      const rows: Array<{
        estado: string;
        motivo_cancelacion: string | null;
        cancelada_por_usuario_id: string | null;
        cancelada_el: Date | null;
      }> = await ds.query(
        `SELECT estado, motivo_cancelacion, cancelada_por_usuario_id, cancelada_el
           FROM ventas WHERE venta_id = $1`,
        [ventaId],
      );
      expect(rows[0].estado).toBe('cancelada');
      expect(rows[0].motivo_cancelacion).toBe(
        'Ingresada por error en la caja 2',
      );
      expect(rows[0].cancelada_por_usuario_id).toBe(await getUsuarioId(ds));
      expect(rows[0].cancelada_el).not.toBeNull();

      // El kardex distingue la anulación de una devolución de cliente.
      const mov: Array<{ tipo: string; motivo: string }> = await ds.query(
        `SELECT tipo, motivo FROM movimientos_inventario
          WHERE venta_id = $1 AND motivo = 'anulacion' AND eliminado_el IS NULL`,
        [ventaId],
      );
      expect(mov).toHaveLength(1);
      expect(mov[0].tipo).toBe('entrada');
    });

    it('el movimiento de anulación se puede filtrar desde el kardex', async () => {
      // El motivo nuevo hay que agregarlo al whitelist de `FindMovimientosDto`:
      // escribirlo en el kardex y no poder consultarlo deja la mitad de la
      // feature invisible. Sin este test, el 400 solo lo veía un humano.
      const ventaId = await crearPendiente();
      await request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/anular`)
        .set('Authorization', `Bearer ${token}`)
        .send({ motivo: 'Anulación para verificar el kardex' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/inventario/movimientos?motivo=anulacion')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const movs =
        (res.body as { data?: Array<{ motivo: string }> }).data ??
        (res.body as Array<{ motivo: string }>);
      expect(movs.length).toBeGreaterThan(0);
      expect(movs.every((m) => m.motivo === 'anulacion')).toBe(true);
    });

    it('con reponerStock=false anula sin devolver el stock', async () => {
      const ventaId = await crearPendiente();
      const stockTrasVenta = await getStock(ds, ITEM_ID);

      await request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/anular`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          motivo: 'Mercadería dañada, no vuelve a stock',
          reponerStock: false,
        })
        .expect(201);

      expect(await getStock(ds, ITEM_ID)).toBe(stockTrasVenta);
    });

    it('rechaza un motivo demasiado corto', async () => {
      const ventaId = await crearPendiente();
      await request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/anular`)
        .set('Authorization', `Bearer ${token}`)
        .send({ motivo: 'error' })
        .expect(400);
    });

    it('rechaza anular una venta ya pagada', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '1069810.0000' }],
        })
        .expect(201);

      const anular = await request(app.getHttpServer())
        .post(`/api/ventas/${(res.body as { id: string }).id}/anular`)
        .set('Authorization', `Bearer ${token}`)
        .send({ motivo: 'Intento de anular una venta cobrada' })
        .expect(400);

      expect((anular.body as { message: string }).message).toMatch(
        /Solo se anula una venta pendiente/,
      );
    });
  });

  describe('GET /propinas/porcentaje-sugerido-venta', () => {
    it('devuelve el porcentaje sugerido del tenant', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/propinas/porcentaje-sugerido-venta')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(
        typeof (res.body as { porcentajeSugerido: string }).porcentajeSugerido,
      ).toBe('string');
    });

    it('retorna 401 sin token', async () => {
      await request(app.getHttpServer())
        .get('/api/propinas/porcentaje-sugerido-venta')
        .expect(401);
    });
  });
});
