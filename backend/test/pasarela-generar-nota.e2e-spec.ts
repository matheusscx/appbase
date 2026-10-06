import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { ProviderFactory } from '../src/modules/pasarela/providers/provider.factory';
import { VentasReembolsoHandler } from '../src/modules/ventas/reembolso-callback.handler';
import { PasarelaOrden } from '../src/modules/pasarela/entities/pasarela-orden.entity';
import { PasarelaTransaccion } from '../src/modules/pasarela/entities/pasarela-transaccion.entity';
import { TokensAccesoService } from '../src/modules/auth/tokens-acceso.service';
import { TipoTokenAcceso } from '../src/modules/auth/entities/token-acceso.entity';
import { correrCarrera } from './helpers/carrera';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris (Chile)
const CLP = '550e8400-e29b-41d4-a716-446655440003';
const DEBITO_ID = '550e8400-e29b-41d4-a716-446655440106';
const CREDITO_ID = '550e8400-e29b-41d4-a716-446655440107';
const TP_PARIS_WEBPAY_ID = '550e8400-e29b-41d4-a716-446655440217';
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };

interface Venta {
  id: string;
}
interface ModuloDisponible {
  moduloTenantId: string;
  nombre: string;
  permisos: { moduloAppPermisoId: string; permisoNombre: string }[];
}
interface RespuestaNota {
  notaCreditoId?: string;
  repetida?: boolean;
  reembolso?: { transaccionId: string; estado: string };
  message?: string;
  ventaId?: string;
}
type Linea = { itemId: string; cantidad: string; stock?: string };

/**
 * "Generar nota" (`pendientes.md` § 3, spec
 * `2026-10-04-generar-nota-de-refund-sin-nota`): un REFUND aprobado cuya nota
 * falló —la plata ya volvió por Webpay, la boleta quedó sin corregir— la
 * genera desde el drawer de la orden, por su monto, sin volver a llamar al
 * proveedor, una vez por intento.
 *
 * El REFUND sin nota se arma como en producción: un reembolso real por la API
 * con el hook de ventas fallando una vez (`onReembolsoAprobado`). El proveedor
 * es un doble que cuenta sus llamadas: "Generar nota" no lo toca nunca.
 *
 * ⚠️ Ítems propios (el stock sembrado lo comparten todas las suites). Montos que
 * no son 1 ni factores iguales: 70.000 sobre 100.000, 5.000 sobre 10.000.
 */
describe('"Generar nota" de un REFUND aprobado que quedó sin nota (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let adminId: string;
  let itemAfecto60: string;
  let itemExento: string;
  let itemProducto: string;
  const reembolsarEnElProveedor = jest.fn();
  const consultarEnElProveedor = jest.fn();

  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

  async function loginEnParis(email: string, password: string) {
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password });
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
  }

  /**
   * Un usuario propio con un rol propio que tiene EXACTAMENTE estos permisos de
   * Pasarelas: nunca el admin del seed, que tiene todo y tapa el 403.
   */
  async function usuarioConPasarelas(
    acciones: string[],
  ): Promise<{ token: string; usuarioId: string }> {
    const modulos = await request(app.getHttpServer())
      .get('/api/roles/modulos-disponibles')
      .set(auth());
    expect(modulos.status).toBe(200);
    const rol = await request(app.getHttpServer())
      .post('/api/roles')
      .set(auth())
      .send({ nombre: `E2E generar nota ${randomUUID()}` });
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
      .set(auth())
      .send({ moduloAppPermisoIds: ids });
    expect(set.status).toBe(200);
    const correo = `generar-nota.${randomUUID()}@e2e.cl`;
    const alta = await request(app.getHttpServer())
      .post('/api/tenants/usuarios')
      .set(auth())
      .send({ nombre: 'Generar', apellido: 'Nota', correo, rolIds: [rolId] });
    expect(alta.status).toBe(201);
    const usuarioId = (alta.body as { usuarioId: string }).usuarioId;
    const invitacion = await app
      .get(TokensAccesoService)
      .emitir(usuarioId, TipoTokenAcceso.INVITACION);
    const contrasena = 'clave-e2e-generar-nota-1234';
    const elegir = await request(app.getHttpServer())
      .post(`/api/auth/invitacion/${invitacion}`)
      .send({ contrasena });
    expect(elegir.status).toBe(200);
    return { token: await loginEnParis(correo, contrasena), usuarioId };
  }

  const crearServicio = async (
    nombre: string,
    precioBase: string,
    clasificacionTributaria: 'afecto' | 'exento',
  ): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set(auth())
      .send({
        nombre: `${nombre} ${Date.now()}`,
        precioBase,
        monedaId: CLP,
        tipo: 'servicio',
        clasificacionTributaria,
      });
    expect(res.status).toBe(201);
    return (res.body as { id: string }).id;
  };
  const vender = async (body: Record<string, unknown>): Promise<Venta> => {
    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Idempotency-Key', randomUUID())
      .set(auth())
      .send({ canal: 'online', ...body });
    expect(res.status).toBe(201);
    return res.body as Venta;
  };
  /** $100.000: un servicio afecto (71.400 con IVA) y uno exento (28.600). */
  const ventaDeServicios = (pagos: { metodoPagoId: string; monto: string }[]) =>
    vender({
      lineas: [
        { itemId: itemAfecto60, cantidad: '1' },
        { itemId: itemExento, cantidad: '1' },
      ],
      pagos,
    });
  /** 2 unidades de un producto propio ($5.000 c/u, IVA incluido) con débito. */
  const ventaDeProducto = () =>
    vender({
      lineas: [{ itemId: itemProducto, cantidad: '2' }],
      pagos: [{ metodoPagoId: DEBITO_ID, monto: '10000' }],
    });
  const ordenCobrada = async (ventaId: string, monto: string) => {
    const codigoOrden = `E2E-GN-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const orden = await ds.getRepository(PasarelaOrden).save({
      tenantId: TENANT_ID,
      codigoOrden,
      descripcion: 'Orden de generar nota e2e',
      monto,
      moneda: 'CLP',
      estado: 'conciliada',
      origen: 'interno',
      ventaId,
    });
    await ds.getRepository(PasarelaTransaccion).save({
      tenantId: TENANT_ID,
      ordenId: orden.ordenId,
      tenantPasarelaId: TP_PARIS_WEBPAY_ID,
      tipo: 'AUTHORIZATION',
      estado: 'aprobada',
      monto,
      moneda: 'CLP',
      codigoOrden,
      fechaTransaccion: new Date(),
    });
    return orden.ordenId;
  };
  /**
   * Un reembolso de verdad cuya nota falla: el estado que este frente repara.
   * Devuelve la orden y el REFUND aprobado, sin `correccion_venta_id`.
   */
  const refundSinNota = async (
    ventaId: string,
    montoOrden: string,
    body: { monto: string; devoluciones?: Linea[] },
  ): Promise<{ ordenId: string; transaccionId: string }> => {
    const ordenId = await ordenCobrada(ventaId, montoOrden);
    const hook = jest
      .spyOn(app.get(VentasReembolsoHandler), 'onReembolsoAprobado')
      .mockRejectedValueOnce(new Error('la nota no salió'));
    let res;
    try {
      res = await request(app.getHttpServer())
        .post(`/api/pasarela/admin/ordenes/${ordenId}/reembolsos`)
        .set(auth())
        .set('Idempotency-Key', randomUUID())
        .send(body);
    } finally {
      hook.mockRestore();
    }
    expect(res.status).toBe(201);
    expect((res.body as { warning?: string }).warning).toBeDefined();
    const refunds = await refundsDe(ordenId);
    expect(refunds).toEqual([
      expect.objectContaining({
        estado: 'aprobada',
        correccion_venta_id: null,
      }),
    ]);
    return { ordenId, transaccionId: refunds[0].transaccion_id };
  };
  const generarNota = (
    ordenId: string,
    transaccionId: string,
    body: { devoluciones?: Linea[] },
    { clave = randomUUID(), t = token }: { clave?: string; t?: string } = {},
  ) =>
    request(app.getHttpServer())
      .post(
        `/api/pasarela/admin/ordenes/${ordenId}/reembolsos/${transaccionId}/nota`,
      )
      .set(auth(t))
      .set('Idempotency-Key', clave)
      .send(body);
  const refundsDe = (
    ordenId: string,
  ): Promise<
    {
      transaccion_id: string;
      estado: string;
      correccion_venta_id: string | null;
    }[]
  > =>
    ds.query(
      `SELECT transaccion_id, estado, correccion_venta_id
         FROM pasarela_transacciones
        WHERE orden_id = $1 AND tipo = 'REFUND' AND eliminado_el IS NULL
        ORDER BY fecha_transaccion`,
      [ordenId],
    );
  const correccionesDe = (
    ventaId: string,
  ): Promise<{ venta_id: string; total_final: string; via: string }[]> =>
    ds.query(
      `SELECT venta_id, total_final::text AS total_final, devolucion_via AS via
         FROM ventas
        WHERE venta_referencia_id = $1 AND eliminado_el IS NULL`,
      [ventaId],
    );
  const vueltasAlStock = (
    correccionId: string,
  ): Promise<
    {
      motivo: string;
      tipo: string;
      cantidad: string;
      usuario_id: string | null;
    }[]
  > =>
    ds.query(
      `SELECT motivo, tipo, cantidad::float::text AS cantidad, usuario_id
         FROM movimientos_inventario
        WHERE venta_id = $1 AND eliminado_el IS NULL
        ORDER BY tipo`,
      [correccionId],
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ProviderFactory)
      .useValue({
        getReembolsable: () => ({
          reembolsar: reembolsarEnElProveedor,
          consultarEstado: consultarEnElProveedor,
        }),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

    token = await loginEnParis(ADMIN.email, ADMIN.password);
    const [admin]: { usuario_id: string }[] = await ds.query(
      `SELECT usuario_id FROM usuarios WHERE correo = $1 AND eliminado_el IS NULL`,
      [ADMIN.email],
    );
    adminId = admin.usuario_id;

    itemAfecto60 = await crearServicio('GN afecto 60k E2E', '60000', 'afecto');
    itemExento = await crearServicio('GN exento E2E', '28600', 'exento');
    const resProducto = await request(app.getHttpServer())
      .post('/api/items')
      .set(auth())
      .send({
        nombre: `GN producto E2E ${Date.now()}`,
        tipo: 'producto',
        precioBase: '5000',
        precioIncluyeImpuesto: true,
        monedaId: CLP,
        unidadMedida: 'unidad',
        stock: '100',
        costo: '1000',
      });
    expect(resProducto.status).toBe(201);
    itemProducto = (resProducto.body as { id: string }).id;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    consultarEnElProveedor.mockReset();
    reembolsarEnElProveedor.mockReset();
    reembolsarEnElProveedor.mockResolvedValue({
      aprobada: true,
      codigoRespuesta: '0',
      codigoAutorizacion: 'AUT-E2E',
      tipoPago: 'VD',
      request: {},
      response: {},
    });
  });

  it('la orden marca el REFUND sin nota y trae lo que pidió; "Generar nota" la emite por su monto, liga el REFUND y NO llama al proveedor', async () => {
    const venta = await ventaDeServicios([
      { metodoPagoId: DEBITO_ID, monto: '100000' },
    ]);
    const { ordenId, transaccionId } = await refundSinNota(venta.id, '100000', {
      monto: '70000',
    });
    expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(1);

    const orden = await request(app.getHttpServer())
      .get(`/api/pasarela/admin/ordenes/${ordenId}`)
      .set(auth());
    expect(orden.status).toBe(200);
    const fila = (
      orden.body as {
        transacciones: {
          transaccionId: string;
          correccionVentaId: string | null;
          devoluciones: unknown;
        }[];
      }
    ).transacciones.find((t) => t.transaccionId === transaccionId);
    expect(fila).toMatchObject({ correccionVentaId: null, devoluciones: [] });

    const res = await generarNota(ordenId, transaccionId, { devoluciones: [] });

    expect(res.status).toBe(201);
    const cuerpo = res.body as RespuestaNota;
    expect(cuerpo.notaCreditoId).toEqual(expect.any(String));
    expect(cuerpo.repetida).toBeUndefined();
    expect(await correccionesDe(venta.id)).toEqual([
      {
        venta_id: cuerpo.notaCreditoId,
        total_final: '70000.0000',
        via: 'pasarela',
      },
    ]);
    expect(await refundsDe(ordenId)).toEqual([
      {
        transaccion_id: transaccionId,
        estado: 'aprobada',
        correccion_venta_id: cuerpo.notaCreditoId,
      },
    ]);
    // La plata salió una sola vez: el botón no toca al proveedor.
    expect(reembolsarEnElProveedor).toHaveBeenCalledTimes(1);
    expect(consultarEnElProveedor).not.toHaveBeenCalled();

    const despues = await request(app.getHttpServer())
      .get(`/api/pasarela/admin/ordenes/${ordenId}`)
      .set(auth());
    expect(despues.status).toBe(200);
    expect(
      (
        despues.body as {
          transacciones: {
            transaccionId: string;
            correccionVentaId: string | null;
          }[];
        }
      ).transacciones.find((t) => t.transaccionId === transaccionId)
        ?.correccionVentaId,
    ).toBe(cuerpo.notaCreditoId);
  });

  it('con lo que declaró el reembolso: la línea con stock vuelve como lo pidió y el movimiento es de quien PIDIÓ el reembolso', async () => {
    const venta = await ventaDeProducto();
    const pedido = [{ itemId: itemProducto, cantidad: '1', stock: 'pierde' }];
    const { ordenId, transaccionId } = await refundSinNota(venta.id, '10000', {
      monto: '5000',
      devoluciones: pedido,
    });
    const orden = await request(app.getHttpServer())
      .get(`/api/pasarela/admin/ordenes/${ordenId}`)
      .set(auth());
    expect(orden.status).toBe(200);
    expect(
      (
        orden.body as {
          transacciones: { transaccionId: string; devoluciones: unknown }[];
        }
      ).transacciones.find((t) => t.transaccionId === transaccionId)
        ?.devoluciones,
    ).toEqual(pedido);

    // Lo confirma OTRO usuario, con el mismo pedido en otro formato.
    const otro = await usuarioConPasarelas(['Leer', 'Reembolsar']);
    const res = await generarNota(
      ordenId,
      transaccionId,
      { devoluciones: [{ ...pedido[0], cantidad: '1.00' }] },
      { t: otro.token },
    );

    expect(res.status).toBe(201);
    const nota = (res.body as RespuestaNota).notaCreditoId!;
    // "Se pierde": entra y sale como merma, las dos a nombre de quien pidió.
    expect(await vueltasAlStock(nota)).toEqual([
      {
        motivo: 'devolucion',
        tipo: 'entrada',
        cantidad: '1',
        usuario_id: adminId,
      },
      { motivo: 'merma', tipo: 'salida', cantidad: '1', usuario_id: adminId },
    ]);
  });

  it('si el admin cambió la declaración, el movimiento es de quien hizo clic', async () => {
    const venta = await ventaDeProducto();
    const { ordenId, transaccionId } = await refundSinNota(venta.id, '10000', {
      monto: '5000',
      devoluciones: [{ itemId: itemProducto, cantidad: '1', stock: 'pierde' }],
    });
    const otro = await usuarioConPasarelas(['Leer', 'Reembolsar']);

    const res = await generarNota(
      ordenId,
      transaccionId,
      {
        devoluciones: [
          { itemId: itemProducto, cantidad: '1', stock: 'recupera' },
        ],
      },
      { t: otro.token },
    );

    expect(res.status).toBe(201);
    expect(
      await vueltasAlStock((res.body as RespuestaNota).notaCreditoId!),
    ).toEqual([
      {
        motivo: 'devolucion',
        tipo: 'entrada',
        cantidad: '1',
        usuario_id: otro.usuarioId,
      },
    ]);
  });

  describe('dos clics no emiten dos notas', () => {
    it('misma clave y mismo pedido (el corte): reproduce la nota que entró, con "repetida", y queda una', async () => {
      const venta = await ventaDeServicios([
        { metodoPagoId: DEBITO_ID, monto: '100000' },
      ]);
      const { ordenId, transaccionId } = await refundSinNota(
        venta.id,
        '100000',
        { monto: '70000' },
      );
      const clave = randomUUID();

      const a = await generarNota(
        ordenId,
        transaccionId,
        { devoluciones: [] },
        { clave },
      );
      const b = await generarNota(
        ordenId,
        transaccionId,
        { devoluciones: [] },
        { clave },
      );

      expect([a.status, b.status]).toEqual([201, 201]);
      expect((b.body as RespuestaNota).repetida).toBe(true);
      expect((b.body as RespuestaNota).notaCreditoId).toBe(
        (a.body as RespuestaNota).notaCreditoId,
      );
      expect(await correccionesDe(venta.id)).toHaveLength(1);
    });

    it('misma clave y otro pedido: 422 con la nota que entró, y sigue habiendo una', async () => {
      const venta = await ventaDeProducto();
      const { ordenId, transaccionId } = await refundSinNota(
        venta.id,
        '10000',
        { monto: '5000' },
      );
      const clave = randomUUID();

      const a = await generarNota(
        ordenId,
        transaccionId,
        { devoluciones: [] },
        { clave },
      );
      const b = await generarNota(
        ordenId,
        transaccionId,
        {
          devoluciones: [
            { itemId: itemProducto, cantidad: '1', stock: 'recupera' },
          ],
        },
        { clave },
      );

      expect(a.status).toBe(201);
      expect(b.status).toBe(422);
      expect(b.body).toMatchObject({
        message: expect.stringMatching(
          /ya se había generado con otros datos/,
        ) as unknown,
        ventaId: (a.body as RespuestaNota).notaCreditoId,
      });
      expect(await correccionesDe(venta.id)).toHaveLength(1);
    });

    it('otra clave con el REFUND ya ligado (otra pestaña, otro admin): 409 con la nota que tiene, no un éxito', async () => {
      const venta = await ventaDeServicios([
        { metodoPagoId: DEBITO_ID, monto: '100000' },
      ]);
      const { ordenId, transaccionId } = await refundSinNota(
        venta.id,
        '100000',
        { monto: '70000' },
      );

      const a = await generarNota(ordenId, transaccionId, { devoluciones: [] });
      const b = await generarNota(ordenId, transaccionId, { devoluciones: [] });

      expect(a.status).toBe(201);
      expect(b.status).toBe(409);
      expect(b.body).toMatchObject({
        message: 'Este reembolso ya tiene su nota de crédito.',
        notaCreditoId: (a.body as RespuestaNota).notaCreditoId,
      });
      expect(await correccionesDe(venta.id)).toHaveLength(1);
    });

    it('dos clics a la vez con claves distintas: uno emite, el otro espera el lock de la venta y da 409', async () => {
      const venta = await ventaDeServicios([
        { metodoPagoId: DEBITO_ID, monto: '100000' },
      ]);
      const { ordenId, transaccionId } = await refundSinNota(
        venta.id,
        '100000',
        { monto: '70000' },
      );

      const { esperando, respuestas } = await correrCarrera(
        ds,
        [`SELECT 1 FROM ventas WHERE venta_id = $1 FOR UPDATE`, [venta.id]],
        [
          // `.then`: supertest no manda el pedido hasta que alguien lo espera.
          () =>
            generarNota(ordenId, transaccionId, { devoluciones: [] }).then(
              (r) => r,
            ),
          () =>
            generarNota(ordenId, transaccionId, { devoluciones: [] }).then(
              (r) => r,
            ),
        ],
      );

      expect(esperando).toBe(2);
      expect(respuestas.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await correccionesDe(venta.id)).toHaveLength(1);
      expect((await refundsDe(ordenId))[0].correccion_venta_id).toEqual(
        expect.any(String),
      );
    });
  });

  it('una línea con stock sin "¿se recupera o se pierde?": 400 con la regla de la nota manual, nada escrito, y el mismo intento corregido entra con la misma clave', async () => {
    const venta = await ventaDeProducto();
    const { ordenId, transaccionId } = await refundSinNota(venta.id, '10000', {
      monto: '5000',
    });
    const clave = randomUUID();

    const sinRespuesta = await generarNota(
      ordenId,
      transaccionId,
      { devoluciones: [{ itemId: itemProducto, cantidad: '1' }] },
      { clave },
    );

    expect(sinRespuesta.status).toBe(400);
    expect(JSON.stringify(sinRespuesta.body)).toMatch(/Falta decir si/);
    expect(await correccionesDe(venta.id)).toEqual([]);
    expect((await refundsDe(ordenId))[0].correccion_venta_id).toBeNull();

    const corregido = await generarNota(
      ordenId,
      transaccionId,
      {
        devoluciones: [
          { itemId: itemProducto, cantidad: '1', stock: 'recupera' },
        ],
      },
      { clave },
    );
    expect(corregido.status).toBe(201);
    expect((corregido.body as RespuestaNota).repetida).toBeUndefined();
  });

  it('las líneas se revalidan contra lo que pasó DESPUÉS del reembolso: lo que otra nota ya devolvió no se acredita dos veces', async () => {
    const venta = await ventaDeProducto();
    const { ordenId, transaccionId } = await refundSinNota(venta.id, '10000', {
      monto: '5000',
      devoluciones: [
        { itemId: itemProducto, cantidad: '2', stock: 'recupera' },
      ],
    });
    // Entre el REFUND y el clic, otro reembolso de otra orden devolvió una de las dos.
    const otraOrden = await ordenCobrada(venta.id, '10000');
    const otro = await request(app.getHttpServer())
      .post(`/api/pasarela/admin/ordenes/${otraOrden}/reembolsos`)
      .set(auth())
      .set('Idempotency-Key', randomUUID())
      .send({
        monto: '1000',
        devoluciones: [
          { itemId: itemProducto, cantidad: '1', stock: 'recupera' },
        ],
      });
    expect(otro.status).toBe(201);
    expect((otro.body as { notaCreditoId?: string }).notaCreditoId).toEqual(
      expect.any(String),
    );

    const res = await generarNota(ordenId, transaccionId, {
      devoluciones: [
        { itemId: itemProducto, cantidad: '2', stock: 'recupera' },
      ],
    });

    expect(res.status).toBe(400);
    expect((await refundsDe(ordenId))[0].correccion_venta_id).toBeNull();
    // Editada a lo que queda, sale.
    const editada = await generarNota(ordenId, transaccionId, {
      devoluciones: [
        { itemId: itemProducto, cantidad: '1', stock: 'recupera' },
      ],
    });
    expect(editada.status).toBe(201);
  });

  it('con la venta ya corregida entera por otras notas: 400 que nombra la causa, sin cifras, y el REFUND sigue marcado', async () => {
    // Dos pagos: el REFUND no gasta el tope de ninguno, y las notas del POS por
    // cada pago se comen la venta entera.
    const venta = await ventaDeServicios([
      { metodoPagoId: DEBITO_ID, monto: '40000' },
      { metodoPagoId: CREDITO_ID, monto: '60000' },
    ]);
    const { ordenId, transaccionId } = await refundSinNota(venta.id, '100000', {
      monto: '70000',
    });
    const pagos: { pago_id: string; monto: string }[] = await ds.query(
      `SELECT pago_id, monto::text AS monto FROM pagos
        WHERE venta_id = $1 AND eliminado_el IS NULL ORDER BY monto`,
      [venta.id],
    );
    for (const p of pagos) {
      const nc = await request(app.getHttpServer())
        .post(`/api/ventas/${venta.id}/notas-credito`)
        .set('Idempotency-Key', randomUUID())
        .set(auth())
        .send({
          monto: p.monto,
          devolucion: { pagoId: p.pago_id },
          comentario: 'por el POS',
        });
      expect(nc.status).toBe(201);
    }

    const res = await generarNota(ordenId, transaccionId, { devoluciones: [] });

    expect(res.status).toBe(400);
    expect((res.body as RespuestaNota).message).toBe(
      'La venta ya está corregida entera por sus notas de crédito: no queda nada que acreditar.',
    );
    expect((await refundsDe(ordenId))[0].correccion_venta_id).toBeNull();
    expect(await correccionesDe(venta.id)).toHaveLength(2);
  });

  it('un REFUND rechazado no lleva nota: 400 y no se emite nada', async () => {
    const venta = await ventaDeServicios([
      { metodoPagoId: DEBITO_ID, monto: '100000' },
    ]);
    const ordenId = await ordenCobrada(venta.id, '100000');
    reembolsarEnElProveedor.mockResolvedValueOnce({
      aprobada: false,
      codigoRespuesta: '-1',
      codigoAutorizacion: null,
      tipoPago: null,
      request: {},
      response: {},
    });
    const rechazado = await request(app.getHttpServer())
      .post(`/api/pasarela/admin/ordenes/${ordenId}/reembolsos`)
      .set(auth())
      .set('Idempotency-Key', randomUUID())
      .send({ monto: '70000' });
    expect(rechazado.status).toBe(201);
    const [refund] = await refundsDe(ordenId);
    expect(refund.estado).toBe('rechazada');

    const res = await generarNota(ordenId, refund.transaccion_id, {
      devoluciones: [],
    });

    expect(res.status).toBe(400);
    expect(await correccionesDe(venta.id)).toEqual([]);
  });

  it('la ruta de la llave de API no expone el vínculo ni lo que pidió el reembolso: son de la pantalla del admin', async () => {
    const venta = await ventaDeProducto();
    const { ordenId } = await refundSinNota(venta.id, '10000', {
      monto: '5000',
      devoluciones: [{ itemId: itemProducto, cantidad: '1', stock: 'pierde' }],
    });
    const key = await request(app.getHttpServer())
      .post('/api/pasarela/admin/api-keys')
      .set(auth())
      .send({ nombre: `generar nota e2e ${Date.now()}` });
    expect(key.status).toBe(201);

    const porLaLlave = await request(app.getHttpServer())
      .get(`/api/pasarela/api/ordenes/${ordenId}`)
      .set(
        'Authorization',
        `Bearer ${(key.body as { apiKey: string }).apiKey}`,
      );

    expect(porLaLlave.status).toBe(200);
    const filas = (
      porLaLlave.body as { transacciones: Record<string, unknown>[] }
    ).transacciones;
    expect(filas.length).toBeGreaterThan(0);
    for (const t of filas) {
      expect(t).not.toHaveProperty('correccionVentaId');
      expect(t).not.toHaveProperty('devoluciones');
    }
  });

  it('el monto no viaja: un body con `monto` es 400 y no se emite nada', async () => {
    const venta = await ventaDeServicios([
      { metodoPagoId: DEBITO_ID, monto: '100000' },
    ]);
    const { ordenId, transaccionId } = await refundSinNota(venta.id, '100000', {
      monto: '70000',
    });

    const res = await request(app.getHttpServer())
      .post(
        `/api/pasarela/admin/ordenes/${ordenId}/reembolsos/${transaccionId}/nota`,
      )
      .set(auth())
      .set('Idempotency-Key', randomUUID())
      .send({ monto: '1', devoluciones: [] });

    expect(res.status).toBe(400);
    expect(await correccionesDe(venta.id)).toEqual([]);
  });

  it('un REFUND de otra orden es 404', async () => {
    const venta = await ventaDeServicios([
      { metodoPagoId: DEBITO_ID, monto: '100000' },
    ]);
    const { transaccionId } = await refundSinNota(venta.id, '100000', {
      monto: '70000',
    });
    const otraOrden = await ordenCobrada(venta.id, '100000');

    const res = await generarNota(otraOrden, transaccionId, {
      devoluciones: [],
    });

    expect(res.status).toBe(404);
    expect(await correccionesDe(venta.id)).toEqual([]);
  });

  it('sin la cabecera Idempotency-Key: 400 y nada escrito', async () => {
    const venta = await ventaDeServicios([
      { metodoPagoId: DEBITO_ID, monto: '100000' },
    ]);
    const { ordenId, transaccionId } = await refundSinNota(venta.id, '100000', {
      monto: '70000',
    });

    const res = await request(app.getHttpServer())
      .post(
        `/api/pasarela/admin/ordenes/${ordenId}/reembolsos/${transaccionId}/nota`,
      )
      .set(auth())
      .send({ devoluciones: [] });

    expect(res.status).toBe(400);
    expect(await correccionesDe(venta.id)).toEqual([]);
  });

  it('el permiso es Pasarelas:Reembolsar: con solo Leer, 403 y nada escrito', async () => {
    const venta = await ventaDeServicios([
      { metodoPagoId: DEBITO_ID, monto: '100000' },
    ]);
    const { ordenId, transaccionId } = await refundSinNota(venta.id, '100000', {
      monto: '70000',
    });
    const lector = await usuarioConPasarelas(['Leer']);

    const res = await generarNota(
      ordenId,
      transaccionId,
      { devoluciones: [] },
      { t: lector.token },
    );

    expect(res.status).toBe(403);
    expect(await correccionesDe(venta.id)).toEqual([]);

    const conPermiso = await usuarioConPasarelas(['Leer', 'Reembolsar']);
    const ok = await generarNota(
      ordenId,
      transaccionId,
      { devoluciones: [] },
      { t: conPermiso.token },
    );
    expect(ok.status).toBe(201);
  });
});
