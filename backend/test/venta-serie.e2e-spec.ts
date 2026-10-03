import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { validacionGlobal } from '../src/common/pipes/validacion-global.pipe';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';
import { correrCarrera } from './helpers/carrera';

/**
 * Quien vende elige qué unidad con número de serie sale
 * (`docs/features/inventario-serializado.md`, § «Quién elige qué unidad con serie sale»).
 *
 * La escena que motiva el frente: dos celulares iguales, uno nuevo y otro usado,
 * y el cliente se lleva el usado. Antes la venta elegía sola (la más antigua) y
 * el cajero no podía decir cuál; el sistema descontaba el equivocado y el
 * stock físico y el de la base dejaban de coincidir en silencio.
 *
 * Producto, caja y series son PROPIOS de este archivo: el stock del seed se
 * agota entre corridas locales.
 */
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const BODEGA_SUBSUELO_ID = '550e8400-e29b-41d4-a716-446655440383';
const TURNO_MANANA_ID = '550e8400-e29b-41d4-a716-446655440277';
const ADMIN = { email: 'admin.paris@paris.cl', pass: 'admin' };
// Rol Vendedor del seed: `Ventas:Crear` y su propia caja. Es el segundo cajero
// de la carrera.
const VENDEDOR = { email: 'vendedor@paris.cl', pass: 'admin' };

interface TokenResponse {
  access_token: string;
}
interface IdResponse {
  id: string;
}
interface UnidadResponse {
  id: string;
  serie: string;
  estado: string;
  condicion: string;
}
interface ErrorResponse {
  message: string;
}

async function entrar(
  app: INestApplication<App>,
  usuario: { email: string; pass: string },
): Promise<string> {
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: usuario.email, password: usuario.pass });
  expect(login.status).toBe(200);
  const inicial = (login.body as TokenResponse).access_token;

  const tenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Cookie', (login.headers['set-cookie'] as unknown as string[]) ?? [])
    .set('Authorization', `Bearer ${inicial}`)
    .send({ tenantId: PARIS_TENANT_ID });
  expect(tenant.status).toBe(200);
  return (tenant.body as TokenResponse).access_token;
}

describe('venta — el cajero elige la unidad con serie (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let caja: CajaAbierta;
  let tokenVendedor: string;
  let cajaVendedor: CajaAbierta;
  let localId: string;
  let motivoTrasladoId: string;
  // Mesa y garzón PROPIOS, creados la primera vez que un test necesita una
  // cuenta abierta (`cuentaConLaUnidad`); `null` si ningún test la pidió.
  let salon: { mesaId: string; garzon: { id: string; pin: string } } | null =
    null;
  const cuentasAbiertas: string[] = [];

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
    token = await entrar(app, ADMIN);
    caja = await abrirCaja(app, token, {
      comentario: 'Apertura E2E venta-serie',
    });

    // El segundo cajero necesita su propio cajón: el del admin (`Mostrador`) ya
    // está ocupado por su caja. Sin caja propia, la carrera de abajo no mide el
    // lock de las unidades: dos ventas con la misma caja las serializa
    // `bloquearCajaAbierta` antes de llegar al producto.
    const cajon = await request(app.getHttpServer())
      .post('/api/cajones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `Cajón vendedor venta-serie E2E ${Date.now()}` });
    expect(cajon.status).toBe(201);
    tokenVendedor = await entrar(app, VENDEDOR);
    cajaVendedor = await abrirCaja(app, tokenVendedor, {
      comentario: 'Apertura E2E venta-serie vendedor',
    });

    const local: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones
        WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID],
    );
    localId = local[0].ubicacion_id;

    const motivos = await request(app.getHttpServer())
      .get('/api/motivos-traslado')
      .set('Authorization', `Bearer ${token}`);
    expect(motivos.status).toBe(200);
    motivoTrasladoId = (motivos.body as IdResponse[])[0].id;
  }, 60000);

  afterAll(async () => {
    try {
      // Una cuenta abierta que sobrevive sigue apartando sus unidades y le
      // ensucia el seed a la suite siguiente.
      for (const cuentaId of cuentasAbiertas) {
        await request(app.getHttpServer())
          .post(`/api/cuentas/${cuentaId}/cancelar`)
          .set('Authorization', `Bearer ${token}`)
          .send({});
      }
      if (salon) {
        await request(app.getHttpServer())
          .post('/api/sesiones-garzon/cerrar')
          .set('Authorization', `Bearer ${token}`)
          .send({ garzonId: salon.garzon.id, pin: salon.garzon.pin });
      }
      await cerrarCaja(app, token, caja);
      await cerrarCaja(app, tokenVendedor, cajaVendedor);
    } finally {
      await app.close();
    }
  });

  async function post<T>(url: string, body: Record<string, unknown>) {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body as T;
  }

  /** Un producto nuevo: el de modo cantidad nace con stock, el de serie sin unidades. */
  async function crearProducto(
    modoInventario: 'serie' | 'cantidad',
    nombre: string,
  ): Promise<string> {
    const { id } = await post<IdResponse>('/api/items', {
      nombre,
      tipo: 'producto',
      precioBase: '10000',
      monedaId: CLP_MONEDA_ID,
      modoInventario,
      ...(modoInventario === 'cantidad' ? { stock: '5', costo: '100' } : {}),
    });
    return id;
  }

  async function entrarSeries(
    itemId: string,
    series: { serie: string; condicion: string }[],
  ): Promise<void> {
    const res = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        ubicacionId: localId,
        cantidad: String(series.length),
        series,
      });
    expect(res.status).toBe(200);
  }

  async function unidadesDe(itemId: string): Promise<UnidadResponse[]> {
    const res = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/unidades`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as UnidadResponse[];
  }

  /** Un producto serie con un celular `nuevo` y otro `usado` en el local. */
  async function productoConDosUnidades() {
    const sufijo = `${Date.now()}-${Math.random()}`;
    const nombre = `Celular venta-serie E2E ${sufijo}`;
    const itemId = await crearProducto('serie', nombre);
    await entrarSeries(itemId, [
      { serie: `IMEI-NUEVO-${sufijo}`, condicion: 'nuevo' },
      { serie: `IMEI-USADO-${sufijo}`, condicion: 'usado' },
    ]);
    const unidades = await unidadesDe(itemId);
    return {
      itemId,
      nombre,
      nuevo: unidades.find((u) => u.condicion === 'nuevo')!,
      usado: unidades.find((u) => u.condicion === 'usado')!,
    };
  }

  function vender(
    lineas: Record<string, unknown>[],
    tokenCajero: string = token,
  ): Promise<{ status: number; body: unknown }> {
    return request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${tokenCajero}`)
      .set('Idempotency-Key', randomUUID())
      .send({
        lineas,
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '100000.0000' }],
      })
      .then((r) => ({ status: r.status, body: r.body as unknown }));
  }

  const ventasDelItem = async (itemId: string): Promise<number> => {
    const filas: { n: string }[] = await ds.query(
      `SELECT count(*) AS n FROM venta_detalles WHERE item_id = $1`,
      [itemId],
    );
    return Number(filas[0].n);
  };

  const mensajeDe = (res: { body: unknown }): string =>
    (res.body as ErrorResponse).message;

  it('se vende el usado: queda vendido el usado y disponible el nuevo', async () => {
    const { itemId, nuevo, usado } = await productoConDosUnidades();

    const res = await vender([
      { itemId, cantidad: '1', unidadIds: [usado.id] },
    ]);
    expect(res.status).toBe(201);

    const unidades = await unidadesDe(itemId);
    expect(unidades.find((u) => u.id === usado.id)?.estado).toBe('vendido');
    expect(unidades.find((u) => u.id === nuevo.id)?.estado).toBe('disponible');
  });

  it('sin unidadIds: 400 pidiendo elegir y el stock no se movió', async () => {
    const { itemId, nombre } = await productoConDosUnidades();

    const res = await vender([{ itemId, cantidad: '1' }]);

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe(
      `Elegí qué unidades salen: «${nombre}» tiene número de serie`,
    );
    const unidades = await unidadesDe(itemId);
    expect(unidades.map((u) => u.estado)).toEqual(['disponible', 'disponible']);
    expect(await ventasDelItem(itemId)).toBe(0);
  });

  it('unidadIds vacío: mismo 400 que sin ellas', async () => {
    const { itemId, nombre } = await productoConDosUnidades();

    const res = await vender([{ itemId, cantidad: '1', unidadIds: [] }]);

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe(
      `Elegí qué unidades salen: «${nombre}» tiene número de serie`,
    );
  });

  it('cantidad 2 con una sola unidad: 400 y no vende', async () => {
    const { itemId, nombre, usado } = await productoConDosUnidades();

    const res = await vender([
      { itemId, cantidad: '2', unidadIds: [usado.id] },
    ]);

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe(
      `«${nombre}»: la cantidad (2) no coincide con las unidades elegidas (1)`,
    );
    expect(await ventasDelItem(itemId)).toBe(0);
  });

  it('cantidad fraccionaria: 400 y no vende', async () => {
    const { itemId, nombre, usado } = await productoConDosUnidades();

    const res = await vender([
      { itemId, cantidad: '1.5', unidadIds: [usado.id] },
    ]);

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe(
      `«${nombre}»: la cantidad (1.5) no coincide con las unidades elegidas (1)`,
    );
    expect(await ventasDelItem(itemId)).toBe(0);
  });

  it('la misma unidad en dos líneas del carrito: 400 y no vende', async () => {
    const { itemId, usado } = await productoConDosUnidades();

    const res = await vender([
      { itemId, cantidad: '1', unidadIds: [usado.id] },
      { itemId, cantidad: '1', unidadIds: [usado.id] },
    ]);

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe('Una unidad viene repetida en la venta');
    expect(await ventasDelItem(itemId)).toBe(0);
  });

  it('la misma unidad repetida dentro de UNA línea: 400 y no vende', async () => {
    const { itemId, usado } = await productoConDosUnidades();

    const res = await vender([
      { itemId, cantidad: '2', unidadIds: [usado.id, usado.id] },
    ]);

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe('Una unidad viene repetida en la venta');
    const unidades = await unidadesDe(itemId);
    expect(unidades.map((u) => u.estado)).toEqual(['disponible', 'disponible']);
    expect(await ventasDelItem(itemId)).toBe(0);
  });

  it('unidadIds en un producto de modo cantidad: 400 y no vende', async () => {
    const { usado } = await productoConDosUnidades();
    const nombre = `Producto cantidad venta-serie E2E ${Date.now()}`;
    const cantidadId = await crearProducto('cantidad', nombre);

    const res = await vender([
      { itemId: cantidadId, cantidad: '1', unidadIds: [usado.id] },
    ]);

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe(
      `«${nombre}» no tiene número de serie: no lleva unidades`,
    );
    expect(await ventasDelItem(cantidadId)).toBe(0);
  });

  it('una unidad de otro producto: 400 y la unidad sigue disponible', async () => {
    const a = await productoConDosUnidades();
    const b = await productoConDosUnidades();

    const res = await vender([
      { itemId: a.itemId, cantidad: '1', unidadIds: [b.usado.id] },
    ]);

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toContain('no pertenece a este producto');
    const deB = await unidadesDe(b.itemId);
    expect(deB.find((u) => u.id === b.usado.id)?.estado).toBe('disponible');
    expect(await ventasDelItem(a.itemId)).toBe(0);
  });

  it('una unidad que está en la bodega: 400 nombrando dónde está', async () => {
    const { itemId, usado } = await productoConDosUnidades();
    const traslado = await request(app.getHttpServer())
      .post('/api/traslados')
      .set('Authorization', `Bearer ${token}`)
      .send({
        origenId: localId,
        destinoId: BODEGA_SUBSUELO_ID,
        motivoTrasladoId,
        lineas: [{ itemId, cantidad: '1', unidadIds: [usado.id] }],
      });
    expect(traslado.status).toBe(201);
    const bodega: { nombre: string }[] = await ds.query(
      `SELECT nombre FROM ubicaciones WHERE ubicacion_id = $1`,
      [BODEGA_SUBSUELO_ID],
    );

    const res = await vender([
      { itemId, cantidad: '1', unidadIds: [usado.id] },
    ]);

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toContain(usado.serie);
    expect(mensajeDe(res)).toContain(bodega[0].nombre);
    expect(await ventasDelItem(itemId)).toBe(0);
  });

  it('una línea con serie en una presentación que no es la unidad base: 400', async () => {
    // Base en kilos, vendida en gramos: la conversión es válida para un
    // producto por cantidad, pero una unidad serializada no se parte.
    const sufijo = `${Date.now()}-${Math.random()}`;
    const { id: itemId } = await post<IdResponse>('/api/items', {
      nombre: `Celular presentación venta-serie E2E ${sufijo}`,
      tipo: 'producto',
      precioBase: '10000',
      monedaId: CLP_MONEDA_ID,
      modoInventario: 'serie',
      unidadMedida: 'kg',
    });
    await entrarSeries(itemId, [
      { serie: `IMEI-PRES-${sufijo}`, condicion: 'nuevo' },
    ]);
    const [unidad] = await unidadesDe(itemId);

    const res = await vender([
      {
        itemId,
        cantidad: '1',
        cantidadPresentacion: '1000',
        unidadCodigoPresentacion: 'g',
        unidadIds: [unidad.id],
      },
    ]);

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe(
      'Los productos por serie o lote solo admiten su unidad base',
    );
    expect(await ventasDelItem(itemId)).toBe(0);
  });

  it('carrera: dos cajeros con caja propia venden la misma unidad: exactamente una 201 y una 400, sin 500', async () => {
    // Cajas distintas A PROPÓSITO: con la misma caja, `bloquearCajaAbierta`
    // serializa las dos ventas antes de que lleguen al producto y la carrera no
    // mide el lock de `item_producto` ni el de las unidades. Acá cada venta toma
    // su caja sin esperar a la otra y las dos se encuentran en el producto.
    const activa = async (t: string) =>
      (
        (
          await request(app.getHttpServer())
            .get('/api/caja/activa')
            .set('Authorization', `Bearer ${t}`)
        ).body as { id: string }
      ).id;
    const [cajaAdmin, cajaDelVendedor] = [
      await activa(token),
      await activa(tokenVendedor),
    ];
    expect(cajaAdmin).not.toBe(cajaDelVendedor);

    const { itemId, usado, nuevo } = await productoConDosUnidades();
    const lineas = [{ itemId, cantidad: '1', unidadIds: [usado.id] }];

    const { esperando, respuestas } = await correrCarrera(
      ds,
      [`SELECT 1 FROM item_producto WHERE item_id = $1 FOR UPDATE`, [itemId]],
      [() => vender(lineas, token), () => vender(lineas, tokenVendedor)],
    );

    expect(esperando).toBe(2);
    expect(respuestas.map((r) => r.status).sort()).toEqual([201, 400]);
    const unidades = await unidadesDe(itemId);
    expect(unidades.find((u) => u.id === usado.id)?.estado).toBe('vendido');
    expect(unidades.find((u) => u.id === nuevo.id)?.estado).toBe('disponible');
    expect(await ventasDelItem(itemId)).toBe(1);
  }, 60000);

  // ── Configuración: lo que no se puede vender sin elegir unidad no se deja armar ──

  /** Un producto de modo cantidad SIN stock: sin movimientos, así que pasarlo a serie solo lo frena el uso. */
  async function productoSinStock(nombre: string): Promise<string> {
    const { id } = await post<IdResponse>('/api/items', {
      nombre,
      tipo: 'producto',
      precioBase: '10000',
      monedaId: CLP_MONEDA_ID,
      modoInventario: 'cantidad',
    });
    return id;
  }

  const crearCombo = (nombre: string, componenteItemId: string) =>
    request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre,
        tipo: 'combo',
        precioBase: '15000',
        monedaId: CLP_MONEDA_ID,
        componentes: [{ componenteItemId, cantidad: '1', bloqueante: true }],
      });

  const crearGrupo = (nombre: string, itemId: string) =>
    request(app.getHttpServer())
      .post('/api/grupos-modificadores')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre,
        opciones: [{ itemId, cantidad: '1', precioExtra: '0' }],
      });

  const pasarASerie = (itemId: string) =>
    request(app.getHttpServer())
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ modoInventario: 'serie' });

  const modoDe = async (itemId: string): Promise<string> => {
    const filas: { modo_inventario: string }[] = await ds.query(
      `SELECT modo_inventario FROM item_producto WHERE item_id = $1`,
      [itemId],
    );
    return filas[0].modo_inventario;
  };

  it('un combo con un producto de serie como componente: 400 y el combo no se crea', async () => {
    const sufijo = `${Date.now()}-${Math.random()}`;
    const nombre = `Celular combo venta-serie E2E ${sufijo}`;
    const serieId = await crearProducto('serie', nombre);
    const nombreCombo = `Combo con serie E2E ${sufijo}`;

    const res = await crearCombo(nombreCombo, serieId);

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe(
      `«${nombre}» tiene número de serie: no puede ser parte de un combo`,
    );
    const creados: { n: string }[] = await ds.query(
      `SELECT count(*) AS n FROM items WHERE nombre = $1`,
      [nombreCombo],
    );
    expect(Number(creados[0].n)).toBe(0);
  });

  it('un grupo con un producto de serie como opción vendible: 400 y el grupo no se crea', async () => {
    const sufijo = `${Date.now()}-${Math.random()}`;
    const nombre = `Celular grupo venta-serie E2E ${sufijo}`;
    const serieId = await crearProducto('serie', nombre);
    const nombreGrupo = `Grupo con serie E2E ${sufijo}`;

    const res = await crearGrupo(nombreGrupo, serieId);

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe(
      `«${nombre}» tiene número de serie: no puede ser opción de un grupo`,
    );
    const creados: { n: string }[] = await ds.query(
      `SELECT count(*) AS n FROM grupos_modificadores WHERE nombre = $1`,
      [nombreGrupo],
    );
    expect(Number(creados[0].n)).toBe(0);
  });

  it('pasar a serie un producto que es componente de un combo vivo: 400 y el modo no cambia', async () => {
    const sufijo = `${Date.now()}-${Math.random()}`;
    const nombre = `Cargador combo venta-serie E2E ${sufijo}`;
    const itemId = await productoSinStock(nombre);
    const combo = await crearCombo(`Combo vivo E2E ${sufijo}`, itemId);
    expect(combo.status).toBe(201);

    const res = await pasarASerie(itemId);

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe(
      `«${nombre}» es parte de un combo o grupo: no puede pasar a número de serie`,
    );
    expect(await modoDe(itemId)).toBe('cantidad');
  });

  it('pasar a serie un producto que es opción de un grupo vivo: 400 y el modo no cambia', async () => {
    const sufijo = `${Date.now()}-${Math.random()}`;
    const nombre = `Funda grupo venta-serie E2E ${sufijo}`;
    const itemId = await productoSinStock(nombre);
    const grupo = await crearGrupo(`Grupo vivo E2E ${sufijo}`, itemId);
    expect(grupo.status).toBe(201);

    const res = await pasarASerie(itemId);

    expect(res.status).toBe(400);
    expect(mensajeDe(res)).toBe(
      `«${nombre}» es parte de un combo o grupo: no puede pasar a número de serie`,
    );
    expect(await modoDe(itemId)).toBe('cantidad');
  });

  it('pasar a serie un producto que no es componente ni opción: se puede', async () => {
    const itemId = await productoSinStock(
      `Suelto venta-serie E2E ${Date.now()}-${Math.random()}`,
    );

    const res = await pasarASerie(itemId);

    expect(res.status).toBe(200);
    expect(await modoDe(itemId)).toBe('serie');
  });

  // Con el combo o el grupo en la papelera el producto sí puede pasar a serie:
  // `nombreSiEsComponenteVivo` solo cuenta compuestos vivos. Medido sin este
  // freno: restaurar daba 201, el combo se activaba y la venta lo rechazaba con
  // «Elegí qué unidades salen»; el grupo restaurado se asociaba a un combo nuevo
  // y la venta igual. Con unidades cargadas el producto ya no vuelve a modo
  // cantidad, así que el compuesto no se puede recuperar: se arma de nuevo. Sin
  // unidades sí hay vuelta, y es lo que ejercitan los dos tests.
  const restaurar = (ruta: string) =>
    request(app.getHttpServer())
      .post(`/api/${ruta}/restaurar`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

  const borrar = async (ruta: string, status: number) => {
    const res = await request(app.getHttpServer())
      .delete(`/api/${ruta}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(status);
  };

  const sigueEnLaPapelera = async (
    tabla: 'items' | 'grupos_modificadores',
    columnaId: string,
    id: string,
  ): Promise<boolean> => {
    const filas: { borrado: boolean }[] = await ds.query(
      `SELECT eliminado_el IS NOT NULL AS borrado FROM ${tabla} WHERE ${columnaId} = $1`,
      [id],
    );
    return filas[0].borrado;
  };

  const pasarACantidad = (itemId: string) =>
    request(app.getHttpServer())
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ modoInventario: 'cantidad' });

  it('restaurar un combo cuyos componentes pasaron a serie estando en la papelera: 400 nombrando solo esos, y vuelve cuando ninguno tiene serie', async () => {
    const sufijo = `${Date.now()}-${Math.random()}`;
    const audifonos = `Audífonos papelera venta-serie E2E ${sufijo}`;
    const cargador = `Cargador papelera venta-serie E2E ${sufijo}`;
    const audifonosId = await productoSinStock(audifonos);
    const cargadorId = await productoSinStock(cargador);
    const fundaId = await productoSinStock(
      `Funda papelera venta-serie E2E ${sufijo}`,
    );
    // Control: un componente que se sacó ANTES del borrado no vuelve con el
    // combo, así que pasarlo a serie no frena el restaurar.
    const parlanteId = await productoSinStock(
      `Parlante papelera venta-serie E2E ${sufijo}`,
    );
    const componentes = (ids: string[]) =>
      ids.map((componenteItemId) => ({
        componenteItemId,
        cantidad: '1',
        bloqueante: true,
      }));
    const combo = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Combo papelera E2E ${sufijo}`,
        tipo: 'combo',
        precioBase: '15000',
        monedaId: CLP_MONEDA_ID,
        componentes: componentes([
          audifonosId,
          cargadorId,
          fundaId,
          parlanteId,
        ]),
      });
    expect(combo.status).toBe(201);
    const comboId = (combo.body as IdResponse).id;
    const sacar = await request(app.getHttpServer())
      .patch(`/api/items/${comboId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ componentes: componentes([audifonosId, cargadorId, fundaId]) });
    expect(sacar.status).toBe(200);
    await borrar(`items/${comboId}`, 200);
    expect((await pasarASerie(parlanteId)).status).toBe(200);
    expect((await pasarASerie(cargadorId)).status).toBe(200);
    expect((await pasarASerie(audifonosId)).status).toBe(200);

    const dos = await restaurar(`items/${comboId}`);
    expect(dos.status).toBe(400);
    expect(mensajeDe(dos)).toBe(
      `No se puede restaurar: «${audifonos}», «${cargador}» ahora tienen número de serie y un combo no puede incluirlos`,
    );
    expect(await sigueEnLaPapelera('items', 'item_id', comboId)).toBe(true);

    // Sin movimientos, el producto todavía puede volver a cantidad.
    expect((await pasarACantidad(audifonosId)).status).toBe(200);
    const uno = await restaurar(`items/${comboId}`);
    expect(uno.status).toBe(400);
    expect(mensajeDe(uno)).toBe(
      `No se puede restaurar: «${cargador}» ahora tiene número de serie y un combo no puede incluirlo`,
    );

    expect((await pasarACantidad(cargadorId)).status).toBe(200);
    expect((await restaurar(`items/${comboId}`)).status).toBe(201);
  });

  it('restaurar un grupo cuyas opciones pasaron a serie estando en la papelera: 400 nombrando solo esas, y vuelve cuando ninguna tiene serie', async () => {
    const sufijo = `${Date.now()}-${Math.random()}`;
    const audifonos = `Audífonos grupo papelera E2E ${sufijo}`;
    const cargador = `Cargador grupo papelera E2E ${sufijo}`;
    const audifonosId = await productoSinStock(audifonos);
    const cargadorId = await productoSinStock(cargador);
    const fundaId = await productoSinStock(
      `Funda grupo papelera E2E ${sufijo}`,
    );
    // Control: una opción que se sacó ANTES del borrado no revive con el
    // grupo, así que pasarla a serie no frena el restaurar.
    const parlanteId = await productoSinStock(
      `Parlante grupo papelera E2E ${sufijo}`,
    );
    const opciones = (ids: string[]) =>
      ids.map((itemId) => ({ itemId, cantidad: '1', precioExtra: '0' }));
    const grupo = await request(app.getHttpServer())
      .post('/api/grupos-modificadores')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Grupo papelera E2E ${sufijo}`,
        opciones: opciones([audifonosId, cargadorId, fundaId, parlanteId]),
      });
    expect(grupo.status).toBe(201);
    const grupoId = (grupo.body as { grupoModificadorId: string })
      .grupoModificadorId;
    const sacar = await request(app.getHttpServer())
      .patch(`/api/grupos-modificadores/${grupoId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ opciones: opciones([audifonosId, cargadorId, fundaId]) });
    expect(sacar.status).toBe(200);
    await borrar(`grupos-modificadores/${grupoId}`, 204);
    expect((await pasarASerie(parlanteId)).status).toBe(200);
    expect((await pasarASerie(cargadorId)).status).toBe(200);
    expect((await pasarASerie(audifonosId)).status).toBe(200);
    const enLaPapelera = () =>
      sigueEnLaPapelera(
        'grupos_modificadores',
        'grupo_modificador_id',
        grupoId,
      );

    const dos = await restaurar(`grupos-modificadores/${grupoId}`);
    expect(dos.status).toBe(400);
    expect(mensajeDe(dos)).toBe(
      `No se puede restaurar: «${audifonos}», «${cargador}» ahora tienen número de serie y un grupo no puede ofrecerlos`,
    );
    expect(await enLaPapelera()).toBe(true);

    expect((await pasarACantidad(audifonosId)).status).toBe(200);
    const uno = await restaurar(`grupos-modificadores/${grupoId}`);
    expect(uno.status).toBe(400);
    expect(mensajeDe(uno)).toBe(
      `No se puede restaurar: «${cargador}» ahora tiene número de serie y un grupo no puede ofrecerlo`,
    );

    expect((await pasarACantidad(cargadorId)).status).toBe(200);
    expect((await restaurar(`grupos-modificadores/${grupoId}`)).status).toBe(
      201,
    );
    expect(await enLaPapelera()).toBe(false);
  });

  // Carrera restaurar ↔ pasar a serie. El restaurar toma `FOR SHARE` sobre el
  // producto y lee el modo en un statement POSTERIOR; el paso a serie toma
  // `FOR NO KEY UPDATE` sobre el mismo producto antes de mirar si es componente
  // vivo. Gane quien gane, nunca terminan los dos en 2xx: eso dejaría un combo o
  // un grupo vivo con un producto con serie adentro.
  const respuesta = (t: request.Test) =>
    t.then((r) => ({ status: r.status, body: r.body as unknown }));

  async function comboEnLaPapeleraCon(
    componenteItemId: string,
  ): Promise<string> {
    const combo = await crearCombo(
      `Combo carrera papelera E2E ${Date.now()}-${Math.random()}`,
      componenteItemId,
    );
    expect(combo.status).toBe(201);
    const comboId = (combo.body as IdResponse).id;
    await borrar(`items/${comboId}`, 200);
    return comboId;
  }

  it('carrera: el paso a serie gana y el restaurar del combo espera y rebota con 400', async () => {
    const nombre = `Cargador carrera venta-serie E2E ${Date.now()}-${Math.random()}`;
    const itemId = await productoSinStock(nombre);
    const comboId = await comboEnLaPapeleraCon(itemId);

    // El paso a serie toma el producto y DESPUÉS lockea `item_producto`: la
    // compuerta retiene esa fila, con el producto ya tomado.
    const {
      esperando,
      respuestas: [serie, restaurado],
    } = await correrCarrera(
      ds,
      [`SELECT 1 FROM item_producto WHERE item_id = $1 FOR UPDATE`, [itemId]],
      [
        () => respuesta(pasarASerie(itemId)),
        () => respuesta(restaurar(`items/${comboId}`)),
      ],
      { escalonarMs: 800 },
    );

    expect({
      esperando,
      serie: serie.status,
      restaurar: restaurado.status,
    }).toEqual({ esperando: 2, serie: 200, restaurar: 400 });
    expect(mensajeDe(restaurado)).toContain(`«${nombre}»`);
    expect(await sigueEnLaPapelera('items', 'item_id', comboId)).toBe(true);
  }, 60000);

  it('carrera: el restaurar del combo gana y el paso a serie espera y rebota con 400', async () => {
    const itemId = await productoSinStock(
      `Cargador carrera venta-serie E2E ${Date.now()}-${Math.random()}`,
    );
    const comboId = await comboEnLaPapeleraCon(itemId);

    // El restaurar toma lo que compone el combo y DESPUÉS revive la fila del
    // combo: la compuerta retiene esa.
    const {
      esperando,
      respuestas: [restaurado, serie],
    } = await correrCarrera(
      ds,
      [`SELECT 1 FROM items WHERE item_id = $1 FOR UPDATE`, [comboId]],
      [
        () => respuesta(restaurar(`items/${comboId}`)),
        () => respuesta(pasarASerie(itemId)),
      ],
      { escalonarMs: 800 },
    );

    expect({
      esperando,
      restaurar: restaurado.status,
      serie: serie.status,
    }).toEqual({ esperando: 2, restaurar: 201, serie: 400 });
    expect(await modoDe(itemId)).toBe('cantidad');
  }, 60000);

  it('carrera: el paso a serie gana y el restaurar del grupo espera y rebota con 400', async () => {
    const nombre = `Funda carrera venta-serie E2E ${Date.now()}-${Math.random()}`;
    const itemId = await productoSinStock(nombre);
    const grupo = await crearGrupo(
      `Grupo carrera papelera E2E ${Date.now()}-${Math.random()}`,
      itemId,
    );
    expect(grupo.status).toBe(201);
    const grupoId = (grupo.body as { grupoModificadorId: string })
      .grupoModificadorId;
    await borrar(`grupos-modificadores/${grupoId}`, 204);

    const {
      esperando,
      respuestas: [serie, restaurado],
    } = await correrCarrera(
      ds,
      [`SELECT 1 FROM item_producto WHERE item_id = $1 FOR UPDATE`, [itemId]],
      [
        () => respuesta(pasarASerie(itemId)),
        () => respuesta(restaurar(`grupos-modificadores/${grupoId}`)),
      ],
      { escalonarMs: 800 },
    );

    expect({
      esperando,
      serie: serie.status,
      restaurar: restaurado.status,
    }).toEqual({ esperando: 2, serie: 200, restaurar: 400 });
    expect(mensajeDe(restaurado)).toContain(`«${nombre}»`);
    expect(
      await sigueEnLaPapelera(
        'grupos_modificadores',
        'grupo_modificador_id',
        grupoId,
      ),
    ).toBe(true);
  }, 60000);

  // ── Lecturas: qué unidades se ofrecen y qué serie quedó vendida ──

  /** Lo que el selector de la pantalla pide: solo lo que ESTE local puede vender ahora. */
  async function unidadesVendibles(itemId: string): Promise<UnidadResponse[]> {
    const res = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/unidades?vendibles=true`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as UnidadResponse[];
  }

  /**
   * Abre una cuenta de mesa que tiene la unidad apartada, por el camino real de
   * la API: la línea se pide con `unidadIds`.
   */
  async function cuentaConLaUnidad(
    itemId: string,
    unidadId: string,
  ): Promise<string> {
    if (!salon) {
      const marca = Date.now();
      const garzon = await post<{ id: string; pin: string }>('/api/garzones', {
        nombre: `Garzón venta-serie E2E ${marca}`,
      });
      await post('/api/sesiones-garzon/iniciar', {
        garzonId: garzon.id,
        pin: garzon.pin,
        turnoId: TURNO_MANANA_ID,
      });
      const salonId = (
        await post<IdResponse>('/api/salones', {
          nombre: `Salón venta-serie E2E ${marca}`,
        })
      ).id;
      const mesaId = (
        await post<IdResponse>(`/api/salones/${salonId}/mesas`, {
          nombre: 'Mesa venta-serie',
        })
      ).id;
      salon = { mesaId, garzon };
    }
    const cuenta = await post<IdResponse>(
      `/api/mesas/${salon.mesaId}/cuentas`,
      {
        garzonId: salon.garzon.id,
        pin: salon.garzon.pin,
      },
    );
    cuentasAbiertas.push(cuenta.id);
    await post(`/api/cuentas/${cuenta.id}/lineas`, {
      itemId,
      cantidad: '1',
      unidadIds: [unidadId],
    });
    return cuenta.id;
  }

  it('vendibles=true: solo las disponibles del local y no apartadas, nuevo primero y después por serie', async () => {
    const sufijo = `${Date.now()}-${Math.random()}`;
    const itemId = await crearProducto(
      'serie',
      `Celular vendibles venta-serie E2E ${sufijo}`,
    );
    await entrarSeries(itemId, [
      { serie: `V-A-USADO-${sufijo}`, condicion: 'usado' },
      { serie: `V-B-NUEVO-${sufijo}`, condicion: 'nuevo' },
      { serie: `V-C-REACOND-${sufijo}`, condicion: 'reacondicionado' },
      { serie: `V-D-BODEGA-${sufijo}`, condicion: 'nuevo' },
      { serie: `V-E-MESA-${sufijo}`, condicion: 'nuevo' },
      { serie: `V-F-NUEVO-${sufijo}`, condicion: 'nuevo' },
      { serie: `V-G-VENDIDO-${sufijo}`, condicion: 'nuevo' },
    ]);
    const todas = await unidadesDe(itemId);
    const de = (inicio: string) =>
      todas.find((u) => u.serie.startsWith(inicio))!;

    const traslado = await request(app.getHttpServer())
      .post('/api/traslados')
      .set('Authorization', `Bearer ${token}`)
      .send({
        origenId: localId,
        destinoId: BODEGA_SUBSUELO_ID,
        motivoTrasladoId,
        lineas: [{ itemId, cantidad: '1', unidadIds: [de('V-D').id] }],
      });
    expect(traslado.status).toBe(201);
    await cuentaConLaUnidad(itemId, de('V-E').id);
    const venta = await vender([
      { itemId, cantidad: '1', unidadIds: [de('V-G').id] },
    ]);
    expect(venta.status).toBe(201);

    const vendibles = await unidadesVendibles(itemId);

    expect(vendibles.map((u) => u.serie)).toEqual([
      `V-B-NUEVO-${sufijo}`,
      `V-F-NUEVO-${sufijo}`,
      `V-C-REACOND-${sufijo}`,
      `V-A-USADO-${sufijo}`,
    ]);
    expect(vendibles.every((u) => u.estado === 'disponible')).toBe(true);
    // Las apartadas y las de bodega SIGUEN en la lista de Inventario.
    expect(todas).toHaveLength(7);
  });

  it('sin vendibles el resultado no cambia: trae la de la bodega, la apartada y la vendida', async () => {
    const sufijo = `${Date.now()}-${Math.random()}`;
    const itemId = await crearProducto(
      'serie',
      `Celular sin flag venta-serie E2E ${sufijo}`,
    );
    await entrarSeries(itemId, [
      { serie: `S-A-${sufijo}`, condicion: 'nuevo' },
      { serie: `S-B-${sufijo}`, condicion: 'usado' },
      { serie: `S-C-${sufijo}`, condicion: 'nuevo' },
    ]);
    const todas = await unidadesDe(itemId);
    const de = (inicio: string) =>
      todas.find((u) => u.serie.startsWith(inicio))!;
    await cuentaConLaUnidad(itemId, de('S-B').id);
    const venta = await vender([
      { itemId, cantidad: '1', unidadIds: [de('S-C').id] },
    ]);
    expect(venta.status).toBe(201);

    const sinFlag = await unidadesDe(itemId);
    const conFalse = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/unidades?vendibles=false`)
      .set('Authorization', `Bearer ${token}`);

    expect(sinFlag.map((u) => u.serie).sort()).toEqual([
      `S-A-${sufijo}`,
      `S-B-${sufijo}`,
      `S-C-${sufijo}`,
    ]);
    expect(sinFlag.find((u) => u.serie.startsWith('S-C'))?.estado).toBe(
      'vendido',
    );
    expect(conFalse.status).toBe(200);
    expect(conFalse.body).toEqual(sinFlag);
    expect(Object.keys(sinFlag[0]).sort()).toEqual([
      'codigoLote',
      'condicion',
      'creadoEl',
      'estado',
      'garantiaHasta',
      'id',
      'loteId',
      'serie',
      'ubicacionId',
      'ventaId',
    ]);
  });

  it('vendibles con un valor que no es booleano: 400', async () => {
    const { itemId } = await productoConDosUnidades();

    const res = await request(app.getHttpServer())
      .get(`/api/items/${itemId}/unidades?vendibles=quizas`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('el detalle de la venta trae la serie y la condición vendidas por línea; una línea sin serie trae []', async () => {
    const { itemId, nuevo, usado } = await productoConDosUnidades();
    const cantidadId = await crearProducto(
      'cantidad',
      `Funda detalle venta-serie E2E ${Date.now()}-${Math.random()}`,
    );
    const venta = await vender([
      { itemId, cantidad: '1', unidadIds: [usado.id] },
      { itemId: cantidadId, cantidad: '1' },
    ]);
    expect(venta.status).toBe(201);
    const ventaId = (venta.body as IdResponse).id;

    const res = await request(app.getHttpServer())
      .get(`/api/ventas/${ventaId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const detalles = (
      res.body as {
        detalles: {
          itemId: string;
          cantidad: string;
          unidades: { serie: string; condicion: string }[];
        }[];
      }
    ).detalles;
    expect(detalles).toHaveLength(2);
    expect(detalles.find((d) => d.itemId === itemId)?.unidades).toEqual([
      { serie: usado.serie, condicion: 'usado' },
    ]);
    expect(detalles.find((d) => d.itemId === cantidadId)?.unidades).toEqual([]);
    // La que no se vendió no aparece en ningún lado.
    expect(JSON.stringify(res.body)).not.toContain(nuevo.serie);
  });

  it('el detalle de una venta con dos unidades del mismo producto las lista ordenadas por serie', async () => {
    const { itemId, nuevo, usado } = await productoConDosUnidades();
    const venta = await vender([
      { itemId, cantidad: '2', unidadIds: [usado.id, nuevo.id] },
    ]);
    expect(venta.status).toBe(201);

    const res = await request(app.getHttpServer())
      .get(`/api/ventas/${(venta.body as IdResponse).id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const [linea] = (
      res.body as {
        detalles: { unidades: { serie: string; condicion: string }[] }[];
      }
    ).detalles;
    // `IMEI-NUEVO-…` < `IMEI-USADO-…`: el orden es por serie, no por el orden
    // en que se mandaron en `unidadIds` (usado primero).
    expect(linea.unidades).toEqual([
      { serie: nuevo.serie, condicion: 'nuevo' },
      { serie: usado.serie, condicion: 'usado' },
    ]);
  });
});
