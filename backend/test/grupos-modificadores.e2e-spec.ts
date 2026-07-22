import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface CajaResponse {
  id: string;
}
interface ItemResponse {
  id: string;
  disponible: number | null;
  disponibleCondicional?: boolean;
}
interface GrupoModificadorResponse {
  grupoModificadorId: string;
}
interface VentaResponse {
  id: string;
  estado: string;
  totalFinal: string;
  advertenciasReceta?: string[];
}
interface MovimientoInventario {
  tipo: string;
  motivo: string;
  item_id: string;
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

async function abrirCaja(
  app: INestApplication<App>,
  token: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/caja/abrir')
    .set('Authorization', `Bearer ${token}`)
    .send({
      saldoInicial: '100000.0000',
      comentario: 'Apertura E2E grupos-modificadores',
    });
  return (res.body as CajaResponse).id;
}

async function cerrarCaja(
  app: INestApplication<App>,
  token: string,
  cajaId: string,
): Promise<void> {
  await request(app.getHttpServer())
    .post(`/api/caja/${cajaId}/cerrar`)
    .set('Authorization', `Bearer ${token}`)
    .send({ montoContado: '100000.0000' });
}

async function crearProducto(
  app: INestApplication<App>,
  token: string,
  nombre: string,
  stock: string,
  costo: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/items')
    .set('Authorization', `Bearer ${token}`)
    .send({
      nombre: `${nombre} ${Date.now()}`,
      precioBase: costo,
      monedaId: CLP_MONEDA_ID,
      tipo: 'producto',
      unidadMedida: 'unidad',
      stock,
      costo,
    });
  expect(res.status).toBe(201);
  return (res.body as ItemResponse).id;
}

describe('Grupos de modificadores — venta descuenta stock de opciones elegidas (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let cajaId: string;
  let componenteFijoId: string;
  let bebidaId: string;
  let grupoBebidaId: string;
  let comboId: string;

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

    // 1. Producto con stock: componente fijo del combo, y la Bebida (opción de grupo).
    componenteFijoId = await crearProducto(
      app,
      token,
      'Papas fijas GM E2E',
      '30',
      '500',
    );
    bebidaId = await crearProducto(app, token, 'Bebida GM E2E', '20', '300');
  }, 60000);

  afterAll(async () => {
    if (cajaId) await cerrarCaja(app, token, cajaId);
    await app.close();
  });

  it('2. crea el grupo de modificadores "Bebida" (familia vendible, opción con precioExtra 800)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/grupos-modificadores')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Bebida GM E2E ${Date.now()}`,
        opciones: [{ itemId: bebidaId, cantidad: '1', precioExtra: '800' }],
      });

    expect(res.status).toBe(201);
    grupoBebidaId = (res.body as GrupoModificadorResponse).grupoModificadorId;
  });

  it('3. crea el combo con un componente fijo + el grupo de modificadores obligatorio (min:1, max:1)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Combo GM E2E ${Date.now()}`,
        precioBase: '3000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'combo',
        componentes: [
          {
            componenteItemId: componenteFijoId,
            cantidad: '1',
            bloqueante: true,
          },
        ],
        gruposModificadores: [
          { grupoModificadorId: grupoBebidaId, min: 1, max: 1 },
        ],
      });

    expect(res.status).toBe(201);
    comboId = (res.body as ItemResponse).id;
  });

  it('4. GET /items?tipo=combo → disponibleCondicional: true', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/items?tipo=combo&pageSize=100')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const combo = (res.body as { data: ItemResponse[] }).data.find(
      (i) => i.id === comboId,
    );
    expect(combo?.disponibleCondicional).toBe(true);
  });

  it('5-6-7. vende 1 combo eligiendo la Bebida del grupo: descuenta stock del componente fijo Y de la Bebida, cobra precioBase + precioExtra', async () => {
    const resVenta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [
          {
            itemId: comboId,
            cantidad: '1',
            personalizacion: {
              grupos: [
                {
                  grupoId: grupoBebidaId,
                  opciones: [{ itemId: bebidaId, unidades: 1 }],
                },
              ],
            },
          },
        ],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '3800.0000' }],
      });

    expect(resVenta.status).toBe(201);
    const venta = resVenta.body as VentaResponse;
    expect(venta.estado).toBe('pagada');
    expect(venta.advertenciasReceta ?? []).toEqual([]);
    // 7. Total = precioBase del combo (3000) + precioExtra de la opción elegida (800)
    expect(venta.totalFinal).toBe('3800.0000');

    // 6. Movimientos de inventario: salida del componente fijo Y de la opción de grupo (Bebida)
    const movs: MovimientoInventario[] = await ds.query(
      `SELECT tipo, motivo, item_id FROM movimientos_inventario
       WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [venta.id],
    );

    const movFijo = movs.find((m) => m.item_id === componenteFijoId);
    expect(movFijo?.tipo).toBe('salida');
    expect(movFijo?.motivo).toBe('venta');

    const movBebida = movs.find((m) => m.item_id === bebidaId);
    expect(movBebida?.tipo).toBe('salida');
    expect(movBebida?.motivo).toBe('venta');

    // Stock resultante: componente fijo 30-1=29, bebida 20-1=19
    const stockFijoRows: { stock: string }[] = await ds.query(
      `SELECT stock FROM item_producto WHERE item_id = $1`,
      [componenteFijoId],
    );
    expect(stockFijoRows[0]?.stock).toBe('29.0000');

    const stockBebidaRows: { stock: string }[] = await ds.query(
      `SELECT stock FROM item_producto WHERE item_id = $1`,
      [bebidaId],
    );
    expect(stockBebidaRows[0]?.stock).toBe('19.0000');
  });

  it('8. (negativo) vender el combo sin elegir opción del grupo obligatorio → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [{ itemId: comboId, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '3000.0000' }],
      });

    expect(res.status).toBe(400);
  });
});
