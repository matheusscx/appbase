import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import type { Server, AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * **Tarea 9 del frente "bodegas y traslados"**: `POST /traslados` mueve
 * mercadería entre dos ubicaciones del tenant en un solo acto atómico,
 * dejando **dos filas de kardex** —salida en el origen, entrada en el
 * destino— colgadas de un mismo `traslado_id`.
 *
 * Documentación viva del frente: `docs/features/bodegas-y-traslados.md`.
 *
 * El caso que más pesa es el último —**dos traslados cruzados**— y su
 * encabezado propio explica qué mide y, sobre todo, **qué mutante lo pone en
 * rojo**, que no es el que uno supondría: está medido ahí.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const FALABELLA_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface GarzonCreado {
  id: string;
  pin: string;
}
interface UbicacionListada {
  id: string;
  nombre: string;
  tipo: 'local' | 'bodega';
}
interface UnidadResponse {
  id: string;
  serie: string;
  estado: string;
  ubicacionId: string;
}
interface LoteResponse {
  id: string;
  cantidadDisponible: string;
  fechaVencimiento: string | null;
  desglosePorUbicacion: { ubicacionId: string; cantidad: string }[];
}
interface FilaItem {
  id: string;
  stock: string;
  stockVendible: string;
}
interface TrasladoRespuesta {
  id: string;
  origenId: string;
  destinoId: string;
  itemsMovidos: number;
  detalle: {
    itemId: string;
    itemNombre: string;
    cantidad: string;
    movimientoSalidaId: string;
    movimientoEntradaId: string;
    stockOrigenResultante: string;
    stockDestinoResultante: string;
  }[];
}

describe('Traslados entre ubicaciones (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let port: number;
  let localId: string;
  let bodegaId: string;
  let bodegaNombre: string;
  let motivoId: string;
  const cuentasAbiertas: string[] = [];
  let garzon: GarzonCreado | null = null;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function post<T>(
    url: string,
    body: Record<string, unknown>,
    esperado = 201,
  ): Promise<T> {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(esperado);
    return res.body as T;
  }

  const nombreUnico = (base: string) =>
    `${base} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;

  /** El `POST /traslados` crudo: status y mensaje, para afirmar sobre los dos. */
  async function intentarTraslado(body: Record<string, unknown>): Promise<{
    status: number;
    message: string;
    body: TrasladoRespuesta;
  }> {
    const res = await request(app.getHttpServer())
      .post('/api/traslados')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    const message = (res.body as { message?: string | string[] }).message;
    return {
      status: res.status,
      message: Array.isArray(message) ? message.join(' ') : (message ?? ''),
      body: res.body as TrasladoRespuesta,
    };
  }

  async function trasladar(
    origenId: string,
    destinoId: string,
    lineas: Record<string, unknown>[],
  ): Promise<TrasladoRespuesta> {
    return post<TrasladoRespuesta>('/api/traslados', {
      origenId,
      destinoId,
      motivoTrasladoId: motivoId,
      lineas,
    });
  }

  /** Producto por cantidad con stock inicial en el LOCAL. */
  async function crearProducto(stock: string): Promise<string> {
    const { id } = await post<IdResponse>('/api/items', {
      nombre: nombreUnico('Producto traslado E2E'),
      precioBase: '1000',
      precioIncluyeImpuesto: true,
      monedaId: CLP_MONEDA_ID,
      tipo: 'producto',
      unidadMedida: 'unidad',
      stock,
      costo: '500',
    });
    return id;
  }

  /** Saldo materializado por ubicación, leído directo: es lo que se afirma. */
  async function saldos(itemId: string): Promise<Map<string, number>> {
    const filas: { ubicacion_id: string; stock: string }[] = await ds.query(
      `SELECT ubicacion_id, stock FROM stock_ubicacion WHERE item_id = $1`,
      [itemId],
    );
    return new Map(filas.map((f) => [f.ubicacion_id, Number(f.stock)]));
  }

  async function filaDelCatalogo(itemId: string): Promise<FilaItem> {
    const res = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as FilaItem;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `switch-tenant` lee `req.cookies`, y `cookieParser` vive en `main.ts`,
    // que el e2e no ejecuta. Sin esto corta con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    ds = app.get(DataSource);

    // Login en DOS pasos: el token de `/auth/login` de un usuario multi-tenant
    // sale con `tenant_id: null` y PermisosGuard lo rechaza con 403.
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
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
    token = (resTenant.body as TokenResponse).access_token;

    const resUbic = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`);
    expect(resUbic.status).toBe(200);
    localId = (resUbic.body as UbicacionListada[]).find(
      (u) => u.tipo === 'local',
    )!.id;

    // Bodega PROPIA del spec, no la del seed: este archivo mueve stock de un
    // lado a otro y compartir la bodega lo volvería dependiente del orden de
    // las suites.
    const bodega = await post<UbicacionListada>('/api/ubicaciones', {
      nombre: nombreUnico('Bodega traslados E2E'),
      tipo: 'bodega',
    });
    bodegaId = bodega.id;
    bodegaNombre = bodega.nombre;

    const resMotivos = await request(app.getHttpServer())
      .get('/api/motivos-traslado?soloActivas=true')
      .set('Authorization', `Bearer ${token}`);
    expect(resMotivos.status).toBe(200);
    motivoId = (resMotivos.body as IdResponse[])[0].id;

    // Por HTTP real contra un puerto bindeado: el caso concurrente necesita
    // dos requests de verdad, no dos llamadas de supertest sobre el mismo
    // agente.
    const server = app.getHttpServer() as Server;
    if (!server.listening) {
      // El host va explícito por la misma razón que en `setup-supertest.ts`:
      // `listen(0)` bindea el wildcard y acá abajo se le habla a 127.0.0.1, y
      // ese desencuentro es el `401` fantasma.
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
    }
    port = (server.address() as AddressInfo).port;
  }, 120000);

  afterAll(async () => {
    // Acumular fallos de limpieza y afirmar DESPUÉS de `app.close()`: un
    // expect que tira antes de cerrar deja el pool abierto y jest no termina.
    const fallos: string[] = [];
    try {
      for (const cuentaId of cuentasAbiertas) {
        const res = await request(app.getHttpServer())
          .post(`/api/cuentas/${cuentaId}/cancelar`)
          .set('Authorization', `Bearer ${token}`)
          .send({});
        if (![200, 201, 400].includes(res.status)) {
          fallos.push(`cancelar cuenta ${cuentaId} → ${res.status}`);
        }
      }
      if (garzon) {
        const res = await request(app.getHttpServer())
          .post('/api/sesiones-garzon/cerrar')
          .set('Authorization', `Bearer ${token}`)
          .send({ garzonId: garzon.id, pin: garzon.pin });
        if (![200, 201].includes(res.status)) {
          fallos.push(`cerrar sesión del garzón → ${res.status}`);
        }
      }
    } finally {
      await app.close();
    }
    expect(fallos).toEqual([]);
  }, 60000);

  // ---------------------------------------------------------------------------
  // 1. El camino feliz
  // ---------------------------------------------------------------------------

  it('mueve el saldo entre ubicaciones sin cambiar el total, y deja DOS filas de kardex', async () => {
    const itemId = await crearProducto('30');
    // Cantidades distintas en cada tramo a propósito: con números iguales un
    // mutante que confunda origen con destino sobreviviría.
    await trasladar(localId, bodegaId, [{ itemId, cantidad: '12' }]);

    const traslado = await trasladar(bodegaId, localId, [
      { itemId, cantidad: '5' },
    ]);

    // 30 − 12 + 5 = 23 en el local; 12 − 5 = 7 en la bodega.
    const porUbicacion = await saldos(itemId);
    expect(porUbicacion.get(localId)).toBe(23);
    expect(porUbicacion.get(bodegaId)).toBe(7);

    // El TOTAL no se movió: la mercadería no entró ni salió de la empresa.
    const fila = await filaDelCatalogo(itemId);
    expect(fila.stock).toBe('30.0000');
    expect(fila.stockVendible).toBe('23.0000');

    // Dos filas de kardex del último traslado, con el MISMO traslado_id y el
    // saldo de SU ubicación en cada una.
    const movs: {
      tipo: string;
      ubicacion_id: string;
      cantidad: string;
      stock_anterior: string;
      stock_resultante: string;
      traslado_id: string;
      costo_unitario: string | null;
    }[] = await ds.query(
      `SELECT tipo, ubicacion_id, cantidad, stock_anterior, stock_resultante,
              traslado_id, costo_unitario
         FROM movimientos_inventario
        WHERE traslado_id = $1 AND eliminado_el IS NULL
        ORDER BY tipo DESC`,
      [traslado.id],
    );
    expect(movs).toHaveLength(2);
    expect(movs[0]).toMatchObject({ tipo: 'salida', ubicacion_id: bodegaId });
    expect(movs[1]).toMatchObject({ tipo: 'entrada', ubicacion_id: localId });
    expect(movs[0].traslado_id).toBe(movs[1].traslado_id);
    // El saldo de cada fila es el de SU ubicación, no el del tenant.
    expect(Number(movs[0].stock_anterior)).toBe(12);
    expect(Number(movs[0].stock_resultante)).toBe(7);
    expect(Number(movs[1].stock_anterior)).toBe(18);
    expect(Number(movs[1].stock_resultante)).toBe(23);

    // El costo NO se recalculó: el traslado mueve kilos, no plata. Las dos
    // filas congelan el mismo costo vigente (500) y `item_producto.costo_actual`
    // sigue en 500 — si la entrada promediara contra sí misma, subiría.
    // Plata comparada como string exacto, no con `Number()`: es el patrón del
    // repo para dinero en e2e (`costeo-cpp.e2e-spec.ts`), y un `number` nativo
    // sobre `numeric(18,4)` es justo la puerta que la invariante cierra.
    expect(movs[0].costo_unitario).toBe('500.0000');
    expect(movs[1].costo_unitario).toBe('500.0000');
    const costo: { costo_actual: string }[] = await ds.query(
      `SELECT costo_actual FROM item_producto WHERE item_id = $1`,
      [itemId],
    );
    expect(costo[0].costo_actual).toBe('500.0000');

    // Y el documento se lee de vuelta con sus dos puntas.
    const resDetalle = await request(app.getHttpServer())
      .get(`/api/traslados/${traslado.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDetalle.status).toBe(200);
    const detalle = resDetalle.body as TrasladoRespuesta;
    expect(detalle.origenId).toBe(bodegaId);
    expect(detalle.destinoId).toBe(localId);
    expect(detalle.detalle).toHaveLength(1);
    expect(detalle.detalle[0]).toMatchObject({
      itemId,
      cantidad: '5.0000',
      stockOrigenResultante: '7.0000',
      stockDestinoResultante: '23.0000',
    });

    // Y el kardex lo puede FILTRAR por su motivo: sin `'traslado'` en el
    // whitelist de `FindMovimientosDto`, pedir ese filtro contesta 400. Las
    // filas se listan igual sin filtro —el kardex no filtra por motivo por
    // defecto— así que lo que se rompe es poder aislarlas, no verlas. El
    // gemelo de esa lista en el frontend (`motivoOpts` de
    // `pages/inventario/index.vue`) es el que decide si la pantalla puede
    // pedirlo. Lo levantó la revisión independiente, medido contra el stack.
    const resKardex = await request(app.getHttpServer())
      .get(`/api/inventario/movimientos?motivo=traslado&itemId=${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resKardex.status).toBe(200);
    const delItem = (
      resKardex.body as { data: { motivo: string; itemId: string }[] }
    ).data;
    // Dos traslados de este ítem × dos filas cada uno.
    expect(delItem).toHaveLength(4);
    expect(delItem.every((m) => m.motivo === 'traslado')).toBe(true);

    // Y aparece en el listado.
    const resLista = await request(app.getHttpServer())
      .get('/api/traslados')
      .set('Authorization', `Bearer ${token}`);
    expect(resLista.status).toBe(200);
    const enLista = (
      resLista.body as { data: { id: string; itemsMovidos: number }[] }
    ).data.find((t) => t.id === traslado.id);
    expect(enLista).toBeDefined();
    expect(enLista!.itemsMovidos).toBe(1);
  }, 60000);

  // ---------------------------------------------------------------------------
  // 2 y 3. Los rechazos básicos
  // ---------------------------------------------------------------------------

  it('rechaza el traslado a sí misma', async () => {
    // Con stock de sobra: el rechazo tiene que venir del guard de origen ≠
    // destino, no de un saldo insuficiente que taparía su ausencia.
    const itemId = await crearProducto('50');
    const res = await intentarTraslado({
      origenId: localId,
      destinoId: localId,
      motivoTrasladoId: motivoId,
      lineas: [{ itemId, cantidad: '1' }],
    });
    expect(res.status).toBe(400);
    expect(res.message).toMatch(/origen y el destino/i);
  }, 30000);

  it('rechaza sacar más de lo que hay, nombrando el producto y el LUGAR', async () => {
    const itemId = await crearProducto('9');
    await trasladar(localId, bodegaId, [{ itemId, cantidad: '4' }]);

    // En la bodega hay 4; se piden 6. El mensaje tiene que decir dónde faltó,
    // porque el mismo producto puede tener de sobra en la otra ubicación.
    const res = await intentarTraslado({
      origenId: bodegaId,
      destinoId: localId,
      motivoTrasladoId: motivoId,
      lineas: [{ itemId, cantidad: '6' }],
    });
    expect(res.status).toBe(400);
    expect(res.message).toContain(bodegaNombre);
    expect(res.message).toMatch(/faltan 2\b/);

    // Y no dejó rastro: ni saldos movidos ni filas de kardex. Lo segundo se
    // afirma y no se supone, porque los saldos por sí solos no distinguen "no
    // se movió nada" de "se movió y se compensó".
    //
    // ⚠️ Lo que esto NO mide es la tabla `traslados`: el documento se inserta
    // dentro de la misma transacción, así que un rechazo del tope la revierte
    // entera y no hay mutante de orden que deje un documento colgado. Si algún
    // día el `INSERT` saliera de la transacción, esta cobertura no lo vería.
    const porUbicacion = await saldos(itemId);
    expect(porUbicacion.get(localId)).toBe(5);
    expect(porUbicacion.get(bodegaId)).toBe(4);
    const filasKardex: { total: string }[] = await ds.query(
      `SELECT COUNT(*) AS total FROM movimientos_inventario
        WHERE item_id = $1 AND motivo = 'traslado' AND eliminado_el IS NULL`,
      [itemId],
    );
    // Solo los 2 del traslado que SÍ pasó, arriba: el rechazado no sumó.
    expect(Number(filasKardex[0].total)).toBe(2);
  }, 30000);

  it('rechaza un motivo de traslado que no es del tenant o está inactivo', async () => {
    const itemId = await crearProducto('5');
    const res = await intentarTraslado({
      origenId: localId,
      destinoId: bodegaId,
      motivoTrasladoId: '00000000-0000-4000-8000-000000000000',
      lineas: [{ itemId, cantidad: '1' }],
    });
    expect(res.status).toBe(400);
    expect(res.message).toMatch(/Motivo de traslado/i);
  }, 30000);

  // ---------------------------------------------------------------------------
  // 4 y 5. El tope asimétrico
  // ---------------------------------------------------------------------------

  describe('el tope es asimétrico: el local topea contra lo apartado, la bodega no', () => {
    let itemId: string;

    beforeAll(async () => {
      // 20 en el local; 9 se van a la bodega → local 11, bodega 9.
      itemId = await crearProducto('20');
      await trasladar(localId, bodegaId, [{ itemId, cantidad: '9' }]);

      // ⚠️ Garzón PROPIO, no el del seed: la sesión es única por garzón y hay
      // varias suites que comparten el sembrado.
      const marca = Date.now();
      garzon = await post<GarzonCreado>('/api/garzones', {
        nombre: `Garzón traslados E2E ${marca}`,
      });
      await post('/api/sesiones-garzon/iniciar', {
        garzonId: garzon.id,
        pin: garzon.pin,
        turnoId: TURNO_MANANA_ID,
      });
      const salonId = (
        await post<IdResponse>('/api/salones', {
          nombre: `Salón traslados E2E ${marca}`,
        })
      ).id;
      const mesaId = (
        await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
          nombre: 'Mesa traslados',
        })
      ).id;

      // La mesa pide 7 de los 11 que hay en el local: quedan 4 pedibles.
      const cuentaId = (
        await post<IdResponse>(`/api/mesas/${mesaId}/cuentas`, {
          garzonId: garzon.id,
          pin: garzon.pin,
        })
      ).id;
      cuentasAbiertas.push(cuentaId);
      await post(`/api/cuentas/${cuentaId}/lineas`, {
        itemId,
        cantidad: '7',
      });
    }, 60000);

    it('sacar del LOCAL lo que una cuenta abierta ya pidió → 400', async () => {
      // Físicamente hay 11 en el local, pero 7 están apartados: 6 no salen.
      const res = await intentarTraslado({
        origenId: localId,
        destinoId: bodegaId,
        motivoTrasladoId: motivoId,
        lineas: [{ itemId, cantidad: '6' }],
      });
      expect(res.status).toBe(400);
      expect(res.message).toMatch(/apartad/i);

      // Y los 4 que sí quedan pedibles pasan: el tope frena lo que sobra, no
      // el traslado entero.
      await trasladar(localId, bodegaId, [{ itemId, cantidad: '4' }]);
      const porUbicacion = await saldos(itemId);
      expect(porUbicacion.get(localId)).toBe(7);
      expect(porUbicacion.get(bodegaId)).toBe(13);
    }, 30000);

    it('sacar de la BODEGA con esa misma cuenta abierta → 201', async () => {
      // En una bodega no hay nada apartado porque de ahí no se vende: los 13
      // de la bodega salen enteros aunque el local tenga 7 comprometidos.
      await trasladar(bodegaId, localId, [{ itemId, cantidad: '13' }]);
      const porUbicacion = await saldos(itemId);
      expect(porUbicacion.get(localId)).toBe(20);
      expect(porUbicacion.get(bodegaId)).toBe(0);
    }, 30000);
  });

  // ---------------------------------------------------------------------------
  // 6. Ubicación desactivada
  // ---------------------------------------------------------------------------

  it('no traslada HACIA una ubicación desactivada, pero sí DESDE una', async () => {
    const itemId = await crearProducto('15');
    const bodegaApagada = await post<UbicacionListada>('/api/ubicaciones', {
      nombre: nombreUnico('Bodega apagada E2E'),
      tipo: 'bodega',
    });

    // Se llena mientras está activa, y recién después se apaga.
    await trasladar(localId, bodegaApagada.id, [{ itemId, cantidad: '6' }]);
    const resPatch = await request(app.getHttpServer())
      .patch(`/api/ubicaciones/${bodegaApagada.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ activo: false });
    expect(resPatch.status).toBe(200);

    // Hacia la bodega apagada: 400.
    const rechazo = await intentarTraslado({
      origenId: localId,
      destinoId: bodegaApagada.id,
      motivoTrasladoId: motivoId,
      lineas: [{ itemId, cantidad: '1' }],
    });
    expect(rechazo.status).toBe(400);
    expect(rechazo.message).toMatch(/desactivada/i);

    // Desde la bodega apagada: pasa. Asimetría deliberada — si no pudiera ser
    // origen, su mercadería quedaría encerrada y la bodega no se podría
    // vaciar para eliminarla.
    await trasladar(bodegaApagada.id, localId, [{ itemId, cantidad: '6' }]);
    const porUbicacion = await saldos(itemId);
    expect(porUbicacion.get(localId)).toBe(15);
    expect(porUbicacion.get(bodegaApagada.id)).toBe(0);
  }, 60000);

  // ---------------------------------------------------------------------------
  // 7. Modo serie
  // ---------------------------------------------------------------------------

  it('modo serie: mueve el IMEI pedido y deja la unidad DISPONIBLE en el destino', async () => {
    const { id: itemId } = await post<IdResponse>('/api/items', {
      nombre: nombreUnico('Serie traslado E2E'),
      precioBase: '10000',
      monedaId: CLP_MONEDA_ID,
      tipo: 'producto',
      modoInventario: 'serie',
    });
    const marca = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    // 3 unidades entran al local y se mueve 1: cantidades distintas a
    // propósito en cada punta.
    await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        ubicacionId: localId,
        cantidad: '3',
        series: [
          { serie: `IMEI-A-${marca}` },
          { serie: `IMEI-B-${marca}` },
          { serie: `IMEI-C-${marca}` },
        ],
      })
      .expect(200);

    const resUnidades = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/unidades`)
      .set('Authorization', `Bearer ${token}`);
    expect(resUnidades.status).toBe(200);
    const viajera = (resUnidades.body as UnidadResponse[]).find(
      (u) => u.serie === `IMEI-A-${marca}`,
    )!;

    await trasladar(localId, bodegaId, [
      { itemId, cantidad: '1', unidadIds: [viajera.id] },
    ]);

    // ⛔ Lo que un traslado NO hace: dar de baja la unidad. Cambió de lugar,
    // no salió del inventario.
    const filas: { estado: string; ubicacion_id: string }[] = await ds.query(
      `SELECT estado, ubicacion_id FROM item_unidad WHERE unidad_id = $1`,
      [viajera.id],
    );
    expect(filas[0].estado).toBe('disponible');
    expect(filas[0].ubicacion_id).toBe(bodegaId);

    // Ni duplicar la serie: sigue habiendo TRES unidades del ítem, no cuatro.
    const cuenta: { cnt: string }[] = await ds.query(
      `SELECT COUNT(*) AS cnt FROM item_unidad
        WHERE item_id = $1 AND eliminado_el IS NULL`,
      [itemId],
    );
    expect(Number(cuenta[0].cnt)).toBe(3);

    const porUbicacion = await saldos(itemId);
    expect(porUbicacion.get(localId)).toBe(2);
    expect(porUbicacion.get(bodegaId)).toBe(1);

    // Y pedir desde el LOCAL una unidad que ya está en la bodega rebota
    // nombrando dónde está de verdad.
    const rechazo = await intentarTraslado({
      origenId: localId,
      destinoId: bodegaId,
      motivoTrasladoId: motivoId,
      lineas: [{ itemId, cantidad: '1', unidadIds: [viajera.id] }],
    });
    expect(rechazo.status).toBe(400);
    expect(rechazo.message).toContain(`IMEI-A-${marca}`);
    expect(rechazo.message).toContain(bodegaNombre);
  }, 60000);

  // ---------------------------------------------------------------------------
  // 8. Modo lote
  // ---------------------------------------------------------------------------

  it('modo lote: parte el saldo entre ubicaciones sin partir el lote', async () => {
    const { id: itemId } = await post<IdResponse>('/api/items', {
      nombre: nombreUnico('Lote traslado E2E'),
      precioBase: '5000',
      monedaId: CLP_MONEDA_ID,
      tipo: 'producto',
      modoInventario: 'lote',
    });
    const codigoLote = `LT-${Date.now()}`;
    const vencimiento = '2028-03-20';
    await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        ubicacionId: localId,
        cantidad: '10',
        costoUnitario: '1000',
        lote: { codigoLote, fechaVencimiento: vencimiento },
      })
      .expect(200);

    const resLotes = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/lotes`)
      .set('Authorization', `Bearer ${token}`);
    expect(resLotes.status).toBe(200);
    const loteId = (resLotes.body as LoteResponse[])[0].id;

    // 4 de 10 se van: 6 y 4, no números iguales.
    await trasladar(localId, bodegaId, [{ itemId, cantidad: '4', loteId }]);

    const resDespues = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/lotes`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDespues.status).toBe(200);
    const lote = (resDespues.body as LoteResponse[])[0];
    // El total del lote no cambió: solo se repartió.
    expect(lote.cantidadDisponible).toBe('10.0000');
    const desglose = new Map(
      lote.desglosePorUbicacion.map((d) => [d.ubicacionId, d.cantidad]),
    );
    expect(desglose.get(localId)).toBe('6.0000');
    expect(desglose.get(bodegaId)).toBe('4.0000');

    // El vencimiento sigue siendo UNO solo, del lote, no de la ubicación — y
    // `cantidad_inicial` no se infló: la entrada del traslado no vuelve a
    // sumar al lote lo que solo cambió de lugar.
    const filasLote: { fecha_vencimiento: Date; cantidad_inicial: string }[] =
      await ds.query(
        `SELECT fecha_vencimiento, cantidad_inicial FROM item_lote
          WHERE lote_id = $1`,
        [loteId],
      );
    expect(filasLote).toHaveLength(1);
    expect(
      new Date(filasLote[0].fecha_vencimiento).toISOString().slice(0, 10),
    ).toBe(vencimiento);
    expect(Number(filasLote[0].cantidad_inicial)).toBe(10);

    const porUbicacion = await saldos(itemId);
    expect(porUbicacion.get(localId)).toBe(6);
    expect(porUbicacion.get(bodegaId)).toBe(4);
  }, 60000);

  // ---------------------------------------------------------------------------
  // 7b y 8b. Auto-selección: sin `unidadIds` y sin `loteId`
  // ---------------------------------------------------------------------------

  /**
   * El DTO publica `unidadIds` y `loteId` como OPCIONALES: sin ellos el
   * chokepoint auto-selecciona FIFO entre lo que hay **en el origen**. Es el
   * único camino en el que la SALIDA elige y la ENTRADA tiene que registrar
   * esa misma elección, así que es el que recorre los cruces que la entrada de
   * traslado hace contra `cantidad` y contra el ítem. Sin estos dos casos esos
   * guards no los ejercitaba nada.
   */
  it('modo serie sin unidadIds: mueve las MÁS VIEJAS del origen', async () => {
    const { id: itemId } = await post<IdResponse>('/api/items', {
      nombre: nombreUnico('Serie FIFO traslado E2E'),
      precioBase: '10000',
      monedaId: CLP_MONEDA_ID,
      tipo: 'producto',
      modoInventario: 'serie',
    });
    const marca = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    // Tres altas SEPARADAS para que `creado_el` las ordene: si entraran en una
    // sola, el FIFO no tendría nada que ordenar y el caso no mediría el orden.
    //
    // Y las series van al REVÉS del orden de alta (C, B, A) a propósito: con
    // `1, 2, 3` el orden alfabético coincidía con el de antigüedad y un
    // `ORDER BY u.serie ASC` sobrevivía. Así, alfabético y FIFO eligen
    // unidades distintas.
    for (const sufijo of ['C', 'B', 'A']) {
      await request(app.getHttpServer())
        .patch(`/api/items/${itemId}/stock`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          tipo: 'entrada',
          motivo: 'inventario_inicial',
          ubicacionId: localId,
          cantidad: '1',
          series: [{ serie: `FIFO-${sufijo}-${marca}` }],
        })
        .expect(200);
    }

    // 2 de 3, sin decir cuáles.
    await trasladar(localId, bodegaId, [{ itemId, cantidad: '2' }]);

    const resUnidades = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/unidades`)
      .set('Authorization', `Bearer ${token}`);
    expect(resUnidades.status).toBe(200);
    const porSerie = new Map(
      (resUnidades.body as UnidadResponse[]).map((u) => [
        u.serie,
        { ubicacionId: u.ubicacionId, estado: u.estado },
      ]),
    );
    // Las dos MÁS VIEJAS (C y B) se fueron; la más nueva (A) se quedó — que es
    // exactamente al revés de lo que elegiría un orden por serie. Y ninguna se
    // dio de baja: un traslado mueve, no consume.
    expect(porSerie.get(`FIFO-C-${marca}`)).toEqual({
      ubicacionId: bodegaId,
      estado: 'disponible',
    });
    expect(porSerie.get(`FIFO-B-${marca}`)).toEqual({
      ubicacionId: bodegaId,
      estado: 'disponible',
    });
    expect(porSerie.get(`FIFO-A-${marca}`)).toEqual({
      ubicacionId: localId,
      estado: 'disponible',
    });

    const porUbicacion = await saldos(itemId);
    expect(porUbicacion.get(localId)).toBe(1);
    expect(porUbicacion.get(bodegaId)).toBe(2);
  }, 60000);

  it('modo lote sin loteId: parte el pedido entre dos lotes y la entrada registra los dos', async () => {
    const { id: itemId } = await post<IdResponse>('/api/items', {
      nombre: nombreUnico('Lote FIFO traslado E2E'),
      precioBase: '5000',
      monedaId: CLP_MONEDA_ID,
      tipo: 'producto',
      modoInventario: 'lote',
    });
    const marca = Date.now();
    // El fixture está armado para que FIFO dé un reparto que NO reproduce
    // ninguno de los cuatro criterios ascendentes plausibles (los invertidos
    // sí lo reproducen, y por eso no se afirma "ninguno"). El lote viejo es el
    // CHICO (4), se llama `Z` —o sea último alfabéticamente— y vence DESPUÉS;
    // el nuevo es el grande (5), se llama `A` y vence antes. Pidiendo 7:
    //   FIFO (viejo primero)      → 4 de Z + 3 de A   ← lo que se afirma
    //   mayor saldo primero       → 5 de A + 2 de Z
    //   por código de lote (A<Z)  → 5 de A + 2 de Z
    //   FEFO (vence antes)        → 5 de A + 2 de Z
    //   LIFO (nuevo primero)      → 5 de A + 2 de Z
    // Sin esta asimetría —viejo, grande y primero alfabéticamente a la vez—
    // los cuatro criterios de arriba coinciden con FIFO y el caso diría "FIFO"
    // midiendo mucho menos.
    for (const [sufijo, cantidad, vence] of [
      ['Z', '4', '2029-01-01'],
      ['A', '5', '2028-01-01'],
    ]) {
      await request(app.getHttpServer())
        .patch(`/api/items/${itemId}/stock`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          tipo: 'entrada',
          motivo: 'compra',
          ubicacionId: localId,
          cantidad,
          costoUnitario: '1000',
          lote: {
            codigoLote: `FIFO-${sufijo}-${marca}`,
            fechaVencimiento: vence,
          },
        })
        .expect(200);
    }

    const resLotes = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/lotes`)
      .set('Authorization', `Bearer ${token}`);
    expect(resLotes.status).toBe(200);
    const idDe = new Map(
      (resLotes.body as (LoteResponse & { codigoLote: string })[]).map((l) => [
        l.codigoLote,
        l.id,
      ]),
    );
    /** El lote VIEJO y chico (4). */
    const loteViejo = idDe.get(`FIFO-Z-${marca}`)!;
    /** El lote NUEVO y grande (5). */
    const loteNuevo = idDe.get(`FIFO-A-${marca}`)!;

    const traslado = await trasladar(localId, bodegaId, [
      { itemId, cantidad: '7' },
    ]);

    // El viejo se vació entero (4) y del nuevo salieron 3: el reparto que solo
    // produce FIFO.
    const filas: { lote_id: string; ubicacion_id: string; cantidad: string }[] =
      await ds.query(
        `SELECT lote_id, ubicacion_id, cantidad FROM lote_ubicacion
          WHERE lote_id = ANY($1)`,
        [[loteViejo, loteNuevo]],
      );
    const saldoDe = new Map(
      filas.map((f) => [`${f.lote_id}|${f.ubicacion_id}`, Number(f.cantidad)]),
    );
    expect(saldoDe.get(`${loteViejo}|${localId}`)).toBe(0);
    expect(saldoDe.get(`${loteViejo}|${bodegaId}`)).toBe(4);
    expect(saldoDe.get(`${loteNuevo}|${localId}`)).toBe(2);
    expect(saldoDe.get(`${loteNuevo}|${bodegaId}`)).toBe(3);

    // ⛔ Y la ENTRADA registró los MISMOS dos lotes que la salida eligió, no
    // una elección propia: es lo que ata las dos filas de kardex al mismo
    // movimiento real. Dos filas de detalle por punta, con 4 y 3 — el reparto
    // FIFO, no el 5 y 2 que darían los otros criterios.
    const detalles: { tipo: string; lote_id: string; cantidad: string }[] =
      await ds.query(
        `SELECT mv.tipo, d.lote_id, d.cantidad
           FROM movimiento_inventario_detalle d
           JOIN movimientos_inventario mv ON mv.movimiento_id = d.movimiento_id
          WHERE mv.traslado_id = $1
          ORDER BY mv.tipo DESC, d.cantidad DESC`,
        [traslado.id],
      );
    expect(
      detalles.map((d) => [d.tipo, d.lote_id, Number(d.cantidad)]),
    ).toEqual([
      ['salida', loteViejo, 4],
      ['salida', loteNuevo, 3],
      ['entrada', loteViejo, 4],
      ['entrada', loteNuevo, 3],
    ]);

    const porUbicacion = await saldos(itemId);
    expect(porUbicacion.get(localId)).toBe(2);
    expect(porUbicacion.get(bodegaId)).toBe(7);
  }, 60000);

  // ---------------------------------------------------------------------------
  // 9. Dos traslados cruzados
  // ---------------------------------------------------------------------------

  /**
   * ═══════════════════════════════════════════════════════════════════════════
   * QUÉ PRUEBA ESTE CASO Y QUÉ NO
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * PRUEBA: que dos traslados **opuestos** que tocan los **mismos dos
   * productos** no se abrazan. Es el ciclo que el traslado introduce sobre el
   * ancla de `item_producto` —el que este fixture monta—, y lo que lo cierra
   * es que el orden de bloqueo **no dependa del orden de las líneas del
   * body**: hoy eso lo garantiza el statement único de locks, no el `sort`
   * (la medición, en la lista de mutantes de más abajo). No dice nada de ciclos que
   * pueda abrir un lock que se sume mañana a este camino.
   *
   * ⚠️ **NO es "dos traslados del mismo producto"**, que es como estaba
   * redactado el plan. Con un solo producto el deadlock es **imposible**, no
   * meramente improbable: el ancla del `FOR UPDATE` es `item_producto`, que
   * tiene UNA fila por ítem sin importar cuántas ubicaciones toque el traslado
   * (`docs/patterns/backend.md` §15), así que los dos traslados piden la misma
   * fila y uno espera al otro. Un test con un solo producto pasaría con `sort`
   * y sin él: no mediría nada. Lo que sigue vivo es el ciclo **entre ítems**,
   * y eso es lo que se monta acá.
   *
   * CÓMO: el interleaving es DETERMINISTA, no una ráfaga probabilística — la
   * misma compuerta de `sobreventa-concurrente-ubicacion.e2e-spec.ts`, con la
   * fila ancla del ítem que va PRIMERO en el orden de bloqueo:
   *
   *   compuerta: FOR UPDATE item_producto(primero)  → retiene la fila ancla
   *   traslado A: líneas [primero, segundo]         → encola en `primero`
   *   traslado B: líneas [segundo, primero]         → si el orden de bloqueo
   *                                                   dependiera del body,
   *                                                   tomaría `segundo` y
   *                                                   después encolaría en
   *                                                   `primero`
   *   compuerta: ROLLBACK  → A toma `primero` y pide `segundo`, que B tiene;
   *                          B pide `primero`, que A tiene → 40P01
   *
   * ⚠️ Ese `→ 40P01` es el ciclo que el fixture **intenta** cerrar: hoy no
   * ocurre porque los locks se piden en un solo statement, y ocurre —medido—
   * apenas se los vuelve a pedir por línea. La medición es la cuarta viñeta de
   * la lista de mutantes, unas líneas más abajo.
   *
   * QUÉ SE AFIRMA, y por qué no alcanza con los status: **el reintento tapa el
   * deadlock**. `TrasladosService.crear` reintenta ante `40P01`
   * (`MAX_REINTENTOS_DEADLOCK`), así que aun con el ciclo los dos traslados
   * terminan en 201 y los saldos igual cuadran. Lo único que los distingue es
   * el contador de deadlocks de Postgres. Por eso el assert que importa es ese.
   *
   * ⚠️ **QUÉ MUTANTE MATA ESTE CASO, medido — no es el que uno supondría.**
   * `TrasladosService` toma los locks en UN statement (`ANY($1) ORDER BY
   * ip.item_id FOR UPDATE OF ip`), y ese **batch** es lo que hace que el orden
   * de bloqueo deje de depender del request. Medido sobre este mismo fixture:
   *
   * - Sacar **solo** el `ORDER BY ip.item_id` → **el caso PASA**.
   * - Sacar **solo** el `.sort()` de las líneas → **el caso PASA**.
   * - Sacar **las dos cosas** → **el caso PASA TAMBIÉN**. Ver abajo: esta
   *   línea decía `deadlocks: 0 → 1` y no se sostuvo.
   * - **Volver al lock por línea** —un `SELECT … item_id = $1 FOR UPDATE OF ip`
   *   por ítem, recorriendo `dto.lineas` en el orden del body— → **el caso
   *   FALLA, `deadlocks: 0 → 1`.** Medido el 2026-09-07 con el service mutado
   *   y la suite corrida de verdad, no razonado.
   *   Esa forma no es hipotética: el docblock del statement
   *   (`traslados.service.ts`) cuenta que el código la tuvo y que una revisión
   *   la levantó como N+1 —fue antes del primer commit, así que en `git log`
   *   no está—. Y `inventario.service.ts` lockea de a un ítem por statement:
   *   ahí el orden lo pone **el llamador**, que por eso ordena antes del loop
   *   (`ventas.service.ts`, `ordenLocks`). Romper el batch acá es volver a
   *   depender de esa disciplina en vez de que la imponga el statement.
   *
   * O sea: **lo que este caso protege es el batch**, no el `ORDER BY` ni el
   * `.sort()`. Mientras los locks se pidan todos en un statement, el orden
   * dentro de ese statement no lo decide el cliente; el día que alguien lo
   * vuelva a partir por línea, este caso se pone rojo.
   *
   * ⚠️ **Y lo que este caso NO puede probar es que el `ORDER BY` esté** (los
   * mutantes de orden): eso lo fija un unitario que afirma sobre el SQL
   * del statement (`traslados.service.spec.ts`, *"lockea UNA fila de
   * item_producto por ítem, ordenada por itemId"*). Los dos hacen falta.
   *
   * ───────────────────────────────────────────────────────────────────────
   * POR QUÉ los mutantes de ORDEN (`ORDER BY`, `.sort()`, los dos) no lo
   * matan, y el de ROMPER EL BATCH sí — medido el 2026-09-07 contra el stack,
   * no deducido. Los dos experimentos se reproducen en un `psql` cualquiera.
   * ───────────────────────────────────────────────────────────────────────
   * **(1) El plan.** `EXPLAIN` del statement real sobre la base del e2e:
   *
   *     LockRows
   *       ->  Sort  (Sort Key: ip.item_id)
   *             ->  Hash Join
   *                   ->  Seq Scan on items i
   *                   ->  Hash -> Seq Scan on item_producto ip
   *
   * Dos cosas que corrigen lo que este encabezado afirmaba antes: **no hay
   * index scan por la PK** —son dos seq scans con un hash join, la tabla es
   * chica— y el `LockRows` va **arriba** del `Sort`, o sea que las filas se
   * bloquean en el orden del `ORDER BY`, no en el del plan de abajo.
   *
   * **(2) El orden de adquisición, comprobado.** Con `X < Y` por `item_id`:
   * una sesión retiene `X`; otra corre el statement real con el array CRUZADO
   * `[Y, X]`; una tercera pregunta `SELECT … item_id = Y FOR UPDATE NOWAIT`.
   *
   * - Con `ORDER BY ip.item_id` (ASC): `Y` queda **libre** → la segunda sesión
   *   se encoló en `X` sin haber tocado `Y`. Bloquea en orden ascendente.
   * - Con `ORDER BY ip.item_id DESC`: `Y` queda **tomada** → bloqueó `Y`
   *   primero y después se encoló en `X`. El `ORDER BY` es lo que manda.
   * - **Sin** `ORDER BY`: `Y` queda libre igual, porque el orden pasa a salir
   *   del hash join sobre el heap de `items` — que es el **mismo para las dos
   *   transacciones**, vengan como vengan sus arrays.
   *
   * Ahí está el porqué de los mutantes de orden: para que haya deadlock,
   * las dos transacciones tienen que pedir las filas en órdenes OPUESTOS, y
   * **ningún plan de este statement deriva su orden del array** — por eso hace
   * falta romper el batch para que el orden vuelva a salir del body y el ciclo
   * se cierre. Por eso ni agrandar el fixture (medido antes
   * con 6 y 12 ítems) ni cruzar los bodies reintroduce el ciclo. El `ORDER BY` se
   * queda porque es lo que hace que la garantía sea **del código y no del plan
   * que Postgres arme mañana**: hoy los dos dicen lo mismo, y el día que el
   * plan cambie —otra versión, otro volumen, un índice nuevo— el `ORDER BY`
   * sigue decidiendo. Sin él, la seguridad quedaría prestada.
   *
   * ⚠️ **El `deadlocks: 0 → 1` que decía este encabezado se retira.** Era la
   * medición original del mutante "sacar las dos cosas". No reprodujo en tres
   * corridas limpias el 2026-09-07 (`reset-db.sh` antes de cada una), ni en la
   * cuarta —ésta— con el mutante puesto a mano: `0 → 0`. Y ahora hay
   * mecanismo, no solo ausencia de evidencia: por (2), sacar las dos cosas
   * deja el orden en manos del plan, que es común a las dos transacciones. Lo
   * más probable es que la medición original corriera contra un build stale
   * del backend.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  it('dos traslados cruzados con los mismos dos productos no hacen deadlock', async () => {
    // El orden de bloqueo es el de `item_id`, así que el spec necesita saber
    // cuál es "el primero" sin depender de la suerte.
    const idA = await crearProducto('100');
    const idB = await crearProducto('100');
    const [primero, segundo] = [idA, idB].sort((a, b) => a.localeCompare(b));

    // 60 de cada uno a la bodega → 40 en el local, 60 en la bodega.
    await trasladar(localId, bodegaId, [
      { itemId: primero, cantidad: '60' },
      { itemId: segundo, cantidad: '60' },
    ]);

    const deadlocks = async (): Promise<number> => {
      const filas: { deadlocks: string }[] = await ds.query(
        `SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`,
      );
      return Number(filas[0].deadlocks);
    };
    /** Sesiones frenadas en un lock ahora mismo: separa el verde real del
     * verde de una compuerta que no enganchó. */
    const esperandoLock = async (): Promise<number> => {
      const filas: { count: string }[] = await ds.query(
        `SELECT count(*) FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      return Number(filas[0].count);
    };

    const enviar = (
      origenId: string,
      destinoId: string,
      lineas: { itemId: string; cantidad: string }[],
    ) =>
      fetch(`http://127.0.0.1:${port}/api/traslados`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          origenId,
          destinoId,
          motivoTrasladoId: motivoId,
          lineas,
        }),
      });

    const deadlocksAntes = await deadlocks();
    const compuerta = ds.createQueryRunner();
    let esperandoLockEnLaCompuerta = -1;
    let statuses: number[] = [];
    try {
      await compuerta.connect();
      await compuerta.startTransaction();
      // La MISMA fila que el traslado usa de ancla, y la del ítem que va
      // primero en el orden de bloqueo.
      await compuerta.query(
        `SELECT item_id FROM item_producto WHERE item_id = $1 FOR UPDATE`,
        [primero],
      );

      // A: local → bodega, líneas ya en el orden de bloqueo.
      const a = enviar(localId, bodegaId, [
        { itemId: primero, cantidad: '7' },
        { itemId: segundo, cantidad: '3' },
      ]);
      // 600 ms: sobra para que la request llegue al lock y se encole. Es el
      // único punto sensible al tiempo, y solo puede fallar de más — por eso
      // se cuentan los esperadores antes de soltar.
      await dormir(600);
      // B: bodega → local, líneas al REVÉS. Es lo que el `sort` reordena.
      const b = enviar(bodegaId, localId, [
        { itemId: segundo, cantidad: '11' },
        { itemId: primero, cantidad: '5' },
      ]);
      await dormir(600);

      esperandoLockEnLaCompuerta = await esperandoLock();
      await compuerta.rollbackTransaction();

      const [rA, rB] = await Promise.all([a, b]);
      statuses = [rA.status, rB.status].sort((x, y) => x - y);
    } finally {
      // Sin esto, un throw arriba se lleva el `release()` puesto y deja la
      // conexión colgada: una falla ruidosa se vuelve un cuelgue.
      if (compuerta.isTransactionActive) await compuerta.rollbackTransaction();
      await compuerta.release();
    }

    // Las dos estaban encoladas de verdad. Sin esto el caso podría estar
    // midiendo dos requests que corrieron una después de la otra.
    expect(esperandoLockEnLaCompuerta).toBe(2);
    expect(statuses).toEqual([201, 201]);

    // ⛔ El assert que de verdad mide: cuando el orden de bloqueo vuelve a
    // depender del body (ver la medición del encabezado: hay que sacar el
    // `ORDER BY` **y** el `sort`), Postgres mata a una de las dos con 40P01 y
    // este contador sube. El reintento hace que los status y los saldos se
    // vean iguales igual, así que ningún otro assert de este caso lo notaría.
    expect(await deadlocks()).toBe(deadlocksAntes);

    // Y los saldos cuadran: primero 40−7+5 = 38 / 60+7−5 = 62;
    // segundo 40−3+11 = 48 / 60+3−11 = 52. Cuatro números distintos entre sí,
    // así ninguna confusión de ítem o de punta sobrevive.
    const saldoPrimero = await saldos(primero);
    const saldoSegundo = await saldos(segundo);
    expect(saldoPrimero.get(localId)).toBe(38);
    expect(saldoPrimero.get(bodegaId)).toBe(62);
    expect(saldoSegundo.get(localId)).toBe(48);
    expect(saldoSegundo.get(bodegaId)).toBe(52);
  }, 120000);

  // ---------------------------------------------------------------------------
  // 10. Producto eliminado: la bodega se vacía igual
  // ---------------------------------------------------------------------------

  /**
   * Borde EXPLÍCITO del diseño, no un olvido: `'traslado'` está en la
   * allowlist `MOTIVOS_SOBRE_ITEM_ELIMINADO` (`inventario.service.ts:124`)
   * porque si un producto discontinuado no pudiera trasladarse, una bodega
   * llena de esa mercadería no se podría vaciar nunca. Hasta esta tarea no
   * había un solo test que lo ejerciera.
   */
  it('un producto ELIMINADO se puede trasladar: la bodega se vacía igual', async () => {
    const itemId = await crearProducto('8');
    // Todo el stock a la bodega: el escenario real es "bodega llena de un
    // producto ya discontinuado", no "algo de stock en el local".
    await trasladar(localId, bodegaId, [{ itemId, cantidad: '8' }]);

    const resDelete = await request(app.getHttpServer())
      .delete(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect([200, 204]).toContain(resDelete.status);

    // Con el ítem ya eliminado, el traslado sigue pasando y el stock se mueve.
    await trasladar(bodegaId, localId, [{ itemId, cantidad: '8' }]);
    const porUbicacion = await saldos(itemId);
    expect(porUbicacion.get(localId)).toBe(8);
    expect(porUbicacion.get(bodegaId)).toBe(0);
  }, 30000);

  // ---------------------------------------------------------------------------
  // 11. Cross-tenant y permisos: la única red hoy es el código
  // ---------------------------------------------------------------------------

  describe('cross-tenant y permisos en /traslados', () => {
    let ubicacionFalabellaId: string;
    let motivoFalabellaId: string;
    let trasladoFalabellaId: string;
    let tokenSinPermiso: string;

    beforeAll(async () => {
      // Login en DOS pasos, contra Falabella: recursos REALES de otro tenant,
      // no uuids inventados — así el rechazo cross-tenant se puede comparar
      // contra el de "no existe" y no queda ningún mensaje que confirme que
      // el recurso existe del otro lado (sería un oráculo).
      const resLoginF = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'admin@sistema.com', password: 'admin' });
      expect(resLoginF.status).toBe(200);
      const resTenantF = await request(app.getHttpServer())
        .post('/api/auth/switch-tenant')
        .set(
          'Cookie',
          (resLoginF.headers['set-cookie'] as unknown as string[]) ?? [],
        )
        .set(
          'Authorization',
          `Bearer ${(resLoginF.body as TokenResponse).access_token}`,
        )
        .send({ tenantId: FALABELLA_TENANT_ID });
      expect(resTenantF.status).toBe(200);
      const tokenFalabella = (resTenantF.body as TokenResponse).access_token;

      const resUbicF = await request(app.getHttpServer())
        .get('/api/ubicaciones')
        .set('Authorization', `Bearer ${tokenFalabella}`);
      expect(resUbicF.status).toBe(200);
      ubicacionFalabellaId = (resUbicF.body as UbicacionListada[]).find(
        (u) => u.tipo === 'local',
      )!.id;

      const resMotivosF = await request(app.getHttpServer())
        .get('/api/motivos-traslado?soloActivas=true')
        .set('Authorization', `Bearer ${tokenFalabella}`);
      expect(resMotivosF.status).toBe(200);
      motivoFalabellaId = (resMotivosF.body as IdResponse[])[0].id;

      // Un traslado REAL de Falabella, para el 404 de "no es tuyo" en GET/:id.
      const resBodegaF = await request(app.getHttpServer())
        .post('/api/ubicaciones')
        .set('Authorization', `Bearer ${tokenFalabella}`)
        .send({ nombre: nombreUnico('Bodega Falabella E2E'), tipo: 'bodega' });
      expect(resBodegaF.status).toBe(201);
      const bodegaFalabellaId = (resBodegaF.body as UbicacionListada).id;

      const resItemF = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${tokenFalabella}`)
        .send({
          nombre: nombreUnico('Producto Falabella E2E'),
          precioBase: '1000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'producto',
          unidadMedida: 'unidad',
          stock: '5',
        });
      expect(resItemF.status).toBe(201);

      const resTrasladoF = await request(app.getHttpServer())
        .post('/api/traslados')
        .set('Authorization', `Bearer ${tokenFalabella}`)
        .send({
          origenId: ubicacionFalabellaId,
          destinoId: bodegaFalabellaId,
          motivoTrasladoId: motivoFalabellaId,
          lineas: [{ itemId: (resItemF.body as IdResponse).id, cantidad: '1' }],
        });
      expect(resTrasladoF.status).toBe(201);
      trasladoFalabellaId = (resTrasladoF.body as TrasladoRespuesta).id;

      // Usuario de PARIS sin Inventario: tiene Ventas/Caja/Pagos/Items (rol
      // "Vendedor" del seed), y ni `Inventario/Crear` ni `Inventario/Leer` —
      // sesión real, del tenant correcto, solo le falta el permiso puntual.
      // Con un token inválido el 403 no probaría el guard: sería un 401
      // disfrazado.
      const resLoginV = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'vendedor@paris.cl', password: 'admin' });
      expect(resLoginV.status).toBe(200);
      const resTenantV = await request(app.getHttpServer())
        .post('/api/auth/switch-tenant')
        .set(
          'Cookie',
          (resLoginV.headers['set-cookie'] as unknown as string[]) ?? [],
        )
        .set(
          'Authorization',
          `Bearer ${(resLoginV.body as TokenResponse).access_token}`,
        )
        .send({ tenantId: PARIS_TENANT_ID });
      expect(resTenantV.status).toBe(200);
      tokenSinPermiso = (resTenantV.body as TokenResponse).access_token;
    }, 60000);

    it('un ubicacionId de otro tenant, de origen o de destino, da el mismo 404 opaco que uno inexistente', async () => {
      const itemId = await crearProducto('3');
      const inexistente = '00000000-0000-4000-8000-000000000000';

      const comoOrigenAjeno = await intentarTraslado({
        origenId: ubicacionFalabellaId,
        destinoId: bodegaId,
        motivoTrasladoId: motivoId,
        lineas: [{ itemId, cantidad: '1' }],
      });
      const comoOrigenInexistente = await intentarTraslado({
        origenId: inexistente,
        destinoId: bodegaId,
        motivoTrasladoId: motivoId,
        lineas: [{ itemId, cantidad: '1' }],
      });
      expect(comoOrigenAjeno.status).toBe(404);
      // El mensaje es literalmente el mismo: no hay forma de distinguir "es de
      // otro tenant" de "no existe" — sería un oráculo.
      expect(comoOrigenAjeno.message).toBe(comoOrigenInexistente.message);

      const comoDestinoAjeno = await intentarTraslado({
        origenId: localId,
        destinoId: ubicacionFalabellaId,
        motivoTrasladoId: motivoId,
        lineas: [{ itemId, cantidad: '1' }],
      });
      const comoDestinoInexistente = await intentarTraslado({
        origenId: localId,
        destinoId: inexistente,
        motivoTrasladoId: motivoId,
        lineas: [{ itemId, cantidad: '1' }],
      });
      expect(comoDestinoAjeno.status).toBe(404);
      expect(comoDestinoAjeno.message).toBe(comoDestinoInexistente.message);
    }, 30000);

    it('un motivoTrasladoId de otro tenant da el mismo 400 opaco que uno inexistente', async () => {
      const itemId = await crearProducto('3');
      const inexistente = '00000000-0000-4000-8000-000000000000';

      const conAjeno = await intentarTraslado({
        origenId: localId,
        destinoId: bodegaId,
        motivoTrasladoId: motivoFalabellaId,
        lineas: [{ itemId, cantidad: '1' }],
      });
      const conInexistente = await intentarTraslado({
        origenId: localId,
        destinoId: bodegaId,
        motivoTrasladoId: inexistente,
        lineas: [{ itemId, cantidad: '1' }],
      });
      expect(conAjeno.status).toBe(400);
      expect(conAjeno.message).toBe(conInexistente.message);
    }, 30000);

    it('GET /traslados/:id de un traslado de otro tenant → 404', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/traslados/${trasladoFalabellaId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });

    it('POST /traslados sin el permiso Inventario/Crear → 403', async () => {
      const itemId = await crearProducto('3');
      const res = await request(app.getHttpServer())
        .post('/api/traslados')
        .set('Authorization', `Bearer ${tokenSinPermiso}`)
        .send({
          origenId: localId,
          destinoId: bodegaId,
          motivoTrasladoId: motivoId,
          lineas: [{ itemId, cantidad: '1' }],
        });
      expect(res.status).toBe(403);
    }, 30000);

    it('GET /traslados y GET /traslados/:id sin el permiso Inventario/Leer → 403', async () => {
      const resLista = await request(app.getHttpServer())
        .get('/api/traslados')
        .set('Authorization', `Bearer ${tokenSinPermiso}`);
      expect(resLista.status).toBe(403);

      const resDetalle = await request(app.getHttpServer())
        .get(`/api/traslados/${trasladoFalabellaId}`)
        .set('Authorization', `Bearer ${tokenSinPermiso}`);
      expect(resDetalle.status).toBe(403);
    });
  });

  // Los dos campos de ubicación de `CreateTrasladoDto`, cada uno por su lado.
  // El `describe` de arriba prueba que un id AJENO da 404; que el campo sea
  // OBLIGATORIO lo sostiene el `@IsUUID()` sin `@IsOptional()`, y eso solo corre
  // dentro del `ValidationPipe` — un test de DTO con `plainToInstance` +
  // `validate` dispara los decoradores pero no el pipe, así que la única red del
  // "requerido" es un e2e por HTTP.
  //
  // Son dos casos porque son dos campos, y cada uno lo mata su propio mutante
  // por el STATUS: sacarle el `@IsUUID()` a `destinoId` deja pasar el pipe
  // —`whitelist: true` descarta la propiedad sin decoradores— y el caso «sin
  // destinoId» termina en 404, en el `if (!origen || !destino)` que sigue al
  // `SELECT … FOR SHARE` de `create`. Medido el 2026-09-07. La aserción sobre
  // el mensaje compra otra cosa: que el caso no pase por la razón equivocada,
  // con un 400 que venga de otro campo del mismo body.
  describe('los dos campos de ubicación son obligatorios', () => {
    it('POST /traslados sin origenId → 400, y el 400 es por origenId', async () => {
      const itemId = await crearProducto('2');

      const res = await intentarTraslado({
        destinoId: bodegaId,
        motivoTrasladoId: motivoId,
        lineas: [{ itemId, cantidad: '1' }],
      });

      expect(res.status).toBe(400);
      expect(res.message).toContain('origenId');
      expect(res.message).not.toContain('destinoId');
    }, 30000);

    it('POST /traslados sin destinoId → 400, y el 400 es por destinoId', async () => {
      const itemId = await crearProducto('2');

      const res = await intentarTraslado({
        origenId: localId,
        motivoTrasladoId: motivoId,
        lineas: [{ itemId, cantidad: '1' }],
      });

      expect(res.status).toBe(400);
      expect(res.message).toContain('destinoId');
      expect(res.message).not.toContain('origenId');
    }, 30000);
  });
});
