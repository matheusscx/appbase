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

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris: Webpay Plus activo (seed)
const CLP = '550e8400-e29b-41d4-a716-446655440003';
const USD = '550e8400-e29b-41d4-a716-446655440005';
const TIPO_DESCUENTO_DIRECTO = '550e8400-e29b-41d4-a716-446655440337';
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };

const PAGO_INCOMPLETO = 'Las ventas online requieren el pago completo';
const SIN_VUELTO =
  'Las ventas online no admiten vuelto: lo pagado supera el total';

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
 * La tienda calcula el total dos veces, con dos "ahora"
 * (`docs/agent/pendientes.md` § 3, medido el 2026-10-09).
 *
 * `POST /online/pagar` calcula y autoriza en Webpay ese total. Cuando el
 * comprador vuelve, `OnlineCallbackHandler` crea la venta con
 * `VentasService.crear`, que **recalcula** desde el snapshot (ítem y cantidad)
 * con el catálogo y el reloj del retorno. Si algo que mueve el total cambió en
 * el medio —la hora cruza el borde de una promo o de una regla, el precio, la
 * tasa del día—, la venta se rechaza.
 *
 * Que la venta se rechace sigue pasando: lo cierra la opción A ("vale lo que
 * pagó"), que es frente fiscal propio. Lo que fijan estos casos es lo que
 * construyeron D y E (owner, 2026-10-09):
 * - D: la orden pagada sin venta no miente. El comprador ve que el pago llegó y
 *   la compra no quedó registrada, y el admin la encuentra con su motivo.
 * - E: la venta online no lleva vuelto. Lo pagado de más también es una orden
 *   pagada sin venta.
 * Ningún caso crea la venta "después": no hay reintento automático.
 *
 * El camino es el de `tienda-impuestos-del-item.e2e-spec.ts`: proveedor falso,
 * `pagar`, el retorno de Webpay por HTTP y el callback en proceso.
 */
describe('Tienda: lo que cambia entre el pago y el retorno deja una orden pagada sin venta, que avisa (e2e)', () => {
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
    for (const id of itemsCreados) {
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
    expect(erroresDeLaOrden(ordenId)).toEqual([]);
    // Sin aviso: la orden conciliada no aparece entre las pagadas sin venta.
    expect((await ordenAdmin(ordenId)).motivoSinVenta).toBeNull();
    expect(await sinVentaEnElListado(ordenId)).toEqual([]);
  });

  describe('el reloj: los dos "ahora" (sin tocar el catálogo)', () => {
    it('happy hour 18:00–19:59: se paga a las 19:59:30 con la promo y se vuelve a las 20:00:30 sin ella', async () => {
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
      reglasCreadas.push({
        ruta: 'promociones',
        id: (promo.body as { id: string }).id,
      });
      const ventasAntes = await ventasOnline();

      await conReloj(instanteLocal(hoy, '19:59:30'), async () => {
        const { ordenId, autorizado } = await pagar(itemId);

        jest.setSystemTime(instanteLocal(hoy, '20:00:30'));
        // Lo que el callback va a recalcular: el precio lleno, sin el 20%.
        const enElRetorno = await totalAhora(itemId);
        expect(Number(autorizado)).toBeLessThan(Number(enElRetorno));

        const location = await volver(ordenId);
        await afirmarCargoSinVenta(
          ordenId,
          location,
          ventasAntes,
          PAGO_INCOMPLETO,
        );
      });
    });

    it('descuento con fechaFin hoy: se paga a las 23:59:30 con el descuento y se vuelve al día siguiente sin él', async () => {
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
        await afirmarCargoSinVenta(
          ordenId,
          location,
          ventasAntes,
          PAGO_INCOMPLETO,
        );
      });
    });
  });

  describe('el catálogo cambia mientras el comprador está en Webpay', () => {
    it('el precio sube: el callback pide más de lo cobrado', async () => {
      const itemId = await crearItem('10000');
      const ventasAntes = await ventasOnline();

      const { ordenId, autorizado } = await pagar(itemId);
      await cambiarPrecio(itemId, '12000');
      expect(Number(await totalAhora(itemId))).toBeGreaterThan(
        Number(autorizado),
      );

      const location = await volver(ordenId);
      await afirmarCargoSinVenta(
        ordenId,
        location,
        ventasAntes,
        PAGO_INCOMPLETO,
      );

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
      expect(devuelta.motivoSinVenta).toBe(PAGO_INCOMPLETO);
      expect(await sinVentaEnElListado(ordenId)).toEqual([]);
    });

    it('el precio baja: lo cobrado sobra y la tarjeta no da vuelto', async () => {
      const itemId = await crearItem('10000');
      const ventasAntes = await ventasOnline();

      const { ordenId, autorizado } = await pagar(itemId);
      await cambiarPrecio(itemId, '8000');
      expect(Number(await totalAhora(itemId))).toBeLessThan(Number(autorizado));

      const location = await volver(ordenId);
      await afirmarCargoSinVenta(ordenId, location, ventasAntes, SIN_VUELTO);
    });

    it('el precio baja con permite_vuelto en la tarjeta: tampoco hay vuelto sobre la tarjeta (E)', async () => {
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
        // tarjeta, que nadie devolvía. Ahora es un cargo sin venta, igual que
        // con la tarjeta del seed, y la plata se devuelve con el reembolso.
        const location = await volver(ordenId);
        await afirmarCargoSinVenta(ordenId, location, ventasAntes, SIN_VUELTO);
      } finally {
        expect((await ponerVuelto(false)).status).toBe(200);
      }
    });

    it('la tasa del día de USD sube: un ítem en dólares vale más en el retorno', async () => {
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
        await afirmarCargoSinVenta(
          ordenId,
          location,
          ventasAntes,
          PAGO_INCOMPLETO,
        );
      } finally {
        expect((await ponerTasa(tasaOriginal)).status).toBe(200);
      }
    });
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
      await cambiarPrecio(itemId, '12000');
      const location = await volver(ordenId);
      await afirmarCargoSinVenta(
        ordenId,
        location,
        ventasAntes,
        PAGO_INCOMPLETO,
      );

      const lector = await usuarioConPasarelas(['Leer']);
      expect(await sinVentaEnElListado(ordenId, lector)).toEqual([
        expect.objectContaining({ ordenId, motivoSinVenta: PAGO_INCOMPLETO }),
      ]);
      expect((await ordenAdmin(ordenId, lector)).motivoSinVenta).toBe(
        PAGO_INCOMPLETO,
      );

      const sinLeer = await usuarioConPasarelas(['Crear']);
      const prohibido = await request(app.getHttpServer())
        .get('/api/pasarela/admin/ordenes?sinVenta=true&pageSize=1')
        .set('Authorization', `Bearer ${sinLeer}`);
      expect(prohibido.status).toBe(403);
    });
  });
});
