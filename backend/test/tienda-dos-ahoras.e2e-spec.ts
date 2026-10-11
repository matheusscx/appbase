import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { ProviderFactory } from '../src/modules/pasarela/providers/provider.factory';
import { TokensAccesoService } from '../src/modules/auth/tokens-acceso.service';
import { TipoTokenAcceso } from '../src/modules/auth/entities/token-acceso.entity';
import {
  instanteLocalEnZona,
  zonaHorariaTenant,
} from '../src/common/utils/rango-fecha.util';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris: Webpay Plus activo (seed)
const CLP = '550e8400-e29b-41d4-a716-446655440003';
const USD = '550e8400-e29b-41d4-a716-446655440005';
const TIPO_DESCUENTO_DIRECTO = '550e8400-e29b-41d4-a716-446655440337';
const EFECTIVO = '550e8400-e29b-41d4-a716-446655440105';
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };

/** El motivo que el admin lee cuando el ítem se borró durante el pago. */
const ITEM_BORRADO = 'Item no encontrado';

interface ModuloDisponible {
  moduloTenantId: string;
  nombre: string;
  permisos: { moduloAppPermisoId: string; permisoNombre: string }[];
}
interface OrdenAdmin {
  ordenId: string;
  estado: string;
  motivoSinVenta: string | null;
}

/** Todo lo que el reloj falso NO toca: solo se finge `Date`. */
const NO_FINGIR = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
] as const;

/**
 * La tienda calculaba el total dos veces, con dos "ahora"
 * (`docs/agent/pendientes.md` § 3, medido el 2026-10-09).
 *
 * `POST /online/pagar` calcula y autoriza en Webpay ese total. Cuando el
 * comprador vuelve, `OnlineCallbackHandler` creaba la venta con
 * `VentasService.crear`, que **recalculaba** desde el snapshot (ítem y
 * cantidad) con el catálogo y el reloj del retorno. Si algo que mueve el total
 * cambiaba en el medio —la hora cruza el borde de una promo o de una regla, el
 * precio, la tasa del día—, la venta se rechazaba y la orden quedaba pagada sin
 * venta. Estos casos lo midieron así el 2026-10-09.
 *
 * La opción A ("la venta vale lo que se pagó") lo cerró: `pagar` congela en la
 * orden el resultado del motor y el callback crea la venta con eso, sin
 * recalcular. Lo que cambió entre el pago y el retorno ya no importa: la venta
 * guarda el total, el pago y el desglose de lo que se cobró.
 *
 * El caso fiscal fija que el impuesto adicional también sale de lo cobrado: la
 * tasa cambia en el medio y la venta guarda la que se cobró.
 *
 * Lo que A no cubre es que el ítem desaparezca (se borra mientras el comprador
 * está en Webpay) o que se acabe su stock: ahí la venta no se puede crear y la
 * orden sigue pagada sin venta. Para eso siguen valiendo D y E (owner, 2026-10-09):
 * - D: la orden pagada sin venta no miente. El comprador ve que el pago llegó y
 *   la compra no quedó registrada, y el admin la encuentra con su motivo.
 * - E: la venta online no lleva vuelto. Con A, lo pagado es exactamente el
 *   total de la venta.
 * Ningún caso crea la venta "después": no hay reintento automático.
 *
 * El camino es el de `tienda-impuestos-del-item.e2e-spec.ts`: proveedor falso,
 * `pagar`, el retorno de Webpay por HTTP y el callback en proceso.
 */
describe('Tienda: la venta vale lo que se pagó, aunque algo cambie entre el pago y el retorno (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let apiKey: string;
  let zona: string;
  const itemsCreados: string[] = [];
  const reglasCreadas: { ruta: string; id: string }[] = [];

  /** Lo que el proveedor falso recibió para autorizar, en orden. */
  const autorizados: string[] = [];
  const proveedor = {
    iniciarPago: (
      _cred: unknown,
      p: { codigoOrden: string; monto: string },
    ) => {
      autorizados.push(p.monto);
      return Promise.resolve({
        tokenExterno: `tok-dos-ahoras-${p.codigoOrden}`,
        urlRedireccion: 'https://webpay.falso/iniciar',
        aprobada: true,
        codigoRespuesta: null,
        request: {},
        response: {},
      });
    },
    confirmarPago: () =>
      Promise.resolve({
        aprobada: true,
        codigoRespuesta: '0',
        codigoAutorizacion: '1213',
        identificadorTransaccionExterno: null,
        tipoPago: 'VN',
        numeroCuotas: 0,
        montoCuota: null,
        tarjetaUltimos4: '6623',
        request: {},
        response: {},
      }),
  };

  const reembolsarEnElProveedor = jest.fn(() =>
    Promise.resolve({
      aprobada: true,
      codigoRespuesta: '0',
      codigoAutorizacion: 'AUT-E2E',
      tipoPago: 'VN',
      request: {},
      response: {},
    }),
  );

  /** Los `logger.error` del dispatcher: el único rastro del motivo. */
  let errores: jest.SpyInstance;

  const login = async (
    credenciales: { email: string; password: string } = ADMIN,
  ): Promise<string> => {
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send(credenciales);
    expect(resLogin.status).toBe(200);
    const resTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set(
        'Cookie',
        (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
      )
      .set(
        'Authorization',
        `Bearer ${(resLogin.body as { access_token: string }).access_token}`,
      )
      .send({ tenantId: TENANT_ID });
    expect(resTenant.status).toBe(200);
    return (resTenant.body as { access_token: string }).access_token;
  };

  const crearItem = async (
    precioBase: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Servicio dos ahoras E2E ${randomUUID()}`,
        precioBase,
        monedaId: CLP,
        tipo: 'servicio',
        ...extra,
      });
    expect(res.status).toBe(201);
    const id = (res.body as { id: string }).id;
    itemsCreados.push(id);
    return id;
  };

  /**
   * Borra un ítem durante el caso. Lo usan los casos de lo que A no cubre (el
   * ítem se borra mientras el comprador está en Webpay) y la limpieza del caso
   * fiscal.
   */
  const borrarItem = async (itemId: string) => {
    const res = await request(app.getHttpServer())
      .delete(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBeLessThan(300);
    const i = itemsCreados.indexOf(itemId);
    if (i >= 0) itemsCreados.splice(i, 1);
  };

  const cambiarPrecio = async (itemId: string, precioBase: string) => {
    const res = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ precioBase });
    expect(res.status).toBe(200);
  };

  /** El total que el motor da para el carrito en este instante (no cobra). */
  const totalAhora = async (itemId: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/online/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ itemId, cantidad: '1' }] });
    expect(res.status).toBe(201);
    return (res.body as { resultado: { totales: { totalFinal: string } } })
      .resultado.totales.totalFinal;
  };

  const pagar = async (itemId: string) => {
    const res = await request(app.getHttpServer())
      .post('/api/online/pagar')
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ itemId, cantidad: '1' }] });
    expect(res.status).toBe(201);
    const { modo, ordenId } = res.body as { modo: string; ordenId: string };
    expect(modo).toBe('webpay');
    return { ordenId, autorizado: autorizados.at(-1)! };
  };

  /** El comprador vuelve de Webpay con el pago aprobado. */
  const volver = async (ordenId: string) => {
    const [orden]: { token_proveedor: string }[] = await ds.query(
      `SELECT token_proveedor FROM pasarela_ordenes
        WHERE orden_id = $1 AND eliminado_el IS NULL`,
      [ordenId],
    );
    const res = await request(app.getHttpServer()).get(
      `/api/pasarela/retorno/pago?token_ws=${orden.token_proveedor}`,
    );
    expect(res.status).toBe(302);
    return res.headers.location;
  };

  const ordenDe = async (ordenId: string) => {
    const [fila]: {
      estado: string;
      venta_id: string | null;
      codigo_orden: string;
    }[] = await ds.query(
      `SELECT estado, venta_id, codigo_orden FROM pasarela_ordenes
          WHERE orden_id = $1 AND eliminado_el IS NULL`,
      [ordenId],
    );
    return fila;
  };

  /** Lo que el admin encuentra en `/ordenes` filtrando "Pagada sin venta". */
  const sinVentaEnElListado = async (
    ordenId: string,
    conToken = token,
  ): Promise<OrdenAdmin[]> => {
    const { codigo_orden } = await ordenDe(ordenId);
    const res = await request(app.getHttpServer())
      .get(`/api/pasarela/admin/ordenes?sinVenta=true&search=${codigo_orden}`)
      .set('Authorization', `Bearer ${conToken}`);
    expect(res.status).toBe(200);
    return (res.body as { data: OrdenAdmin[] }).data;
  };

  const ordenAdmin = async (
    ordenId: string,
    conToken = token,
  ): Promise<OrdenAdmin> => {
    const res = await request(app.getHttpServer())
      .get(`/api/pasarela/admin/ordenes/${ordenId}`)
      .set('Authorization', `Bearer ${conToken}`);
    expect(res.status).toBe(200);
    return res.body as OrdenAdmin;
  };

  const ventasOnline = async (): Promise<number> => {
    const [fila]: { n: string }[] = await ds.query(
      `SELECT count(*) AS n FROM ventas
        WHERE tenant_id = $1 AND canal = 'online' AND eliminado_el IS NULL`,
      [TENANT_ID],
    );
    return Number(fila.n);
  };

  const ordenesDelTenant = async (): Promise<number> => {
    const [fila]: { n: string }[] = await ds.query(
      `SELECT count(*) AS n FROM pasarela_ordenes
        WHERE tenant_id = $1 AND eliminado_el IS NULL`,
      [TENANT_ID],
    );
    return Number(fila.n);
  };

  const localDelTenant = async (): Promise<string> => {
    const [fila]: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones
        WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [TENANT_ID],
    );
    return fila.ubicacion_id;
  };

  const erroresDeLaOrden = (ordenId: string): string[] =>
    errores.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .filter((m) => m.includes(ordenId));

  /**
   * Cuando el callback no puede crear la venta (D): el cargo está autorizado y
   * la orden queda `pagada` sin venta, pero ya no miente. El comprador recibe un
   * estado propio, el admin la encuentra con el motivo de dominio, y nada la
   * convierte en venta sola.
   */
  const afirmarCargoSinVenta = async (
    ordenId: string,
    location: string,
    ventasAntes: number,
    motivo: string,
  ): Promise<void> => {
    const orden = await ordenDe(ordenId);
    expect(orden.estado).toBe('pagada');
    expect(orden.venta_id).toBeNull();
    expect(await ventasOnline()).toBe(ventasAntes);

    // El redirect ya no es el de una orden conciliada.
    expect(location).toContain(`ordenId=${ordenId}&estado=pagada_sin_venta`);

    // Lo que la pantalla de retorno lee para decidir qué mostrar: el estado
    // propio, y nunca el motivo (ese es del admin).
    const resultado = await request(app.getHttpServer())
      .get(`/api/online/orden/${ordenId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resultado.status).toBe(200);
    expect(resultado.body).toMatchObject({
      estado: 'pagada_sin_venta',
      ventaId: null,
    });
    expect(resultado.body).not.toHaveProperty('motivoSinVenta');

    // El aviso al admin: el motivo legible del dominio, en el drawer y en el
    // filtro "Pagada sin venta" de `/ordenes`.
    expect((await ordenAdmin(ordenId)).motivoSinVenta).toBe(motivo);
    expect(await sinVentaEnElListado(ordenId)).toEqual([
      expect.objectContaining({
        ordenId,
        estado: 'pagada',
        motivoSinVenta: motivo,
      }),
    ]);

    // Verificar no la rescata (sin reintento automático): sigue resuelta.
    const verificar = await request(app.getHttpServer())
      .post(`/api/pasarela/api/ordenes/${ordenId}/verificar`)
      .set('Authorization', `Bearer ${apiKey}`);
    expect(verificar.status).toBe(400);
    expect((verificar.body as { message: string }).message).toBe(
      'La orden ya está resuelta (pagada)',
    );
    expect((await ordenDe(ordenId)).estado).toBe('pagada');
    expect(await ventasOnline()).toBe(ventasAntes);

    // El detalle técnico sigue en el log, con el mismo motivo.
    const log = erroresDeLaOrden(ordenId);
    expect(log).toHaveLength(1);
    expect(log[0]).toContain(motivo);
  };

  /**
   * "Vale lo que pagó" (A): lo que cambió entre el pago y el retorno no
   * importa, porque la venta se crea con lo que se cobró. Devuelve la venta.
   */
  const afirmarVentaPorLoCobrado = async (
    ordenId: string,
    location: string,
    ventasAntes: number,
    autorizado: string,
  ): Promise<string> => {
    const orden = await ordenDe(ordenId);
    expect(orden.estado).toBe('conciliada');
    expect(orden.venta_id).not.toBeNull();
    expect(await ventasOnline()).toBe(ventasAntes + 1);
    // `estado=pagada` y nada más: un `toContain` aceptaría `pagada_sin_venta`.
    expect(location).toMatch(
      new RegExp(`[?&]ordenId=${ordenId}&estado=pagada$`),
    );
    const [venta]: { total_final: string }[] = await ds.query(
      `SELECT total_final FROM ventas WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [orden.venta_id],
    );
    expect(Number(venta.total_final)).toBe(Number(autorizado));
    // Sin vuelto: lo pagado es exactamente el total (E).
    const [pago]: { monto: string; vuelto: string }[] = await ds.query(
      `SELECT sum(monto) AS monto, sum(vuelto) AS vuelto FROM pagos
        WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [orden.venta_id],
    );
    expect(Number(pago.monto)).toBe(Number(autorizado));
    expect(Number(pago.vuelto)).toBe(0);
    expect(erroresDeLaOrden(ordenId)).toEqual([]);
    // Sin aviso: la orden conciliada no aparece entre las pagadas sin venta.
    expect((await ordenAdmin(ordenId)).motivoSinVenta).toBeNull();
    expect(await sinVentaEnElListado(ordenId)).toEqual([]);
    return orden.venta_id!;
  };

  const detalleDe = async (ventaId: string) => {
    const [d]: {
      precio_unitario: string;
      precio_unitario_origen: string;
      tasa_cambio: string;
    }[] = await ds.query(
      `SELECT precio_unitario, precio_unitario_origen, tasa_cambio
         FROM venta_detalles WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
    return d;
  };

  // ─── Reloj ─────────────────────────────────────────────────────────────────

  /** La hora de pared de `t` en la zona del tenant, como ms "UTC" de esa pared. */
  const pared = (t: Date): number => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: zona,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
        .formatToParts(t)
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(
      +p.year,
      +p.month - 1,
      +p.day,
      +p.hour,
      +p.minute,
      +p.second,
    );
  };

  /** El instante en que el local marca `fecha` `hora` (`YYYY-MM-DD`, `HH:mm:ss`). */
  const instanteLocal = (fecha: string, hora: string): Date => {
    const objetivo = Date.parse(`${fecha}T${hora}Z`);
    let t = objetivo - (pared(new Date(objetivo)) - objetivo);
    t += objetivo - pared(new Date(t)); // un ajuste si el offset cambia (DST)
    return new Date(t);
  };

  const sumarDias = (fecha: string, dias: number): string =>
    new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * 86_400_000)
      .toISOString()
      .slice(0, 10);

  /** Corre `fn` con el `Date` del proceso parado en `inicio` (avanza solo). */
  const conReloj = async (inicio: Date, fn: () => Promise<void>) => {
    jest.useFakeTimers({
      now: inicio,
      advanceTimers: true,
      doNotFake: [...NO_FINGIR],
    });
    try {
      // El token se saca con el reloj ya movido: con el de afuera podría estar
      // vencido, o emitido en el futuro, según hacia dónde se mueva.
      token = await login();
      await fn();
    } finally {
      jest.useRealTimers();
      token = await login();
    }
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ProviderFactory)
      .useValue({
        getPagoRedirect: () => proveedor,
        getReembolsable: () => ({
          reembolsar: reembolsarEnElProveedor,
          consultarEstado: () => Promise.reject(new Error('no se consulta')),
        }),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);
    zona = await zonaHorariaTenant(ds, TENANT_ID);

    token = await login();
    const resKey = await request(app.getHttpServer())
      .post('/api/pasarela/admin/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `dos ahoras e2e ${Date.now()}` });
    expect(resKey.status).toBe(201);
    apiKey = (resKey.body as { apiKey: string }).apiKey;
  });

  beforeEach(() => {
    errores = jest.spyOn(Logger.prototype, 'error');
  });

  afterEach(() => {
    errores.mockRestore();
  });

  afterAll(async () => {
    const fallas: unknown[] = [];
    for (const { ruta, id } of reglasCreadas) {
      const res = await request(app.getHttpServer())
        .delete(`/api/${ruta}/${id}`)
        .set('Authorization', `Bearer ${token}`);
      if (res.status >= 300) fallas.push(`${ruta}/${id}: ${res.status}`);
    }
    // Al revés de como se crearon: una receta viva tiene en uso a su insumo.
    for (const id of [...itemsCreados].reverse()) {
      const res = await request(app.getHttpServer())
        .delete(`/api/items/${id}`)
        .set('Authorization', `Bearer ${token}`);
      if (res.status >= 300) fallas.push(`items/${id}: ${res.status}`);
    }
    await app.close();
    expect(fallas).toEqual([]);
  });

  it('control: sin cambios entre el pago y el retorno, la orden queda conciliada con su venta', async () => {
    const itemId = await crearItem('10000');
    const ventasAntes = await ventasOnline();

    const { ordenId, autorizado } = await pagar(itemId);
    const location = await volver(ordenId);

    await afirmarVentaPorLoCobrado(ordenId, location, ventasAntes, autorizado);
  });

  describe('el reloj: los dos "ahora" (sin tocar el catálogo)', () => {
    it('happy hour 18:00–19:59: se paga a las 19:59:30 con la promo y se vuelve a las 20:00:30: la venta lleva la promo cobrada', async () => {
      const hoy = instanteLocalEnZona(zona, new Date()).fecha;
      const itemId = await crearItem('10000');
      const promo = await request(app.getHttpServer())
        .post('/api/promociones')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `Happy hour dos ahoras E2E ${randomUUID()}`,
          tipo: 'porcentaje',
          valorPorcentaje: '0.20',
          fechaInicio: sumarDias(hoy, -1),
          fechaFin: sumarDias(hoy, 1),
          horaInicio: '18:00',
          horaFin: '19:59',
          scopes: [{ tipoScope: 'items', itemIds: [itemId] }],
        });
      expect(promo.status).toBe(201);
      const promocionId = (promo.body as { id: string }).id;
      reglasCreadas.push({ ruta: 'promociones', id: promocionId });
      const ventasAntes = await ventasOnline();

      await conReloj(instanteLocal(hoy, '19:59:30'), async () => {
        const { ordenId, autorizado } = await pagar(itemId);

        jest.setSystemTime(instanteLocal(hoy, '20:00:30'));
        // Lo que habría dado un recálculo en el retorno: el precio lleno, sin
        // el 20%. Prueba que la promo sí terminó; la venta igual vale lo cobrado.
        const enElRetorno = await totalAhora(itemId);
        expect(Number(autorizado)).toBeLessThan(Number(enElRetorno));

        const location = await volver(ordenId);
        const ventaId = await afirmarVentaPorLoCobrado(
          ordenId,
          location,
          ventasAntes,
          autorizado,
        );
        const [promoAplicada]: { n: string }[] = await ds.query(
          `SELECT count(*) AS n FROM ventas_promociones
            WHERE venta_id = $1 AND promocion_id = $2 AND eliminado_el IS NULL`,
          [ventaId, promocionId],
        );
        expect(Number(promoAplicada.n)).toBe(1);
      });
    });

    it('descuento con fechaFin hoy: se paga a las 23:59:30 con el descuento y se vuelve al día siguiente: la venta lleva el descuento cobrado', async () => {
      const hoy = instanteLocalEnZona(zona, new Date()).fecha;
      const descuento = await request(app.getHttpServer())
        .post('/api/descuentos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `Vence hoy dos ahoras E2E ${randomUUID()}`,
          tipoReglaId: TIPO_DESCUENTO_DIRECTO,
          modo: 'porcentaje',
          valorPorcentaje: '0.10',
          fechaInicio: hoy,
          fechaFin: hoy,
        });
      expect(descuento.status).toBe(201);
      const descuentoId = (descuento.body as { id: string }).id;
      reglasCreadas.push({ ruta: 'descuentos', id: descuentoId });
      const itemId = await crearItem('10000', {
        descuentosIds: [descuentoId],
      });
      const ventasAntes = await ventasOnline();

      await conReloj(instanteLocal(hoy, '23:59:30'), async () => {
        const { ordenId, autorizado } = await pagar(itemId);

        // 01:00:30 y no 00:00:30: la noche del cambio de hora de septiembre
        // Chile salta de 24:00 a 01:00, y las 00:00:30 de ese día no existen.
        jest.setSystemTime(instanteLocal(sumarDias(hoy, 1), '01:00:30'));
        // Pasó más que la vida del JWT (15 min). El retorno de Webpay no lo usa;
        // el token nuevo es solo para leer el total y la orden.
        token = await login();
        const enElRetorno = await totalAhora(itemId);
        expect(Number(enElRetorno)).toBeGreaterThan(Number(autorizado));

        const location = await volver(ordenId);
        const ventaId = await afirmarVentaPorLoCobrado(
          ordenId,
          location,
          ventasAntes,
          autorizado,
        );
        const [descuentoAplicado]: { n: string }[] = await ds.query(
          `SELECT count(*) AS n FROM ventas_descuentos
            WHERE venta_id = $1 AND descuento_id = $2 AND eliminado_el IS NULL`,
          [ventaId, descuentoId],
        );
        expect(Number(descuentoAplicado.n)).toBe(1);
      });
    });
  });

  describe('el catálogo cambia mientras el comprador está en Webpay', () => {
    it('el precio sube: la venta se crea por lo cobrado, no por el precio nuevo', async () => {
      const itemId = await crearItem('10000');
      const ventasAntes = await ventasOnline();

      const { ordenId, autorizado } = await pagar(itemId);
      await cambiarPrecio(itemId, '12000');
      expect(Number(await totalAhora(itemId))).toBeGreaterThan(
        Number(autorizado),
      );

      const location = await volver(ordenId);
      const ventaId = await afirmarVentaPorLoCobrado(
        ordenId,
        location,
        ventasAntes,
        autorizado,
      );
      expect(Number((await detalleDe(ventaId)).precio_unitario_origen)).toBe(
        10000,
      );
    });

    it('el precio baja: la venta se crea por lo cobrado, sin vuelto', async () => {
      const itemId = await crearItem('10000');
      const ventasAntes = await ventasOnline();

      const { ordenId, autorizado } = await pagar(itemId);
      await cambiarPrecio(itemId, '8000');
      expect(Number(await totalAhora(itemId))).toBeLessThan(Number(autorizado));

      const location = await volver(ordenId);
      const ventaId = await afirmarVentaPorLoCobrado(
        ordenId,
        location,
        ventasAntes,
        autorizado,
      );
      expect(Number((await detalleDe(ventaId)).precio_unitario_origen)).toBe(
        10000,
      );
    });

    it('el precio baja con permite_vuelto en la tarjeta: tampoco hay vuelto, la venta vale lo cobrado (E)', async () => {
      // El método que el checkout resuelve como crédito (el del snapshot).
      const metodos = await request(app.getHttpServer())
        .get('/api/metodos-pago')
        .set('Authorization', `Bearer ${token}`);
      expect(metodos.status).toBe(200);
      const credito = (
        metodos.body as {
          metodoPagoId: string;
          nombre: string;
          habilitada: boolean;
          permiteVuelto: boolean;
        }[]
      ).find(
        (m) =>
          m.habilitada &&
          ['crédito', 'credito'].some((t) =>
            m.nombre.toLowerCase().includes(t),
          ),
      )!;
      expect(credito.permiteVuelto).toBe(false);
      const ponerVuelto = (permiteVuelto: boolean) =>
        request(app.getHttpServer())
          .patch(`/api/metodos-pago/${credito.metodoPagoId}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ permiteVuelto });

      const itemId = await crearItem('10000');
      const ventasAntes = await ventasOnline();
      expect((await ponerVuelto(true)).status).toBe(200);
      try {
        const { ordenId, autorizado } = await pagar(itemId);
        await cambiarPrecio(itemId, '8000');
        expect(Number(await totalAhora(itemId))).toBeLessThan(
          Number(autorizado),
        );

        // Antes de E esta venta se creaba con un vuelto de 2.380 sobre la
        // tarjeta, que nadie devolvía. Con A la venta vale lo cobrado y
        // `afirmarVentaPorLoCobrado` afirma vuelto 0, aunque el método lo permita.
        const location = await volver(ordenId);
        const ventaId = await afirmarVentaPorLoCobrado(
          ordenId,
          location,
          ventasAntes,
          autorizado,
        );
        expect(Number((await detalleDe(ventaId)).precio_unitario_origen)).toBe(
          10000,
        );
      } finally {
        expect((await ponerVuelto(false)).status).toBe(200);
      }
    });

    it('la tasa del día de USD sube: la venta guarda la tasa cobrada', async () => {
      const monedas = await request(app.getHttpServer())
        .get('/api/monedas')
        .set('Authorization', `Bearer ${token}`);
      expect(monedas.status).toBe(200);
      const usd = (
        monedas.body as { monedaId: string; valorDelDia: string | null }[]
      ).find((m) => m.monedaId === USD)!;
      const tasaOriginal = usd.valorDelDia!;
      const ponerTasa = (valorDelDia: string) =>
        request(app.getHttpServer())
          .patch(`/api/monedas/${USD}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ valorDelDia });

      const itemId = await crearItem('10', { monedaId: USD });
      const ventasAntes = await ventasOnline();
      try {
        const { ordenId, autorizado } = await pagar(itemId);
        expect(
          (await ponerTasa(String(Number(tasaOriginal) + 50))).status,
        ).toBe(200);
        expect(Number(await totalAhora(itemId))).toBeGreaterThan(
          Number(autorizado),
        );

        const location = await volver(ordenId);
        const ventaId = await afirmarVentaPorLoCobrado(
          ordenId,
          location,
          ventasAntes,
          autorizado,
        );
        expect(Number((await detalleDe(ventaId)).tasa_cambio)).toBe(
          Number(tasaOriginal),
        );
      } finally {
        expect((await ponerTasa(tasaOriginal)).status).toBe(200);
      }
    });

    it('la tasa de un impuesto adicional cambia: la venta guarda el impuesto cobrado', async () => {
      const imp = await request(app.getHttpServer())
        .post('/api/impuestos')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `Adicional dos ahoras E2E ${randomUUID()}`,
          porcentaje: '0.10',
        });
      expect(imp.status).toBe(201);
      const impuestoId = (imp.body as { id: string }).id;
      // Lo borra el `afterAll` aunque el caso falle antes del `try`.
      reglasCreadas.push({ ruta: 'impuestos', id: impuestoId });
      const itemId = await crearItem('10000', { impuestosIds: [impuestoId] });
      const ventasAntes = await ventasOnline();
      try {
        const { ordenId, autorizado } = await pagar(itemId);
        const cambio = await request(app.getHttpServer())
          .patch(`/api/impuestos/${impuestoId}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ porcentaje: '0.20' });
        expect(cambio.status).toBe(200);
        expect(Number(await totalAhora(itemId))).toBeGreaterThan(
          Number(autorizado),
        );

        const location = await volver(ordenId);
        const ventaId = await afirmarVentaPorLoCobrado(
          ordenId,
          location,
          ventasAntes,
          autorizado,
        );
        const [adicional]: {
          valor_aplicado: string;
          porcentaje_aplicado: string;
        }[] = await ds.query(
          `SELECT valor_aplicado, porcentaje_aplicado FROM ventas_impuestos
            WHERE venta_id = $1 AND impuesto_id = $2 AND eliminado_el IS NULL`,
          [ventaId, impuestoId],
        );
        expect(Number(adicional.porcentaje_aplicado)).toBe(0.1);
        expect(Number(adicional.valor_aplicado)).toBe(1000);
      } finally {
        await borrarItem(itemId);
      }
    });
  });

  describe('lo que A no cubre: el ítem se borra mientras el comprador está en Webpay', () => {
    it('la venta no se puede crear: la orden queda pagada sin venta y el admin devuelve el cargo', async () => {
      const itemId = await crearItem('10000');
      const ventasAntes = await ventasOnline();

      const { ordenId, autorizado } = await pagar(itemId);
      await borrarItem(itemId);
      const location = await volver(ordenId);
      await afirmarCargoSinVenta(ordenId, location, ventasAntes, ITEM_BORRADO);

      // Lo que hace el admin con el aviso: devuelve el cargo entero, a mano.
      // Sin venta no hay corrección que dejar, y la venta sigue sin existir.
      const reembolso = await request(app.getHttpServer())
        .post(`/api/pasarela/admin/ordenes/${ordenId}/reembolsos`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', randomUUID())
        .send({ monto: autorizado });
      expect(reembolso.status).toBe(201);
      expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(1);
      const cuerpo = reembolso.body as {
        reembolsoAprobado: boolean;
        notaCreditoId?: string | null;
      };
      expect(cuerpo.reembolsoAprobado).toBe(true);
      expect(cuerpo.notaCreditoId ?? null).toBeNull();
      expect(await ventasOnline()).toBe(ventasAntes);
      // Devuelta, deja de pedir atención; el motivo queda como rastro.
      const devuelta = await ordenAdmin(ordenId);
      expect(devuelta.estado).toBe('reembolsada');
      expect(devuelta.motivoSinVenta).toBe(ITEM_BORRADO);
      expect(await sinVentaEnElListado(ordenId)).toEqual([]);
    });
  });

  describe('lo que A no cubre: el stock se acaba mientras el comprador está en Webpay', () => {
    /**
     * Medido el 2026-10-11 (`docs/agent/pendientes.md` § 4). El precio quedó
     * congelado al pagar, pero el stock no: baja recién cuando el callback
     * crea la venta, y `pagar` no lo mira. Si el POS vende la última unidad
     * antes del retorno —o ya la había vendido antes del pago—, la venta se
     * rechaza y la orden queda pagada sin venta, con el aviso de D. Estos casos
     * fijan la conducta de HOY; qué hacer es una pregunta del owner.
     *
     * Una venta del local en el medio, y no una merma: es el caso real (el
     * mostrador vende lo último mientras el comprador está en Webpay).
     */
    let caja: CajaAbierta;

    beforeAll(async () => {
      caja = await abrirCaja(app, token, {
        comentario: 'Apertura E2E tienda dos ahoras',
      });
    });

    afterAll(async () => {
      await cerrarCaja(app, token, caja);
    });

    /** El mostrador vende una unidad, al precio que da el motor ahora. */
    const venderEnElLocal = async (itemId: string) => {
      const calculo = await request(app.getHttpServer())
        .post('/api/calculo-precios/calcular')
        .set('Authorization', `Bearer ${token}`)
        .send({ lineas: [{ itemId, cantidad: '1' }] });
      expect(calculo.status).toBe(201);
      const { totalFinal } = (
        calculo.body as { totales: { totalFinal: string } }
      ).totales;
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO, monto: totalFinal }],
        });
      expect(res.status).toBe(201);
      return (res.body as { id: string }).id;
    };

    /** Pagar, que el local venda lo último, y volver de Webpay. */
    const pagarYQueSeAgote = async (itemId: string) => {
      const ventasAntes = await ventasOnline();
      const { ordenId, autorizado } = await pagar(itemId);
      const ventaDelLocal = await venderEnElLocal(itemId);
      const location = await volver(ordenId);
      return { ordenId, autorizado, location, ventasAntes, ventaDelLocal };
    };

    const ingredienteConStock = (stock: string) =>
      crearItem('0', {
        nombre: `Insumo dos ahoras E2E ${randomUUID()}`,
        tipo: 'ingrediente',
        unidadMedida: 'unidad',
        stock,
        costo: '100',
      });

    it('producto por cantidad: la venta se rechaza y la orden queda pagada sin venta', async () => {
      const nombre = `Producto dos ahoras E2E ${randomUUID()}`;
      const itemId = await crearItem('1000', {
        nombre,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '1',
        costo: '500',
      });

      const { ordenId, location, ventasAntes } = await pagarYQueSeAgote(itemId);

      await afirmarCargoSinVenta(
        ordenId,
        location,
        ventasAntes,
        `Stock insuficiente de "${nombre}" en el local: quedan 0 unidad y lo que se está agregando necesita 1 unidad`,
      );
    });

    it('producto que ya estaba agotado al pagar: Webpay cobra igual, porque `pagar` no mira el stock', async () => {
      // El carrito vive en el navegador: el producto se agregó con stock y se
      // agotó antes de pagar. La grilla no deja agregar uno agotado, pero
      // nadie lo vuelve a mirar al cobrar.
      const nombre = `Producto agotado dos ahoras E2E ${randomUUID()}`;
      const itemId = await crearItem('1000', {
        nombre,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '1',
        costo: '500',
      });
      await venderEnElLocal(itemId);
      const ventasAntes = await ventasOnline();

      const { ordenId } = await pagar(itemId);
      const location = await volver(ordenId);

      await afirmarCargoSinVenta(
        ordenId,
        location,
        ventasAntes,
        `Stock insuficiente de "${nombre}" en el local: quedan 0 unidad y lo que se está agregando necesita 1 unidad`,
      );
    });

    it('producto por lote: lo mismo, con el mensaje de lotes', async () => {
      const itemId = await crearItem('1000', {
        nombre: `Lote dos ahoras E2E ${randomUUID()}`,
        tipo: 'producto',
        modoInventario: 'lote',
      });
      const entrada = await request(app.getHttpServer())
        .patch(`/api/items/${itemId}/stock`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          tipo: 'entrada',
          motivo: 'compra',
          ubicacionId: await localDelTenant(),
          cantidad: '1',
          lote: {
            codigoLote: `DOS-AHORAS-${randomUUID()}`,
            fechaVencimiento: '2099-06-01',
          },
        });
      expect(entrada.status).toBe(200);

      const { ordenId, location, ventasAntes } = await pagarYQueSeAgote(itemId);

      await afirmarCargoSinVenta(
        ordenId,
        location,
        ventasAntes,
        'Stock insuficiente en lotes en esta ubicación (disponible: 0, requerido: 1)',
      );
    });

    it('receta con un insumo bloqueante que se acaba: pagada sin venta, y el motivo no nombra el insumo', async () => {
      const insumoId = await ingredienteConStock('1');
      const recetaId = await crearItem('3000', {
        nombre: `Receta bloqueante dos ahoras E2E ${randomUUID()}`,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: insumoId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
        ],
      });

      const { ordenId, location, ventasAntes } =
        await pagarYQueSeAgote(recetaId);

      await afirmarCargoSinVenta(
        ordenId,
        location,
        ventasAntes,
        'Stock insuficiente para la salida',
      );
      // Antes que el insumo: la receta viva lo tiene en uso.
      await borrarItem(recetaId);
    });

    it('receta con un insumo NO bloqueante que se acaba: la venta se crea igual, sin descontar el insumo', async () => {
      const insumoId = await ingredienteConStock('1');
      const recetaId = await crearItem('3000', {
        nombre: `Receta no bloqueante dos ahoras E2E ${randomUUID()}`,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: insumoId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: false,
          },
        ],
      });

      const { ordenId, autorizado, location, ventasAntes, ventaDelLocal } =
        await pagarYQueSeAgote(recetaId);

      const ventaId = await afirmarVentaPorLoCobrado(
        ordenId,
        location,
        ventasAntes,
        autorizado,
      );
      // La que vendió el local se llevó el insumo; la de la tienda salió sin él.
      const movimientosDe = async (id: string): Promise<number> => {
        const [fila]: { n: string }[] = await ds.query(
          `SELECT count(*) AS n FROM movimientos_inventario
            WHERE venta_id = $1 AND item_id = $2 AND eliminado_el IS NULL`,
          [id, insumoId],
        );
        return Number(fila.n);
      };
      expect(await movimientosDe(ventaDelLocal)).toBe(1);
      expect(await movimientosDe(ventaId)).toBe(0);
      await borrarItem(recetaId);
    });
  });

  describe('lo que se ataja antes de cobrar', () => {
    /**
     * Un ingrediente no se vende directo (`VentasService`), pero el checkout
     * no lo miraba: con otra línea que le diera monto, Webpay cobraba y el
     * callback rechazaba la venta. Medido el 2026-10-11: la orden quedaba
     * pagada sin venta con *"Los ingredientes no se pueden vender
     * directamente"*. Solo, un ingrediente no llegaba a cobrarse porque su
     * precio es siempre 0; por eso el carrito lleva un servicio al lado.
     */
    it.each(['checkout', 'pagar'])(
      'POST /online/%s con un ingrediente en el carrito: 400 nombrándolo, sin orden ni cobro',
      async (ruta) => {
        const nombre = `Insumo dos ahoras E2E ${randomUUID()}`;
        const ingredienteId = await crearItem('0', {
          nombre,
          tipo: 'ingrediente',
          unidadMedida: 'unidad',
        });
        const servicioId = await crearItem('1000');
        const ordenesAntes = await ordenesDelTenant();
        const autorizadosAntes = autorizados.length;

        const res = await request(app.getHttpServer())
          .post(`/api/online/${ruta}`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            lineas: [
              { itemId: servicioId, cantidad: '1' },
              { itemId: ingredienteId, cantidad: '1' },
            ],
          });

        expect(res.status).toBe(400);
        expect((res.body as { message: string }).message).toBe(
          `«${nombre}» es un ingrediente: no se vende directamente`,
        );
        expect(await ordenesDelTenant()).toBe(ordenesAntes);
        expect(autorizados).toHaveLength(autorizadosAntes);
      },
    );
  });

  describe('el aviso al admin, con un rol que no es admin', () => {
    /**
     * Un usuario propio con un rol propio que tiene EXACTAMENTE estos permisos
     * de Pasarelas: el admin del seed tiene todo y tapa el 403. En el seed
     * ningún otro rol tiene `Pasarelas:Leer`.
     */
    const usuarioConPasarelas = async (acciones: string[]): Promise<string> => {
      const modulos = await request(app.getHttpServer())
        .get('/api/roles/modulos-disponibles')
        .set('Authorization', `Bearer ${token}`);
      expect(modulos.status).toBe(200);
      const rol = await request(app.getHttpServer())
        .post('/api/roles')
        .set('Authorization', `Bearer ${token}`)
        .send({ nombre: `E2E pagada sin venta ${randomUUID()}` });
      expect(rol.status).toBe(201);
      const rolId = (rol.body as { id: string }).id;
      const m = (modulos.body as ModuloDisponible[]).find(
        (x) => x.nombre === 'Pasarelas',
      );
      expect(m).toBeTruthy();
      const ids = acciones.map((a) => {
        const p = m!.permisos.find((x) => x.permisoNombre === a);
        expect(p).toBeTruthy();
        return p!.moduloAppPermisoId;
      });
      const set = await request(app.getHttpServer())
        .put(`/api/roles/${rolId}/modules/${m!.moduloTenantId}/permissions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ moduloAppPermisoIds: ids });
      expect(set.status).toBe(200);
      const correo = `pagada-sin-venta.${randomUUID()}@e2e.cl`;
      const alta = await request(app.getHttpServer())
        .post('/api/tenants/usuarios')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: 'Pagada',
          apellido: 'SinVenta',
          correo,
          rolIds: [rolId],
        });
      expect(alta.status).toBe(201);
      const usuarioId = (alta.body as { usuarioId: string }).usuarioId;
      const invitacion = await app
        .get(TokensAccesoService)
        .emitir(usuarioId, TipoTokenAcceso.INVITACION);
      const password = 'clave-e2e-pagada-sin-venta-1234';
      const elegir = await request(app.getHttpServer())
        .post(`/api/auth/invitacion/${invitacion}`)
        .send({ contrasena: password });
      expect(elegir.status).toBe(200);
      return login({ email: correo, password });
    };

    it('Pasarelas:Leer encuentra la orden y su motivo; sin ese permiso, 403', async () => {
      const itemId = await crearItem('10000');
      const ventasAntes = await ventasOnline();
      const { ordenId } = await pagar(itemId);
      await borrarItem(itemId);
      const location = await volver(ordenId);
      await afirmarCargoSinVenta(ordenId, location, ventasAntes, ITEM_BORRADO);

      const lector = await usuarioConPasarelas(['Leer']);
      expect(await sinVentaEnElListado(ordenId, lector)).toEqual([
        expect.objectContaining({ ordenId, motivoSinVenta: ITEM_BORRADO }),
      ]);
      expect((await ordenAdmin(ordenId, lector)).motivoSinVenta).toBe(
        ITEM_BORRADO,
      );

      const sinLeer = await usuarioConPasarelas(['Crear']);
      const prohibido = await request(app.getHttpServer())
        .get('/api/pasarela/admin/ordenes?sinVenta=true&pageSize=1')
        .set('Authorization', `Bearer ${sinLeer}`);
      expect(prohibido.status).toBe(403);
    });
  });
});
