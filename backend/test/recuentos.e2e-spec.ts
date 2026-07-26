import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

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

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  const initialToken = (resLogin.body as TokenResponse).access_token;

  const resTenant = await request(app.getHttpServer())
    .post('/api/auth/switch-tenant')
    .set('Authorization', `Bearer ${initialToken}`)
    .send({ tenantId: PARIS_TENANT_ID });
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
        cantidad: 10,
        costoUnitario: '1000',
      });
    expect(resStock.status).toBe(200);

    const resItem = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
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
      const id = (resCreateItem.body as ItemResponse).id;
      await request(app.getHttpServer())
        .patch(`/api/items/${id}/stock`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          tipo: 'entrada',
          motivo: 'compra',
          cantidad: stock,
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
    const filaConConteo = (
      resListaConConteo.body as { data: RecuentoListItem[] }
    ).data.find((r) => r.id === recuentoId)!;
    expect(filaConConteo.cantidadLineas).toBe(2);
    expect(filaConConteo.diferenciaNeta).toBe('5.0000');
  });
});
