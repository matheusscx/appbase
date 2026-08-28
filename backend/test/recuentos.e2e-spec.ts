import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const FALABELLA_TENANT_ID = '550e8400-e29b-41d4-a716-446655440040';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';
// `contacto@falabella.cl` no es un usuario logueable; el admin real de
// Falabella es el superadmin con rol Administrador asignado en ese tenant.
const ADMIN_FALABELLA_EMAIL = 'admin@sistema.com';
const ADMIN_FALABELLA_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface MotivoDiferenciaInventarioItem {
  id: string;
  nombre: string;
  activo: boolean;
  esFijo: boolean;
}
interface ItemResponse {
  id: string;
  stock: string | null;
}
interface RecuentoCreateResponse {
  id: string;
}
interface RecuentoLinea {
  lineaId: string;
  itemId: string;
  stockSistema: string;
  cantidadContada: string | null;
  diferencia: string | null;
  motivoDiferenciaId: string | null;
}
interface RecuentoDetalleResponse {
  id: string;
  estado: string;
  lineas: RecuentoLinea[];
}
interface RecuentoListItem {
  id: string;
  cantidadLineas: number;
  diferenciaNeta: string;
}
interface RecuentoAplicarResponse {
  recuentoId: string;
  lineasAplicadas: number;
  lineasDescartadas: { itemId: string; itemNombre: string; razon: string }[];
}
interface MovimientoListItem {
  motivo: string;
  motivoDiferenciaId: string | null;
}

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  expect(resLogin.status).toBe(200);
  const initialToken = (resLogin.body as TokenResponse).access_token;

  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  expect(resTenant.status).toBe(200);
  return (resTenant.body as TokenResponse).access_token;
}

/** Login como cualquier usuario de Paris, para los roles no-admin del seed. */
async function loginParisComo(
  app: INestApplication<App>,
  email: string,
): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: 'admin' });
  expect(resLogin.status).toBe(200);
  const initialToken = (resLogin.body as TokenResponse).access_token;

  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
  expect(resTenant.status).toBe(200);
  return (resTenant.body as TokenResponse).access_token;
}

async function loginFalabella(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_FALABELLA_EMAIL, password: ADMIN_FALABELLA_PASS });
  expect(resLogin.status).toBe(200);
  const initialToken = (resLogin.body as TokenResponse).access_token;

  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set(
      'Cookie',
      (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
    )
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: FALABELLA_TENANT_ID });
  expect(resTenant.status).toBe(200);
  return (resTenant.body as TokenResponse).access_token;
}

describe('Recuentos — catálogo de motivos de diferencia (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `switch-tenant` y `refresh` leen `req.cookies`, y `cookieParser` vive en
    // `main.ts`, que el e2e no ejecuta. Sin esto los dos cortan con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    token = await login(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /motivos-diferencia-inventario trae las 6 causas fijas del seed', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/api/motivos-diferencia-inventario')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const nombres = (body as MotivoDiferenciaInventarioItem[]).map(
      (m) => m.nombre,
    );
    expect(nombres).toEqual(
      expect.arrayContaining([
        'Merma no declarada',
        'Robo',
        'Error de recepción',
        'Error de registro',
        'Sobre-porcionado',
        'Otro',
      ]),
    );
    expect(
      (body as MotivoDiferenciaInventarioItem[]).filter((m) => m.esFijo),
    ).toHaveLength(6);
  });

  it('PATCH sobre una causa fija devuelve 400', async () => {
    const { body: lista } = await request(app.getHttpServer())
      .get('/api/motivos-diferencia-inventario')
      .set('Authorization', `Bearer ${token}`);
    const fija = (lista as MotivoDiferenciaInventarioItem[]).find(
      (m) => m.esFijo,
    )!;

    await request(app.getHttpServer())
      .patch(`/api/motivos-diferencia-inventario/${fija.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Renombrada' })
      .expect(400);
  });

  it('DELETE sobre una causa fija devuelve 400', async () => {
    const { body: lista } = await request(app.getHttpServer())
      .get('/api/motivos-diferencia-inventario')
      .set('Authorization', `Bearer ${token}`);
    const fija = (lista as MotivoDiferenciaInventarioItem[]).find(
      (m) => m.esFijo,
    )!;

    await request(app.getHttpServer())
      .delete(`/api/motivos-diferencia-inventario/${fija.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('POST crea un motivo custom y DELETE lo elimina', async () => {
    const { body: creado } = await request(app.getHttpServer())
      .post('/api/motivos-diferencia-inventario')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Ajuste de conteo por lote' })
      .expect(201);
    const custom = creado as MotivoDiferenciaInventarioItem;
    expect(custom.esFijo).toBe(false);

    await request(app.getHttpServer())
      .delete(`/api/motivos-diferencia-inventario/${custom.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });

  // El tercero de los tres DTOs gemelos que dejaban dejar un catálogo sin
  // nombre. `@IsNotEmpty()` caza `''` pero no `'   '`; el `@Transform` que
  // trimea antes de validar caza los dos. Sin esto, el motivo quedaba con el
  // nombre en blanco en el override de línea de `recuentos/[id].vue`.
  // Va en su propio `it` —con su propio motivo— en vez de colgarse del de
  // arriba: un `it` que afirma creación, validación y borrado no dice cuál de
  // las tres se rompió cuando se pone rojo.
  it('PATCH de un motivo con nombre vacío o de solo espacios → 400', async () => {
    const { body: creado } = await request(app.getHttpServer())
      .post('/api/motivos-diferencia-inventario')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: `Motivo nombre vacío E2E ${Date.now()}` })
      .expect(201);
    const custom = creado as MotivoDiferenciaInventarioItem;

    for (const nombreInvalido of ['', '   ', null]) {
      await request(app.getHttpServer())
        .patch(`/api/motivos-diferencia-inventario/${custom.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ nombre: nombreInvalido })
        .expect(400);
    }

    await request(app.getHttpServer())
      .delete(`/api/motivos-diferencia-inventario/${custom.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });
});

describe('Recuentos — crear, listar y ver una sesión (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let ds: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `switch-tenant` y `refresh` leen `req.cookies`, y `cookieParser` vive en
    // `main.ts`, que el e2e no ejecuta. Sin esto los dos cortan con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    token = await login(app);
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('crea una sesión y congela el stock del sistema en el detalle', async () => {
    // 1. Producto con stock conocido: 10 unidades
    const resCreateItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto recuento E2E ${Date.now()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
      });
    expect(resCreateItem.status).toBe(201);
    const itemId = (resCreateItem.body as ItemResponse).id;

    const resStock = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: '10',
        costoUnitario: '1000',
      });
    expect(resStock.status).toBe(200);

    const resItem = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resItem.status).toBe(200);
    expect((resItem.body as ItemResponse).stock).toBe('10.0000');

    // 2. Crear la sesión de recuento sobre ese producto
    const resCreate = await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemIds: [itemId] });
    expect(resCreate.status).toBe(201);
    const recuentoId = (resCreate.body as RecuentoCreateResponse).id;
    expect(recuentoId).toBeDefined();

    // 3. El detalle congela el stock del sistema, sin cantidad contada aún
    const resDetalle = await request(app.getHttpServer())
      .get(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDetalle.status).toBe(200);
    const detalle = resDetalle.body as RecuentoDetalleResponse;
    expect(detalle.estado).toBe('borrador');
    expect(detalle.lineas).toHaveLength(1);
    expect(detalle.lineas[0].stockSistema).toBe('10.0000');
    expect(detalle.lineas[0].cantidadContada).toBeNull();
    expect(detalle.lineas[0].diferencia).toBeNull();

    // 4. La sesión aparece en el listado del tenant
    const resList = await request(app.getHttpServer())
      .get('/api/recuentos')
      .set('Authorization', `Bearer ${token}`);
    expect(resList.status).toBe(200);
    const lista = resList.body as { data: { id: string }[] };
    expect(lista.data.some((r) => r.id === recuentoId)).toBe(true);
  });

  it('rechaza crear una sesión sobre un item en modo serie', async () => {
    const resCreateItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto serie E2E ${Date.now()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        modoInventario: 'serie',
      });
    expect(resCreateItem.status).toBe(201);
    const itemId = (resCreateItem.body as ItemResponse).id;

    const resCreate = await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemIds: [itemId] });
    expect(resCreate.status).toBe(400);
  });

  it('rechaza itemIds duplicados con 400 (no el 500 crudo del índice único)', async () => {
    const resCreateItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto duplicado E2E ${Date.now()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
      });
    expect(resCreateItem.status).toBe(201);
    const itemId = (resCreateItem.body as ItemResponse).id;

    const resCreate = await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemIds: [itemId, itemId] });
    expect(resCreate.status).toBe(400);
  });

  it('GET /recuentos agrega cantidadLineas y diferenciaNeta con formato NUMERIC(18,4)', async () => {
    // 1. Dos productos con stock conocido: 10 y 6 unidades
    const crearProducto = async (stock: number) => {
      const resCreateItem = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `Producto agregación E2E ${Date.now()}-${stock}`,
          precioBase: '10000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'producto',
        });
      expect(resCreateItem.status).toBe(201);
      const id = (resCreateItem.body as ItemResponse).id;
      await request(app.getHttpServer())
        .patch(`/api/items/${id}/stock`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: String(stock),
          costoUnitario: '1000',
        });
      return id;
    };
    const itemAId = await crearProducto(10);
    const itemBId = await crearProducto(6);

    // 2. Crear la sesión sobre ambos
    const resCreate = await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemIds: [itemAId, itemBId] });
    expect(resCreate.status).toBe(201);
    const recuentoId = (resCreate.body as RecuentoCreateResponse).id;

    // 3. Caso cero: sin conteos cargados, COALESCE(SUM(...), 0) cae en el
    // literal entero — sin Decimal.js/toFixed(4) volvería '0' en vez de
    // '0.0000'.
    const resListaCero = await request(app.getHttpServer())
      .get('/api/recuentos')
      .set('Authorization', `Bearer ${token}`);
    expect(resListaCero.status).toBe(200);
    const filaCero = (
      resListaCero.body as { data: RecuentoListItem[] }
    ).data.find((r) => r.id === recuentoId)!;
    expect(filaCero).toBeDefined();
    expect(filaCero.cantidadLineas).toBe(2);
    expect(filaCero.diferenciaNeta).toBe('0.0000');

    // 4. Cargar conteos directo en la tabla (aún no existe el endpoint de
    // carga — lo agrega la Task 4): itemA contado en 15 (+5), itemB en 6 (0).
    const resDetalle = await request(app.getHttpServer())
      .get(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDetalle.status).toBe(200);
    const lineas = (resDetalle.body as RecuentoDetalleResponse).lineas;
    const lineaA = lineas.find((l) => l.itemId === itemAId)!;
    const lineaB = lineas.find((l) => l.itemId === itemBId)!;
    await ds.query(
      `UPDATE recuento_inventario_linea SET cantidad_contada = $1 WHERE linea_id = $2`,
      ['15', lineaA.lineaId],
    );
    await ds.query(
      `UPDATE recuento_inventario_linea SET cantidad_contada = $1 WHERE linea_id = $2`,
      ['6', lineaB.lineaId],
    );

    // 5. Con conteos cargados: 2 líneas, diferencia neta +5.0000
    const resListaConConteo = await request(app.getHttpServer())
      .get('/api/recuentos')
      .set('Authorization', `Bearer ${token}`);
    expect(resListaConConteo.status).toBe(200);
    const filaConConteo = (
      resListaConConteo.body as { data: RecuentoListItem[] }
    ).data.find((r) => r.id === recuentoId)!;
    expect(filaConConteo.cantidadLineas).toBe(2);
    expect(filaConConteo.diferenciaNeta).toBe('5.0000');
  });

  /**
   * El hallazgo más caro de la auditoría de inventario, con su escenario
   * numérico: stock de sistema 10, dos personas abren su propia sesión y las dos
   * cuentan 8. Cada línea congela su `stock_sistema` al crearse y el ajuste se
   * aplica como **delta relativo**, así que cada sesión guarda −2 y aplicar las
   * dos deja el stock en **6**, no en 8 — el faltante real se descuenta dos
   * veces y se inventa uno que no existió.
   *
   * La doc daba el riesgo por mitigado con un razonamiento que no cierra ("el
   * delta se calcula contra el congelado, así que aplicar ambas en cualquier
   * orden da el mismo resultado"): es cierto y es irrelevante, porque la
   * independencia del orden no es corrección — da el mismo resultado
   * equivocado.
   */
  it('un producto ya en un recuento en borrador no entra en otro', async () => {
    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto doble recuento E2E ${Date.now()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
      });
    expect(resItem.status).toBe(201);
    const itemId = (resItem.body as ItemResponse).id;

    const resStock = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'entrada', motivo: 'compra', cantidad: '10' });
    expect(resStock.status).toBe(200);

    const primera = await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemIds: [itemId] });
    expect(primera.status).toBe(201);
    const primeraId = (primera.body as RecuentoCreateResponse).id;

    const segunda = await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemIds: [itemId] });
    expect(segunda.status).toBe(400);
    // El 400 nombra el producto y la sesión que lo tiene: sin eso el usuario no
    // sabe qué sacar de la lista ni cuál sesión aplicar o cancelar.
    const mensaje = (segunda.body as { message: string }).message;
    expect(mensaje).toContain(primeraId);
    expect(mensaje).toContain('Producto doble recuento E2E');

    // Y la segunda sesión NO se creó a medias.
    const listado = await request(app.getHttpServer())
      .get('/api/recuentos?estado=borrador&pageSize=100')
      .set('Authorization', `Bearer ${token}`);
    expect(listado.status).toBe(200);
    const conEseItem = (listado.body as { data: { id: string }[] }).data.filter(
      (r) => r.id === primeraId,
    );
    expect(conEseItem).toHaveLength(1);

    // Cancelada la primera, el producto vuelve a estar disponible: el bloqueo es
    // por sesión ABIERTA, no un veto permanente.
    await request(app.getHttpServer())
      .post(`/api/recuentos/${primeraId}/cancelar`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const tercera = await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemIds: [itemId] });
    expect(tercera.status).toBe(201);
  });

  /**
   * Con varios productos en conflicto el mensaje los lista **todos**. Quedarse
   * con el primero que devuelva Postgres nombra uno arbitrario, y el usuario lo
   * saca de la lista para chocar de nuevo con el siguiente: el `400` sería
   * correcto y aun así inservible.
   */
  it('con varios productos en conflicto, el 400 los nombra a todos', async () => {
    const crearProducto = async (nombre: string): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `${nombre} ${Date.now()}`,
          precioBase: '10000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'producto',
        });
      expect(res.status).toBe(201);
      return (res.body as ItemResponse).id;
    };

    const itemA = await crearProducto('Conflicto multiple A E2E');
    const itemB = await crearProducto('Conflicto multiple B E2E');

    // Cada uno en su propia sesión abierta: el conflicto viene de DOS sesiones
    // distintas, que es donde quedarse con una sola es más engañoso.
    for (const id of [itemA, itemB]) {
      const res = await request(app.getHttpServer())
        .post('/api/recuentos')
        .set('Authorization', `Bearer ${token}`)
        .send({ itemIds: [id] });
      expect(res.status).toBe(201);
    }

    const res = await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemIds: [itemA, itemB] });
    expect(res.status).toBe(400);

    const mensaje = (res.body as { message: string }).message;
    expect(mensaje).toContain('Conflicto multiple A E2E');
    expect(mensaje).toContain('Conflicto multiple B E2E');
  });

  it('GET /recuentos?estado filtra por estado y descarta el resto', async () => {
    const resCreateItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto filtro-estado E2E ${Date.now()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
      });
    expect(resCreateItem.status).toBe(201);
    const itemId = (resCreateItem.body as ItemResponse).id;

    const resBorrador = await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemIds: [itemId] });
    expect(resBorrador.status).toBe(201);
    const recuentoBorradorId = (resBorrador.body as RecuentoCreateResponse).id;

    // Ítem propio para la sesión que se cancela: un producto no puede estar en
    // dos recuentos en `borrador` a la vez (dos deltas relativos sobre el mismo
    // stock congelado descuentan el faltante dos veces). Este caso prueba el
    // filtro por estado, no esa regla, así que no necesita compartir el ítem.
    const resItemCancelado = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto filtro-estado cancelado E2E ${Date.now()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
      });
    expect(resItemCancelado.status).toBe(201);
    const itemCanceladoId = (resItemCancelado.body as ItemResponse).id;

    const resParaCancelar = await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemIds: [itemCanceladoId] });
    expect(resParaCancelar.status).toBe(201);
    const recuentoCanceladoId = (resParaCancelar.body as RecuentoCreateResponse)
      .id;
    await request(app.getHttpServer())
      .post(`/api/recuentos/${recuentoCanceladoId}/cancelar`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const resFiltroBorrador = await request(app.getHttpServer())
      .get('/api/recuentos?estado=borrador')
      .set('Authorization', `Bearer ${token}`);
    expect(resFiltroBorrador.status).toBe(200);
    const idsBorrador = (
      resFiltroBorrador.body as { data: { id: string }[] }
    ).data.map((r) => r.id);
    expect(idsBorrador).toContain(recuentoBorradorId);
    expect(idsBorrador).not.toContain(recuentoCanceladoId);

    const resFiltroCancelado = await request(app.getHttpServer())
      .get('/api/recuentos?estado=cancelado')
      .set('Authorization', `Bearer ${token}`);
    expect(resFiltroCancelado.status).toBe(200);
    const idsCancelado = (
      resFiltroCancelado.body as { data: { id: string }[] }
    ).data.map((r) => r.id);
    expect(idsCancelado).toContain(recuentoCanceladoId);
    expect(idsCancelado).not.toContain(recuentoBorradorId);
  });
});

describe('Recuentos — cargar conteos, editar la sesión y cancelar (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let motivoId: string;
  let motivoIdFalabella: string;

  const crearProducto = async (stock: number) => {
    const resCreateItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto carga-conteo E2E ${Date.now()}-${Math.random()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
      });
    expect(resCreateItem.status).toBe(201);
    const id = (resCreateItem.body as ItemResponse).id;
    await request(app.getHttpServer())
      .patch(`/api/items/${id}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: String(stock),
        costoUnitario: '1000',
      });
    return id;
  };

  const crearSesion = async (itemIds: string[]) => {
    const resCreate = await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemIds });
    expect(resCreate.status).toBe(201);
    return (resCreate.body as RecuentoCreateResponse).id;
  };

  const primeraLinea = async (recuentoId: string) => {
    const { body } = await request(app.getHttpServer())
      .get(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`);
    return (body as RecuentoDetalleResponse).lineas[0];
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `switch-tenant` y `refresh` leen `req.cookies`, y `cookieParser` vive en
    // `main.ts`, que el e2e no ejecuta. Sin esto los dos cortan con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    token = await login(app);

    const { body: motivos } = await request(app.getHttpServer())
      .get('/api/motivos-diferencia-inventario')
      .set('Authorization', `Bearer ${token}`);
    motivoId = (motivos as MotivoDiferenciaInventarioItem[]).find(
      (m) => m.esFijo,
    )!.id;

    // Motivo real de OTRO tenant (Falabella) — no un uuid inventado — para
    // cubrir el caso de aislamiento multi-tenant, no solo el inexistente.
    const tokenFalabella = await loginFalabella(app);
    const { body: motivosFalabella } = await request(app.getHttpServer())
      .get('/api/motivos-diferencia-inventario')
      .set('Authorization', `Bearer ${tokenFalabella}`);
    motivoIdFalabella = (
      motivosFalabella as MotivoDiferenciaInventarioItem[]
    ).find((m) => m.esFijo)!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('PATCH de línea guarda la cantidad contada y calcula la diferencia', async () => {
    const itemId = await crearProducto(10);
    const recuentoId = await crearSesion([itemId]);
    const linea = await primeraLinea(recuentoId);

    const res = await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}/lineas/${linea.lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidadContada: '8' });
    expect(res.status).toBe(200);

    const { body } = await request(app.getHttpServer())
      .get(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`);
    const lineaActualizada = (body as RecuentoDetalleResponse).lineas[0];
    expect(lineaActualizada.cantidadContada).toBe('8.0000');
    expect(lineaActualizada.diferencia).toBe('-2.0000');
  });

  it('PATCH de línea rechaza una cantidad negativa con 400', async () => {
    const itemId = await crearProducto(5);
    const recuentoId = await crearSesion([itemId]);
    const linea = await primeraLinea(recuentoId);

    const res = await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}/lineas/${linea.lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidadContada: '-1' });
    expect(res.status).toBe(400);
  });

  it('PATCH de línea rechaza un motivoDiferenciaId de otro tenant o inexistente', async () => {
    const itemId = await crearProducto(5);
    const recuentoId = await crearSesion([itemId]);
    const linea = await primeraLinea(recuentoId);

    const resInexistente = await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}/lineas/${linea.lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        cantidadContada: '3',
        motivoDiferenciaId: '00000000-0000-0000-0000-000000000000',
      });
    expect(resInexistente.status).toBe(400);

    // Motivo real, pero del tenant de Falabella: el aislamiento multi-tenant
    // debe rechazarlo igual que el inexistente, no solo la validez del uuid.
    const resOtroTenant = await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}/lineas/${linea.lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        cantidadContada: '3',
        motivoDiferenciaId: motivoIdFalabella,
      });
    expect(resOtroTenant.status).toBe(400);
  });

  it('PATCH de línea acepta un motivo de diferencia válido del catálogo', async () => {
    const itemId = await crearProducto(5);
    const recuentoId = await crearSesion([itemId]);
    const linea = await primeraLinea(recuentoId);

    const res = await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}/lineas/${linea.lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidadContada: '3', motivoDiferenciaId: motivoId });
    expect(res.status).toBe(200);

    const { body } = await request(app.getHttpServer())
      .get(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`);
    expect((body as RecuentoDetalleResponse).lineas[0].motivoDiferenciaId).toBe(
      motivoId,
    );
  });

  it('PATCH de sesión actualiza el comentario y el motivo por defecto', async () => {
    const itemId = await crearProducto(5);
    const recuentoId = await crearSesion([itemId]);

    const res = await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        comentario: 'Recuento mensual',
        motivoDiferenciaDefaultId: motivoId,
      });
    expect(res.status).toBe(200);

    const { body } = await request(app.getHttpServer())
      .get(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`);
    const detalle = body as RecuentoDetalleResponse & {
      comentario: string | null;
      motivoDiferenciaDefaultId: string | null;
    };
    expect(detalle.comentario).toBe('Recuento mensual');
    expect(detalle.motivoDiferenciaDefaultId).toBe(motivoId);
  });

  // Contra la BD real a propósito: el chequeo de uso es un UNION de tres
  // orígenes y en unit el mock decide la respuesta, así que un branch roto
  // (columna equivocada, WHERE que nunca matchea) pasaría en verde. Acá el
  // único motivo referenciado es el de un recuento en BORRADOR, sin ningún
  // movimiento de kardex: si el branch de recuentos se rompe, el DELETE
  // devuelve 204 y el test falla.
  it('DELETE rechaza una causa referenciada solo por un recuento en borrador', async () => {
    const crearMotivo = async (nombre: string) => {
      const { body } = await request(app.getHttpServer())
        .post('/api/motivos-diferencia-inventario')
        .set('Authorization', `Bearer ${token}`)
        .send({ nombre })
        .expect(201);
      return (body as MotivoDiferenciaInventarioItem).id;
    };

    // a) referenciada como override de una línea
    const motivoLinea = await crearMotivo(`Solo línea ${Date.now()}`);
    const recuentoA = await crearSesion([await crearProducto(5)]);
    const linea = await primeraLinea(recuentoA);
    await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoA}/lineas/${linea.lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidadContada: '4', motivoDiferenciaId: motivoLinea })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/motivos-diferencia-inventario/${motivoLinea}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    // b) referenciada solo como causa por defecto de la sesión
    const motivoDefault = await crearMotivo(`Solo default ${Date.now()}`);
    const recuentoB = await crearSesion([await crearProducto(5)]);
    await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoB}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ motivoDiferenciaDefaultId: motivoDefault })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/motivos-diferencia-inventario/${motivoDefault}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('PATCH de sesión limpia la causa por defecto con null explícito', async () => {
    const itemId = await crearProducto(5);
    const recuentoId = await crearSesion([itemId]);

    await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ motivoDiferenciaDefaultId: motivoId })
      .expect(200);

    const resLimpiar = await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ motivoDiferenciaDefaultId: null });
    expect(resLimpiar.status).toBe(200);

    const { body } = await request(app.getHttpServer())
      .get(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(
      (
        body as RecuentoDetalleResponse & {
          motivoDiferenciaDefaultId: string | null;
        }
      ).motivoDiferenciaDefaultId,
    ).toBeNull();
  });

  it('PATCH de línea limpia el override de causa con null explícito', async () => {
    const itemId = await crearProducto(5);
    const recuentoId = await crearSesion([itemId]);
    const linea = await primeraLinea(recuentoId);

    await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}/lineas/${linea.lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ motivoDiferenciaId: motivoId })
      .expect(200);

    const resLimpiar = await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}/lineas/${linea.lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ motivoDiferenciaId: null });
    expect(resLimpiar.status).toBe(200);

    const { body } = await request(app.getHttpServer())
      .get(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(
      (body as RecuentoDetalleResponse).lineas[0].motivoDiferenciaId,
    ).toBeNull();
  });

  it('POST cancelar deja la sesión en cancelado y bloquea nuevos conteos', async () => {
    const itemId = await crearProducto(5);
    const recuentoId = await crearSesion([itemId]);
    const linea = await primeraLinea(recuentoId);

    const resCancelar = await request(app.getHttpServer())
      .post(`/api/recuentos/${recuentoId}/cancelar`)
      .set('Authorization', `Bearer ${token}`);
    expect(resCancelar.status).toBe(201);

    const { body } = await request(app.getHttpServer())
      .get(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`);
    expect((body as RecuentoDetalleResponse).estado).toBe('cancelado');

    const resPatch = await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}/lineas/${linea.lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidadContada: '1' });
    expect(resPatch.status).toBe(400);
  });
});

describe('Recuentos — aplicar (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let motivoId: string;

  const crearProducto = async (stock: number) => {
    const resCreateItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto aplicar E2E ${Date.now()}-${Math.random()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
      });
    expect(resCreateItem.status).toBe(201);
    const id = (resCreateItem.body as ItemResponse).id;
    await request(app.getHttpServer())
      .patch(`/api/items/${id}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: String(stock),
        costoUnitario: '1000',
      });
    return id;
  };

  const crearSesion = async (itemIds: string[]) => {
    const resCreate = await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemIds });
    expect(resCreate.status).toBe(201);
    return (resCreate.body as RecuentoCreateResponse).id;
  };

  const primeraLinea = async (recuentoId: string) => {
    const { body } = await request(app.getHttpServer())
      .get(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`);
    return (body as RecuentoDetalleResponse).lineas[0];
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `switch-tenant` y `refresh` leen `req.cookies`, y `cookieParser` vive en
    // `main.ts`, que el e2e no ejecuta. Sin esto los dos cortan con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    token = await login(app);

    const { body: motivos } = await request(app.getHttpServer())
      .get('/api/motivos-diferencia-inventario')
      .set('Authorization', `Bearer ${token}`);
    motivoId = (motivos as MotivoDiferenciaInventarioItem[]).find(
      (m) => m.esFijo,
    )!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('aplica una salida y descuenta stock cuando el contado es menor al sistema', async () => {
    const id = await crearProducto(100);
    const recuentoId = await crearSesion([id]);
    const linea = await primeraLinea(recuentoId);

    await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}/lineas/${linea.lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidadContada: '90', motivoDiferenciaId: motivoId })
      .expect(200);

    const resAplicar = await request(app.getHttpServer())
      .post(`/api/recuentos/${recuentoId}/aplicar`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const aplicado = resAplicar.body as RecuentoAplicarResponse;
    expect(aplicado.lineasAplicadas).toBe(1);
    expect(aplicado.lineasDescartadas).toEqual([]);

    const { body: item } = await request(app.getHttpServer())
      .get(`/api/items/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((item as ItemResponse).stock).toBe('90.0000');

    const { body: detalle } = await request(app.getHttpServer())
      .get(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((detalle as RecuentoDetalleResponse).estado).toBe('aplicado');
  });

  it('rechaza aplicar una sesión ya aplicada', async () => {
    const id = await crearProducto(10);
    const recuentoId = await crearSesion([id]);
    const linea = await primeraLinea(recuentoId);
    await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}/lineas/${linea.lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidadContada: '8', motivoDiferenciaId: motivoId })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/recuentos/${recuentoId}/aplicar`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const resSegundaVez = await request(app.getHttpServer())
      .post(`/api/recuentos/${recuentoId}/aplicar`)
      .set('Authorization', `Bearer ${token}`);
    expect(resSegundaVez.status).toBe(400);
  });

  it('rechaza aplicar si hay diferencias sin causa y no mueve stock', async () => {
    const id = await crearProducto(10);
    const recuentoId = await crearSesion([id]);
    const linea = await primeraLinea(recuentoId);
    await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}/lineas/${linea.lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidadContada: '5' })
      .expect(200);

    const resAplicar = await request(app.getHttpServer())
      .post(`/api/recuentos/${recuentoId}/aplicar`)
      .set('Authorization', `Bearer ${token}`);
    expect(resAplicar.status).toBe(400);

    const { body: item } = await request(app.getHttpServer())
      .get(`/api/items/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((item as ItemResponse).stock).toBe('10.0000');
  });

  it('aplica el delta sobre el stock vigente, no el contado (venta entre contar y aplicar), y el movimiento lleva motivo recuento y su causa', async () => {
    // 1. Producto con stock 1000; crear recuento congela stock_sistema = 1000.
    const id = await crearProducto(1000);
    const recuentoId = await crearSesion([id]);
    const linea = await primeraLinea(recuentoId);

    // 2. Cargar cantidadContada = 900 → delta -100.
    await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}/lineas/${linea.lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidadContada: '900', motivoDiferenciaId: motivoId })
      .expect(200);

    // 3. Vender/ajustar 200 fuera del recuento → stock vigente 800.
    await request(app.getHttpServer())
      .patch(`/api/items/${id}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'salida', motivo: 'ajuste_manual', cantidad: '200' })
      .expect(200);

    // 4. Aplicar. Esperado: 800 - 100 = 700 (si seteara el absoluto daría 900).
    await request(app.getHttpServer())
      .post(`/api/recuentos/${recuentoId}/aplicar`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const { body: detalle } = await request(app.getHttpServer())
      .get(`/api/items/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(new Decimal((detalle as ItemResponse).stock!).toFixed(4)).toBe(
      '700.0000',
    );

    // 5. El movimiento generado en el kardex lleva motivo='recuento' y su causa.
    const { body: kardex } = await request(app.getHttpServer())
      .get(`/api/inventario/movimientos?itemId=${id}&motivo=recuento`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const data = (kardex as { data: MovimientoListItem[] }).data;
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].motivo).toBe('recuento');
    expect(data[0].motivoDiferenciaId).toBeTruthy();
  });

  it('limpiar el override de línea con null hace que aplicar use la causa por defecto de la sesión', async () => {
    const id = await crearProducto(50);
    const recuentoId = await crearSesion([id]);
    const linea = await primeraLinea(recuentoId);

    // Otra causa fija distinta de motivoId, para distinguir cuál quedó aplicada.
    const { body: motivos } = await request(app.getHttpServer())
      .get('/api/motivos-diferencia-inventario')
      .set('Authorization', `Bearer ${token}`);
    const motivoDefaultId = (motivos as MotivoDiferenciaInventarioItem[]).find(
      (m) => m.esFijo && m.id !== motivoId,
    )!.id;

    // 1. Causa por defecto de la sesión + override de línea con otra causa.
    await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ motivoDiferenciaDefaultId: motivoDefaultId })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}/lineas/${linea.lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cantidadContada: '45', motivoDiferenciaId: motivoId })
      .expect(200);

    // 2. Limpiar el override con null explícito.
    await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}/lineas/${linea.lineaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ motivoDiferenciaId: null })
      .expect(200);

    // 3. Aplicar: sin override, debe usar la causa por defecto de la sesión.
    await request(app.getHttpServer())
      .post(`/api/recuentos/${recuentoId}/aplicar`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const { body: kardex } = await request(app.getHttpServer())
      .get(`/api/inventario/movimientos?itemId=${id}&motivo=recuento`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const data = (kardex as { data: MovimientoListItem[] }).data;
    expect(data[0].motivoDiferenciaId).toBe(motivoDefaultId);
  });
});

// La razón de ser del diseño: contar es `Inventario/Crear` y aplicar es
// `Inventario/Actualizar`, para que quien cuenta no sea quien aprueba. Hasta
// jul-2026 esa asimetría no la ejercía NADA —el seed solo tenía admins, que
// tienen los dos permisos— y un bug de UI que le escondía "Aplicar" al
// aprobador pasó los tres gates sin que nada pudiera verlo.
describe('Recuentos — la asimetría contar/aprobar (e2e)', () => {
  let app: INestApplication<App>;
  let tokenContador: string;
  let tokenAprobador: string;
  let itemId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    // `switch-tenant` y `refresh` leen `req.cookies`, y `cookieParser` vive en
    // `main.ts`, que el e2e no ejecuta. Sin esto los dos cortan con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    tokenContador = await loginParisComo(app, 'contador@paris.cl');
    tokenAprobador = await loginParisComo(app, 'aprobador@paris.cl');

    const { body } = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${await login(app)}`)
      .send({
        nombre: `Producto asimetría E2E ${Date.now()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
      });
    itemId = (body as ItemResponse).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('ambos roles leen, pero solo el contador crea la sesión', async () => {
    await request(app.getHttpServer())
      .get('/api/recuentos')
      .set('Authorization', `Bearer ${tokenContador}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/recuentos')
      .set('Authorization', `Bearer ${tokenAprobador}`)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${tokenAprobador}`)
      .send({ itemIds: [itemId] })
      .expect(403);
  });

  it('el contador cuenta y el aprobador aplica; ninguno puede hacer lo del otro', async () => {
    const { body: creado } = await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${tokenContador}`)
      .send({ itemIds: [itemId] })
      .expect(201);
    const recuentoId = (creado as RecuentoCreateResponse).id;

    const { body: detalle } = await request(app.getHttpServer())
      .get(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${tokenContador}`);
    const lineaId = (detalle as RecuentoDetalleResponse).lineas[0].lineaId;

    const { body: motivos } = await request(app.getHttpServer())
      .get('/api/motivos-diferencia-inventario')
      .set('Authorization', `Bearer ${tokenContador}`);
    const motivoId = (motivos as MotivoDiferenciaInventarioItem[])[0].id;

    // El aprobador no puede cargar el conteo…
    await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}/lineas/${lineaId}`)
      .set('Authorization', `Bearer ${tokenAprobador}`)
      .send({ cantidadContada: '9' })
      .expect(403);

    // …y el contador sí.
    await request(app.getHttpServer())
      .patch(`/api/recuentos/${recuentoId}/lineas/${lineaId}`)
      .set('Authorization', `Bearer ${tokenContador}`)
      .send({ cantidadContada: '3', motivoDiferenciaId: motivoId })
      .expect(200);

    // El contador no puede aplicar lo que contó…
    await request(app.getHttpServer())
      .post(`/api/recuentos/${recuentoId}/aplicar`)
      .set('Authorization', `Bearer ${tokenContador}`)
      .expect(403);

    // …y el aprobador sí.
    const { body: aplicado } = await request(app.getHttpServer())
      .post(`/api/recuentos/${recuentoId}/aplicar`)
      .set('Authorization', `Bearer ${tokenAprobador}`)
      .expect(201);
    expect((aplicado as { lineasAplicadas: number }).lineasAplicadas).toBe(1);
  });

  it('ajustar costo es del aprobador, no del contador', async () => {
    await request(app.getHttpServer())
      .post('/api/inventario/ajustes-costo')
      .set('Authorization', `Bearer ${tokenContador}`)
      .send({ itemId, costoNuevo: '500', comentario: 'Corrección' })
      .expect(403);

    await request(app.getHttpServer())
      .post('/api/inventario/ajustes-costo')
      .set('Authorization', `Bearer ${tokenAprobador}`)
      .send({ itemId, costoNuevo: '500', comentario: 'Corrección' })
      .expect(201);
  });
});
