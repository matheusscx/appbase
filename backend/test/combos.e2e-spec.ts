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
    .send({ saldoInicial: '100000.0000', comentario: 'Apertura E2E combos' });
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

async function crearIngrediente(
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
      precioBase: '0',
      monedaId: CLP_MONEDA_ID,
      tipo: 'ingrediente',
      unidadMedida: 'unidad',
      stock,
      costo,
    });
  expect(res.status).toBe(201);
  return (res.body as ItemResponse).id;
}

describe('Combos — venta descuenta stock de componentes (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let cajaId: string;
  let papasId: string;
  let panId: string;
  let hamburguesaId: string;
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

    // 1. Producto con stock (componente directo del combo)
    papasId = await crearProducto(app, token, 'Papas combo E2E', '20', '500');

    // Ingrediente con stock, usado por la receta que será componente del combo
    panId = await crearIngrediente(app, token, 'Pan combo E2E', '10', '500');

    // Receta con un ingrediente bloqueante (componente del combo)
    const resReceta = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Hamburguesa combo E2E ${Date.now()}`,
        precioBase: '3500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: panId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
        ],
      });
    expect(resReceta.status).toBe(201);
    hamburguesaId = (resReceta.body as ItemResponse).id;
  }, 60000);

  afterAll(async () => {
    if (cajaId) await cerrarCaja(app, token, cajaId);
    await app.close();
  });

  it('1-2. crea el combo con producto y receta como componentes bloqueantes', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Combo Papas + Hamburguesa E2E ${Date.now()}`,
        precioBase: '4000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'combo',
        componentes: [
          { componenteItemId: papasId, cantidad: '1', bloqueante: true },
          { componenteItemId: hamburguesaId, cantidad: '1', bloqueante: true },
        ],
      });

    expect(res.status).toBe(201);
    comboId = (res.body as ItemResponse).id;
  });

  it('3. disponible = mínimo entre componentes bloqueantes (papas 20, hamburguesa limitada por pan=10)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/items?tipo=combo&pageSize=100')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const combo = (res.body as { data: ItemResponse[] }).data.find(
      (i) => i.id === comboId,
    );
    // papas: floor(20/1)=20 ; hamburguesa: floor(pan=10/1)=10 → mínimo 10
    expect(combo?.disponible).toBe(10);
  });

  it('4-5-6. vende 1 combo, descuenta stock de papas y de pan (vía receta), cobra el precio del combo', async () => {
    const resVenta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [{ itemId: comboId, cantidad: '1' }],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '4000.0000' }],
      });

    expect(resVenta.status).toBe(201);
    const venta = resVenta.body as VentaResponse;
    expect(venta.estado).toBe('pagada');
    expect(venta.advertenciasReceta ?? []).toEqual([]);
    // 6. Total cobrado = precio del combo
    expect(venta.totalFinal).toBe('4000.0000');

    // 5. Movimientos de inventario: salida del producto directo (papas) y
    // salida del ingrediente de la receta (pan), ambos motivo 'venta'.
    const movs: MovimientoInventario[] = await ds.query(
      `SELECT tipo, motivo, item_id FROM movimientos_inventario
       WHERE venta_id = $1 AND eliminado_el IS NULL`,
      [venta.id],
    );

    const movPapas = movs.find((m) => m.item_id === papasId);
    expect(movPapas?.tipo).toBe('salida');
    expect(movPapas?.motivo).toBe('venta');

    const movPan = movs.find((m) => m.item_id === panId);
    expect(movPan?.tipo).toBe('salida');
    expect(movPan?.motivo).toBe('venta');

    // Stock resultante: papas 20-1=19, pan 10-1=9
    const stockRows: { stock: string }[] = await ds.query(
      `SELECT stock FROM item_producto WHERE item_id = $1`,
      [papasId],
    );
    expect(stockRows[0]?.stock).toBe('19.0000');

    const stockPanRows: { stock: string }[] = await ds.query(
      `SELECT stock FROM item_producto WHERE item_id = $1`,
      [panId],
    );
    expect(stockPanRows[0]?.stock).toBe('9.0000');
  });
});
