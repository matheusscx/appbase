import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException, type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import { ProviderFactory } from '../src/modules/pasarela/providers/provider.factory';
import { ProviderComunicacionError } from '../src/modules/pasarela/providers/payment-provider.interface';
import { OnlineCallbackHandler } from '../src/modules/online/online-callback.handler';
import { TransaccionesService } from '../src/modules/pasarela/services/transacciones.service';
import { PasarelaOrden } from '../src/modules/pasarela/entities/pasarela-orden.entity';
import { VENTANA_COBRO_SIN_CONFIRMAR_MS } from '../src/modules/pasarela/services/cobros.service';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris: Webpay Plus activo (seed)
const CLP = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN = { email: 'admin.paris@paris.cl', password: 'admin' };

/**
 * Los escritores de la orden que no la bloqueaban (`pendientes.md` § 5,
 * 2026-10-11): cada uno leía la orden, decidía por el estado leído y guardaba
 * la entidad entera, así que pisaba lo que otro escritor hubiera resuelto en
 * el medio —el estado, la venta y la metadata—.
 *
 * - La expiración perezosa de `obtenerOrden` (el drawer del admin) y
 *   `abortarRetorno`, contra `verificar`, que tiene la orden bloqueada
 *   mientras consulta a Transbank: se dispara el otro escritor con
 *   `verificar` adentro y se suelta la consulta cuando el otro terminó o quedó
 *   esperando la fila.
 * - El cierre del callback (`CallbackDispatcherService`), contra un reembolso
 *   que entra mientras se crea la venta: la orden ya está `pagada` y
 *   commiteada, así que se puede reembolsar.
 */
describe('Pasarela: los escritores de la orden no pisan lo que otro resolvió (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let apiKey: string;
  const itemsCreados: string[] = [];

  const confirmarPago = jest.fn();
  const consultarEstado = jest.fn();
  const reembolsar = jest.fn(() =>
    Promise.resolve({
      aprobada: true,
      codigoRespuesta: '0',
      codigoAutorizacion: 'AUT-E2E',
      tipoPago: 'NULLIFIED',
      request: {},
      response: {},
    }),
  );
  const proveedor = {
    iniciarPago: (_cred: unknown, p: { codigoOrden: string }) =>
      Promise.resolve({
        tokenExterno: `tok-escritores-${p.codigoOrden}`,
        urlRedireccion: 'https://webpay.falso/iniciar',
        aprobada: true,
        codigoRespuesta: null,
        request: {},
        response: {},
      }),
    confirmarPago,
  };
  const aprobado = {
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
  };
  const pagadaConDebito = {
    estado: 'pagada',
    estadoProveedor: 'AUTHORIZED',
    saldo: null,
    detallePago: {
      tipoPago: 'VD',
      numeroCuotas: 0,
      tarjetaUltimos4: '4321',
      codigoRespuesta: '0',
      codigoAutorizacion: '7788',
    },
    response: {},
  };

  const login = async (): Promise<string> => {
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send(ADMIN);
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

  /** Una orden de la tienda (callback `interno`): el retorno crea la venta. */
  const pagarEnLaTienda = async (): Promise<string> => {
    const item = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Servicio escritores E2E ${randomUUID()}`,
        precioBase: '10000',
        monedaId: CLP,
        tipo: 'servicio',
      });
    expect(item.status).toBe(201);
    const itemId = (item.body as { id: string }).id;
    itemsCreados.push(itemId);
    const res = await request(app.getHttpServer())
      .post('/api/online/pagar')
      .set('Authorization', `Bearer ${token}`)
      .send({ lineas: [{ itemId, cantidad: '1' }] });
    expect(res.status).toBe(201);
    return (res.body as { ordenId: string }).ordenId;
  };

  /** Una orden de una app por llave de API: `verificar` la deja `pagada`. */
  const pagarPorLlave = async (): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/api/pasarela/api/pagos')
      .set('Authorization', `Bearer ${apiKey}`)
      .send({
        monto: '5000',
        descripcion: 'Pago de una app externa E2E',
        urlExito: 'http://localhost/exito',
        urlFracaso: 'http://localhost/fracaso',
      });
    expect(res.status).toBe(201);
    return (res.body as { ordenId: string }).ordenId;
  };

  const ordenDe = async (ordenId: string) => {
    const [fila]: {
      estado: string;
      venta_id: string | null;
      monto: string;
      codigo_orden: string;
      token_proveedor: string;
      metadata: Record<string, unknown>;
    }[] = await ds.query(
      `SELECT estado, venta_id, monto, codigo_orden, token_proveedor, metadata
         FROM pasarela_ordenes
        WHERE orden_id = $1 AND eliminado_el IS NULL`,
      [ordenId],
    );
    return fila;
  };

  const verificar = async (ordenId: string) => {
    const res = await request(app.getHttpServer())
      .post(`/api/pasarela/api/ordenes/${ordenId}/verificar`)
      .set('Authorization', `Bearer ${apiKey}`);
    expect(res.status).toBe(201);
    return res.body as { estado: string };
  };

  const ventasOnline = async (): Promise<number> => {
    const [fila]: { n: string }[] = await ds.query(
      `SELECT count(*) AS n FROM ventas
        WHERE tenant_id = $1 AND canal = 'online' AND eliminado_el IS NULL`,
      [TENANT_ID],
    );
    return Number(fila.n);
  };

  /** ¿Alguien está esperando el lock de una fila de órdenes? */
  const hayUnaEsperandoLaOrden = async (): Promise<boolean> => {
    const filas: unknown[] = await ds.query(
      `SELECT 1 FROM pg_stat_activity
        WHERE wait_event_type = 'Lock'
          AND query ILIKE '%pasarela_ordenes%'`,
    );
    return filas.length > 0;
  };

  /**
   * `verificar` con el otro escritor ya adentro: la consulta a Transbank (con
   * la orden bloqueada) dispara `otro` y responde pagada recién cuando `otro`
   * terminó o quedó esperando la fila. Devuelve la respuesta de `otro`.
   */
  const verificarConOtroAdentro = async (
    ordenId: string,
    otro: () => Promise<request.Response>,
  ): Promise<request.Response> => {
    let enCurso: Promise<request.Response> | undefined;
    let termino = false;
    consultarEstado.mockImplementationOnce(async () => {
      enCurso = otro().then((r) => {
        termino = true;
        return r;
      });
      const limite = Date.now() + 10_000;
      while (
        !termino &&
        !(await hayUnaEsperandoLaOrden()) &&
        Date.now() < limite
      )
        await new Promise((r) => setTimeout(r, 50));
      return pagadaConDebito;
    });
    expect((await verificar(ordenId)).estado).toBe('pagada');
    expect(enCurso).toBeDefined();
    return enCurso!;
  };

  const reembolsarEntera = async (ordenId: string) =>
    request(app.getHttpServer())
      .post(`/api/pasarela/admin/ordenes/${ordenId}/reembolsos`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ monto: (await ordenDe(ordenId)).monto });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ProviderFactory)
      .useValue({
        getPagoRedirect: () => proveedor,
        getReembolsable: () => ({ consultarEstado, reembolsar }),
      })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(validacionGlobal());
    await app.init();
    ds = app.get(DataSource);

    token = await login();
    const resKey = await request(app.getHttpServer())
      .post('/api/pasarela/admin/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `escritores orden e2e ${Date.now()}` });
    expect(resKey.status).toBe(201);
    apiKey = (resKey.body as { apiKey: string }).apiKey;
  });

  beforeEach(() => {
    reembolsar.mockClear();
    confirmarPago.mockReset().mockResolvedValue(aprobado);
    consultarEstado.mockReset().mockResolvedValue(pagadaConDebito);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    const fallas: string[] = [];
    for (const id of itemsCreados) {
      const res = await request(app.getHttpServer())
        .delete(`/api/items/${id}`)
        .set('Authorization', `Bearer ${token}`);
      if (res.status >= 300) fallas.push(`items/${id}: ${res.status}`);
    }
    await app.close();
    expect(fallas).toEqual([]);
  });

  describe('la expiración perezosa del drawer, con verificar adentro', () => {
    const vencerPorReloj = (ordenId: string) =>
      ds.query(
        `UPDATE pasarela_ordenes
            SET fecha_expiracion = now() - interval '1 minute'
          WHERE orden_id = $1`,
        [ordenId],
      );
    const abrirElDrawer = (ordenId: string) =>
      request(app.getHttpServer())
        .get(`/api/pasarela/admin/ordenes/${ordenId}`)
        .set('Authorization', `Bearer ${token}`);

    it('el admin abre una orden vencida mientras verificar la encuentra pagada: queda pagada', async () => {
      const ordenId = await pagarPorLlave();
      await vencerPorReloj(ordenId);

      const drawer = await verificarConOtroAdentro(ordenId, () =>
        abrirElDrawer(ordenId),
      );

      expect(drawer.status).toBe(200);
      const orden = await ordenDe(ordenId);
      expect(orden.estado).toBe('pagada');
      expect(orden.metadata.verificacion).toBeDefined();
      expect(orden.metadata.resultadoPago).toBeDefined();
      // El drawer muestra lo que hay, no lo que leyó antes de esperar.
      expect((drawer.body as { estado: string }).estado).toBe('pagada');
    });

    it('control: sin nadie en el medio, la orden vencida se ve expirada', async () => {
      const ordenId = await pagarPorLlave();
      await vencerPorReloj(ordenId);

      const drawer = await abrirElDrawer(ordenId);
      expect(drawer.status).toBe(200);
      expect((drawer.body as { estado: string }).estado).toBe('expirada');
      expect((await ordenDe(ordenId)).estado).toBe('expirada');
    });

    it('control: una vencida que intentó autorizar no expira, solo se verifica', async () => {
      const ordenId = await pagarPorLlave();
      // El retorno vuelve con un error de comunicación: la orden queda
      // en_proceso con una AUTHORIZATION `error`, y pudo haberse pagado.
      confirmarPago.mockRejectedValueOnce(
        new ProviderComunicacionError('timeout', {}),
      );
      const { token_proveedor } = await ordenDe(ordenId);
      const retorno = await request(app.getHttpServer()).get(
        `/api/pasarela/retorno/pago?token_ws=${token_proveedor}`,
      );
      expect(retorno.status).toBe(502);
      await vencerPorReloj(ordenId);

      const drawer = await abrirElDrawer(ordenId);
      expect(drawer.status).toBe(200);
      expect((drawer.body as { estado: string }).estado).toBe('en_proceso');
      expect((await ordenDe(ordenId)).estado).toBe('en_proceso');
    });
  });

  describe('el retorno de anulación, con otro escritor adentro', () => {
    it('Webpay vuelve anulado mientras verificar la encuentra pagada: queda pagada', async () => {
      const ordenId = await pagarPorLlave();
      const { codigo_orden } = await ordenDe(ordenId);

      const aborto = await verificarConOtroAdentro(ordenId, () =>
        request(app.getHttpServer()).get(
          `/api/pasarela/retorno/pago?TBK_ORDEN_COMPRA=${codigo_orden}`,
        ),
      );

      expect(aborto.status).toBe(302);
      const orden = await ordenDe(ordenId);
      expect(orden.estado).toBe('pagada');
      expect(orden.metadata.verificacion).toBeDefined();
      expect(orden.metadata.resultadoPago).toBeDefined();
      expect(orden.metadata.aborto).toBeUndefined();
    });

    /**
     * El retorno ya reclamó la orden (`procesando`) y está confirmando con
     * Transbank cuando llega la anulación. El retorno no tiene lock en esa
     * ventana: la anulación entra, corre entera y recién ahí Transbank
     * contesta.
     */
    const anularMientrasConfirma = async (
      ordenId: string,
      contesta: () => Promise<typeof aprobado>,
    ) => {
      const { codigo_orden, token_proveedor } = await ordenDe(ordenId);
      let aborto: request.Response | undefined;
      confirmarPago.mockImplementationOnce(async () => {
        aborto = await request(app.getHttpServer()).get(
          `/api/pasarela/retorno/pago?TBK_TOKEN=${token_proveedor}&TBK_ORDEN_COMPRA=${codigo_orden}`,
        );
        return contesta();
      });
      const retorno = await request(app.getHttpServer()).get(
        `/api/pasarela/retorno/pago?token_ws=${token_proveedor}`,
      );
      expect(aborto?.status).toBe(302);
      return retorno;
    };

    it('Webpay vuelve anulado mientras el retorno confirma y Transbank no contesta: queda en_proceso, para verificar', async () => {
      const ordenId = await pagarPorLlave();

      const retorno = await anularMientrasConfirma(ordenId, () =>
        Promise.reject(new ProviderComunicacionError('timeout', {})),
      );

      expect(retorno.status).toBe(502);
      // El cargo pudo salir: la compensación la devuelve a `en_proceso` y
      // `verificar` la aclara. Con `fallida`, `verificar` ya no la miraba.
      const orden = await ordenDe(ordenId);
      expect(orden.estado).toBe('en_proceso');
      expect(orden.metadata.aborto).toBeUndefined();
      expect((await verificar(ordenId)).estado).toBe('pagada');
    });

    it('control: Webpay vuelve anulado mientras el retorno confirma y Transbank aprueba: queda pagada', async () => {
      const ordenId = await pagarPorLlave();

      const retorno = await anularMientrasConfirma(ordenId, () =>
        Promise.resolve(aprobado),
      );

      expect(retorno.status).toBe(302);
      const orden = await ordenDe(ordenId);
      expect(orden.estado).toBe('pagada');
      expect(orden.metadata.aborto).toBeUndefined();
    });

    it('control: sin nadie en el medio, la orden anulada queda fallida con el rastro', async () => {
      const ordenId = await pagarPorLlave();
      const { codigo_orden } = await ordenDe(ordenId);

      const aborto = await request(app.getHttpServer()).get(
        `/api/pasarela/retorno/pago?TBK_ORDEN_COMPRA=${codigo_orden}`,
      );

      expect(aborto.status).toBe(302);
      const orden = await ordenDe(ordenId);
      expect(orden.estado).toBe('fallida');
      expect(orden.metadata.aborto).toBeDefined();
    });
  });

  describe('un reembolso mientras el callback crea la venta', () => {
    interface Drawer {
      estado: string;
      ventaId: string | null;
      motivoSinVenta: string | null;
      transacciones: {
        transaccionId: string;
        tipo: string;
        estado: string;
        correccionVentaId: string | null;
      }[];
    }

    /**
     * El reembolso total entra cuando la orden ya está `pagada` y commiteada
     * y el callback todavía no creó la venta: corre entero antes del handler.
     * `crearLaVenta: false` simula que la venta no se pudo crear.
     */
    const reembolsarAntesDeLaVenta = (
      ordenId: string,
      { crearLaVenta = true } = {},
    ) => {
      const handler = app.get(OnlineCallbackHandler);
      const original = handler.onOrdenResuelta.bind(handler);
      let reembolso: request.Response | undefined;
      jest
        .spyOn(handler, 'onOrdenResuelta')
        .mockImplementationOnce(async (orden: PasarelaOrden) => {
          reembolso = await reembolsarEntera(ordenId);
          if (!crearLaVenta)
            throw new BadRequestException('Item no encontrado');
          return original(orden);
        });
      return () => reembolso;
    };

    const caminos: [string, (ordenId: string) => Promise<void>][] = [
      [
        'el retorno',
        async (ordenId) => {
          const { token_proveedor } = await ordenDe(ordenId);
          const r = await request(app.getHttpServer()).get(
            `/api/pasarela/retorno/pago?token_ws=${token_proveedor}`,
          );
          expect(r.status).toBe(302);
        },
      ],
      [
        'verificar',
        async (ordenId) => {
          const r = await request(app.getHttpServer())
            .post(`/api/pasarela/api/ordenes/${ordenId}/verificar`)
            .set('Authorization', `Bearer ${apiKey}`);
          expect(r.status).toBe(201);
          expect((r.body as { estado: string }).estado).toBe('reembolsada');
        },
      ],
    ];

    it.each(caminos)(
      '%s: queda reembolsada, con la venta ligada y el reembolso sin nota de crédito',
      async (_camino, resolver) => {
        const ventasAntes = await ventasOnline();
        const ordenId = await pagarEnLaTienda();
        const reembolso = reembolsarAntesDeLaVenta(ordenId);

        await resolver(ordenId);

        expect(reembolso()?.status).toBe(201);
        expect(reembolso()?.body).toMatchObject({ reembolsoAprobado: true });
        // La plata volvió: gana `reembolsada`. La venta se creó igual y queda
        // ligada (owner, 2026-10-11), así que no hay una boleta suelta.
        const orden = await ordenDe(ordenId);
        expect(orden.estado).toBe('reembolsada');
        expect(orden.venta_id).not.toBeNull();
        expect(await ventasOnline()).toBe(ventasAntes + 1);

        // Lo que lee `/tienda/retorno`: el estado tal cual, que la pantalla
        // muestra como "Pago devuelto" (no como un rechazo).
        const retorno = await request(app.getHttpServer())
          .get(`/api/online/orden/${ordenId}`)
          .set('Authorization', `Bearer ${token}`);
        expect(retorno.status).toBe(200);
        expect(retorno.body).toMatchObject({
          estado: 'reembolsada',
          ventaId: orden.venta_id,
          motivoRechazo: null,
        });

        // Lo que el drawer lee para la marca "sin nota de crédito": venta
        // ligada y un REFUND aprobado sin corrección.
        const drawer = await request(app.getHttpServer())
          .get(`/api/pasarela/admin/ordenes/${ordenId}`)
          .set('Authorization', `Bearer ${token}`);
        expect(drawer.status).toBe(200);
        const vista = drawer.body as Drawer;
        expect(vista).toMatchObject({
          estado: 'reembolsada',
          ventaId: orden.venta_id,
          motivoSinVenta: null,
        });
        const refunds = vista.transacciones.filter((t) => t.tipo === 'REFUND');
        expect(refunds).toEqual([
          expect.objectContaining({
            estado: 'aprobada',
            correccionVentaId: null,
          }),
        ]);

        // Y "Generar nota" la corrige por el camino de siempre.
        const nota = await request(app.getHttpServer())
          .post(
            `/api/pasarela/admin/ordenes/${ordenId}/reembolsos/${refunds[0].transaccionId}/nota`,
          )
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', randomUUID())
          .send({});
        expect(nota.status).toBe(201);
        expect(nota.body).toMatchObject({ notaCreditoId: expect.any(String) });
      },
    );

    it.each(caminos)(
      '%s, y la venta no se puede crear: queda reembolsada, sin venta ni motivo',
      async (_camino, resolver) => {
        const ventasAntes = await ventasOnline();
        const ordenId = await pagarEnLaTienda();
        const reembolso = reembolsarAntesDeLaVenta(ordenId, {
          crearLaVenta: false,
        });

        await resolver(ordenId);

        expect(reembolso()?.status).toBe(201);
        const orden = await ordenDe(ordenId);
        expect(orden.estado).toBe('reembolsada');
        expect(orden.venta_id).toBeNull();
        expect(await ventasOnline()).toBe(ventasAntes);
        const drawer = await request(app.getHttpServer())
          .get(`/api/pasarela/admin/ordenes/${ordenId}`)
          .set('Authorization', `Bearer ${token}`);
        expect(drawer.status).toBe(200);
        expect((drawer.body as Drawer).motivoSinVenta).toBeNull();
      },
    );
  });

  describe('un reembolso mientras la app externa contesta el callback', () => {
    it('la app contesta 2xx después del reembolso: la orden queda reembolsada', async () => {
      let ordenId = '';
      let contesto!: (reembolso: number) => void;
      const contestada = new Promise<number>((r) => (contesto = r));
      // La app externa: recibe el POST {ordenId} y, antes de contestar, el
      // admin reembolsa la orden entera. El status se afirma afuera: un
      // `expect` acá adentro dejaría la promesa colgada hasta el timeout.
      const servidor = createServer((_req, res) => {
        void reembolsarEntera(ordenId)
          .then((r) => r.status)
          .catch(() => -1)
          .then((status) => {
            res.writeHead(200).end();
            contesto(status);
          });
      });
      await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
      try {
        const { port } = servidor.address() as AddressInfo;
        const res = await request(app.getHttpServer())
          .post('/api/pasarela/api/pagos')
          .set('Authorization', `Bearer ${apiKey}`)
          .send({
            monto: '5000',
            descripcion: 'Pago de una app externa con callback E2E',
            urlExito: 'http://localhost/exito',
            urlFracaso: 'http://localhost/fracaso',
            urlCallback: `http://127.0.0.1:${port}/callback`,
          });
        expect(res.status).toBe(201);
        ordenId = (res.body as { ordenId: string }).ordenId;
        const { token_proveedor } = await ordenDe(ordenId);

        const retorno = await request(app.getHttpServer()).get(
          `/api/pasarela/retorno/pago?token_ws=${token_proveedor}`,
        );
        expect(retorno.status).toBe(302);
        expect(await contestada).toBe(201);
        // El callback es fire-and-forget: no hay a qué esperar después del
        // 2xx. El cierre que pisaba lo hacía en milisegundos.
        await new Promise((r) => setTimeout(r, 1000));

        expect((await ordenDe(ordenId)).estado).toBe('reembolsada');
      } finally {
        await new Promise((r) => servidor.close(r));
      }
    });
  });

  /**
   * El retorno reclama la orden (`en_proceso` → `procesando`) en su propio
   * commit, antes de llamar a Transbank. Si no llega a compensar, nadie la
   * sacaba de `procesando`: `verificar` respondía 400, el cron y la
   * expiración perezosa no la miran y no se puede reembolsar, aunque el cargo
   * pudo salir (pendientes.md § 2, 2026-10-11). Tres caminos: un error de
   * base en la lectura que seguía al claim, la compensación que falla, y el
   * proceso que muere en el medio.
   */
  describe('el retorno que reclamó la orden y no llegó a compensar', () => {
    const retornar = async (ordenId: string) => {
      const { token_proveedor } = await ordenDe(ordenId);
      return request(app.getHttpServer()).get(
        `/api/pasarela/retorno/pago?token_ws=${token_proveedor}`,
      );
    };
    const verificarCrudo = (ordenId: string) =>
      request(app.getHttpServer())
        .post(`/api/pasarela/api/ordenes/${ordenId}/verificar`)
        .set('Authorization', `Bearer ${apiKey}`);
    /** El reloj, no el estado: la última escritura de la orden fue hace `ms`. */
    const tocadaHace = (ordenId: string, ms: number) =>
      ds.query(
        `UPDATE pasarela_ordenes
            SET actualizado_el = now() - ($2 || ' milliseconds')::interval
          WHERE orden_id = $1`,
        [ordenId, String(ms)],
      );
    /** La compensación (`procesando` → `en_proceso`) falla una vez. */
    const compensacionQueFalla = () => {
      const repo = ds.getRepository(PasarelaOrden);
      const original = repo.update.bind(repo);
      return jest
        .spyOn(repo, 'update')
        .mockImplementation((criterio, cambios) =>
          (cambios as { estado?: string }).estado === 'en_proceso'
            ? Promise.reject(new Error('conexión perdida (e2e)'))
            : original(criterio, cambios),
        );
    };
    const autorizacionesAprobadas = async (ordenId: string) => {
      const [fila]: { n: string }[] = await ds.query(
        `SELECT count(*) AS n FROM pasarela_transacciones
          WHERE orden_id = $1 AND tipo = 'AUTHORIZATION'
            AND estado = 'aprobada' AND eliminado_el IS NULL`,
        [ordenId],
      );
      return Number(fila.n);
    };

    it('(a) la base falla al leer la orden del token: no queda procesando', async () => {
      const ordenId = await pagarPorLlave();
      jest
        .spyOn(ds.getRepository(PasarelaOrden), 'findOne')
        .mockRejectedValueOnce(new Error('conexión perdida (e2e)'));

      const retorno = await retornar(ordenId);

      expect(retorno.status).toBe(500);
      expect(confirmarPago).not.toHaveBeenCalled();
      expect((await ordenDe(ordenId)).estado).toBe('en_proceso');
      // Un reintento del retorno la confirma.
      expect((await retornar(ordenId)).status).toBe(302);
      expect((await ordenDe(ordenId)).estado).toBe('pagada');
    });

    it('(b) Transbank no contesta y la compensación falla: sale el 502 del timeout, no el error de la compensación', async () => {
      const ordenId = await pagarPorLlave();
      const compensacion = compensacionQueFalla();
      confirmarPago.mockRejectedValueOnce(
        new ProviderComunicacionError('timeout', {}),
      );

      const retorno = await retornar(ordenId);

      expect(compensacion).toHaveBeenCalledWith(
        { ordenId, estado: 'procesando' },
        { estado: 'en_proceso' },
      );
      expect(retorno.status).toBe(502);
      expect((await ordenDe(ordenId)).estado).toBe('procesando');
    });

    it('(b) recién trabada, verificar no la toca: el retorno puede estar confirmando todavía', async () => {
      const ordenId = await pagarPorLlave();
      // La ventana se cuenta desde el claim, no desde que se creó la orden:
      // el comprador pudo demorar en el formulario de Webpay.
      await tocadaHace(ordenId, VENTANA_COBRO_SIN_CONFIRMAR_MS + 1000);
      compensacionQueFalla();
      confirmarPago.mockRejectedValueOnce(
        new ProviderComunicacionError('timeout', {}),
      );
      expect((await retornar(ordenId)).status).toBe(502);
      jest.restoreAllMocks();

      const res = await verificarCrudo(ordenId);

      expect(res.status).toBe(400);
      expect((res.body as { message: string }).message).toContain(
        'está confirmando esta orden',
      );
      expect(consultarEstado).not.toHaveBeenCalled();
      expect((await ordenDe(ordenId)).estado).toBe('procesando');
    });

    it('(b) pasada la ventana, verificar la rescata: Transbank dice pagada y queda pagada y reembolsable', async () => {
      const ordenId = await pagarPorLlave();
      compensacionQueFalla();
      confirmarPago.mockRejectedValueOnce(
        new ProviderComunicacionError('timeout', {}),
      );
      expect((await retornar(ordenId)).status).toBe(502);
      jest.restoreAllMocks();
      await tocadaHace(ordenId, VENTANA_COBRO_SIN_CONFIRMAR_MS + 1000);

      expect((await verificar(ordenId)).estado).toBe('pagada');
      expect(await autorizacionesAprobadas(ordenId)).toBe(1);
      expect((await reembolsarEntera(ordenId)).status).toBe(201);
    });

    it('(c) el proceso murió en el medio: pasada la ventana, Transbank no sabe y verificar la devuelve a en_proceso', async () => {
      const ordenId = await pagarPorLlave();
      // El proceso muere con el claim commiteado: el retorno nunca vuelve.
      // Lo que lo representa es que nadie compensa ni cierra.
      compensacionQueFalla();
      confirmarPago.mockRejectedValueOnce(new Error('el proceso murió (e2e)'));
      expect((await retornar(ordenId)).status).toBe(500);
      jest.restoreAllMocks();
      expect((await ordenDe(ordenId)).estado).toBe('procesando');
      await tocadaHace(ordenId, VENTANA_COBRO_SIN_CONFIRMAR_MS + 1000);
      consultarEstado.mockResolvedValueOnce({
        estado: 'desconocido',
        estadoProveedor: 'INITIALIZED',
        saldo: null,
        response: {},
      });

      expect((await verificar(ordenId)).estado).toBe('en_proceso');
      // Ya no está trabada: el reintento del retorno la confirma.
      expect((await retornar(ordenId)).status).toBe(302);
      expect((await ordenDe(ordenId)).estado).toBe('pagada');
    });

    it('un retorno lento que sigue vivo pasada la ventana no pisa lo que verificar rescató', async () => {
      const ordenId = await pagarEnLaTienda();
      const ventasAntes = await ventasOnline();
      let rescate: request.Response | undefined;
      confirmarPago.mockImplementationOnce(async () => {
        await tocadaHace(ordenId, VENTANA_COBRO_SIN_CONFIRMAR_MS + 1000);
        rescate = await verificarCrudo(ordenId);
        return aprobado;
      });

      const retorno = await retornar(ordenId);

      expect(rescate?.status).toBe(201);
      expect(retorno.status).toBe(302);
      expect(retorno.headers.location).toContain('estado=pagada');
      const orden = await ordenDe(ordenId);
      expect(orden.estado).toBe('conciliada');
      expect(orden.metadata.verificacion).toBeDefined();
      expect(await ventasOnline()).toBe(ventasAntes + 1);
      expect(await autorizacionesAprobadas(ordenId)).toBe(1);
    });

    it('un retorno lento que aprueba después de que el rescate la devolvió a en_proceso la cierra pagada', async () => {
      const ordenId = await pagarEnLaTienda();
      const ventasAntes = await ventasOnline();
      confirmarPago.mockImplementationOnce(async () => {
        await tocadaHace(ordenId, VENTANA_COBRO_SIN_CONFIRMAR_MS + 1000);
        consultarEstado.mockResolvedValueOnce({
          estado: 'desconocido',
          estadoProveedor: 'INITIALIZED',
          saldo: null,
          response: {},
        });
        const rescate = await verificarCrudo(ordenId);
        expect(rescate.status).toBe(201);
        expect((rescate.body as { estado: string }).estado).toBe('en_proceso');
        return aprobado;
      });

      const retorno = await retornar(ordenId);

      // La aprobación no se descarta: Transbank acaba de contestar y la
      // orden sigue sin resolver.
      expect(retorno.status).toBe(302);
      expect(retorno.headers.location).toContain('estado=pagada');
      expect((await ordenDe(ordenId)).estado).toBe('conciliada');
      expect(await ventasOnline()).toBe(ventasAntes + 1);
      expect(await autorizacionesAprobadas(ordenId)).toBe(1);
    });

    it('el cierre falla con Transbank ya aprobado: queda en_proceso con rastro, no expira por reloj y verificar la cierra', async () => {
      const ordenId = await pagarPorLlave();
      jest
        .spyOn(app.get(TransaccionesService), 'registrar')
        .mockRejectedValueOnce(new Error('conexión perdida (e2e)'));

      expect((await retornar(ordenId)).status).toBe(500);

      expect((await ordenDe(ordenId)).estado).toBe('en_proceso');
      const [{ n }]: { n: string }[] = await ds.query(
        `SELECT count(*) AS n FROM pasarela_transacciones
          WHERE orden_id = $1 AND tipo = 'AUTHORIZATION'
            AND estado = 'error' AND eliminado_el IS NULL`,
        [ordenId],
      );
      expect(Number(n)).toBe(1);
      // El rastro la saca de la expiración por reloj: el cargo pudo salir.
      await ds.query(
        `UPDATE pasarela_ordenes
            SET fecha_expiracion = now() - interval '1 minute'
          WHERE orden_id = $1`,
        [ordenId],
      );
      const drawer = await request(app.getHttpServer())
        .get(`/api/pasarela/admin/ordenes/${ordenId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(drawer.status).toBe(200);
      expect((drawer.body as { estado: string }).estado).toBe('en_proceso');
      expect((await verificar(ordenId)).estado).toBe('pagada');
      expect(await autorizacionesAprobadas(ordenId)).toBe(1);
    });

    it('si la venta del rescate no se pudo crear, el retorno lento no la reintenta', async () => {
      const ordenId = await pagarEnLaTienda();
      const crearVenta = jest
        .spyOn(app.get(OnlineCallbackHandler), 'onOrdenResuelta')
        .mockRejectedValue(new BadRequestException('Item no encontrado'));
      confirmarPago.mockImplementationOnce(async () => {
        await tocadaHace(ordenId, VENTANA_COBRO_SIN_CONFIRMAR_MS + 1000);
        expect((await verificarCrudo(ordenId)).status).toBe(201);
        return aprobado;
      });

      expect((await retornar(ordenId)).status).toBe(302);

      // Sin reintento automático: la pagada sin venta la resuelve el admin.
      expect(crearVenta).toHaveBeenCalledTimes(1);
      const orden = await ordenDe(ordenId);
      expect(orden.estado).toBe('pagada');
      expect(orden.venta_id).toBeNull();
    });
  });
});
