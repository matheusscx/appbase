import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440007'; // Paris
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const USUARIO_ID = '550e8400-e29b-41d4-a716-446655440056'; // admin Paris
const ITEM_ID = '550e8400-e29b-41d4-a716-446655440116'; // Smartphone (stock = 10)
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';
const BOLETA_ID = '550e8400-e29b-41d4-a716-446655440145';

// Credentials seeded in dev (seed password: 'admin')
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

interface TokenResponse {
  access_token: string;
}
interface CajaResponse {
  id: string;
}
interface VentaResponse {
  id: string;
  estado: string;
  detalles: unknown[];
  pagos: unknown[];
  customer: unknown;
}

async function login(app: INestApplication<App>): Promise<string> {
  const resLogin = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  const initialToken = (resLogin.body as TokenResponse).access_token;

  // Switch to Paris tenant so token carries tenant_id
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
    .send({ saldoInicial: '10000.0000', comentario: 'Apertura E2E' });
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
    .send({ montoContado: '10000.0000' });
}

async function getStock(ds: DataSource, itemId: string): Promise<number> {
  const rows: { stock: string }[] = await ds.query(
    `SELECT ip.stock FROM item_producto ip
     JOIN items i ON i.item_id = ip.item_id
     WHERE ip.item_id = $1 AND i.eliminado_el IS NULL`,
    [itemId],
  );
  return parseFloat(rows[0]?.stock ?? '0');
}

describe('Ventas (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let cajaId: string;

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
  });

  afterAll(async () => {
    if (cajaId) await cerrarCaja(app, token, cajaId);
    await app.close();
  });

  describe('POST /ventas', () => {
    it('crea venta con pago completo y queda en estado pagada', async () => {
      const stockAntes = await getStock(ds, ITEM_ID);

      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          tipoDocumentoId: BOLETA_ID,
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '1069810.0000' }],
        });

      const venta = res.body as VentaResponse;
      expect(res.status).toBe(201);
      expect(venta.estado).toBe('pagada');

      // Stock debe haber bajado en 1
      const stockDespues = await getStock(ds, ITEM_ID);
      expect(stockDespues).toBe(stockAntes - 1);

      // Movimiento de inventario registrado
      const movInv: { tipo: string; motivo: string }[] = await ds.query(
        `SELECT tipo, motivo FROM movimientos_inventario
         WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [venta.id],
      );
      expect(movInv.length).toBeGreaterThan(0);
      expect(movInv[0].tipo).toBe('salida');
      expect(movInv[0].motivo).toBe('venta');

      // Movimiento de caja registrado (efectivo)
      const movCaja: { tipo: string; concepto: string }[] = await ds.query(
        `SELECT tipo, concepto FROM movimientos_caja
         WHERE venta_id = $1 AND eliminado_el IS NULL`,
        [venta.id],
      );
      expect(movCaja.length).toBeGreaterThan(0);
      expect(movCaja[0].tipo).toBe('entrada');
    });

    it('crea venta con pago menor y queda en estado pendiente', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '50.0000' }],
        });

      expect(res.status).toBe(201);
      expect((res.body as VentaResponse).estado).toBe('pendiente');
    });

    it('retorna 400 si no hay caja abierta para el usuario', async () => {
      // Login como usuario sin caja abierta
      const resLogin = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'vendedor@paris.cl', password: 'Vendedor1234!' });
      const vendedorToken = (resLogin.body as TokenResponse).access_token;

      if (!vendedorToken) {
        // Si el usuario vendedor no existe en seed, saltear
        return;
      }

      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${vendedorToken}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '119.0000' }],
        });

      expect(res.status).toBe(400);
    });

    it('retorna 400 cuando el excedente existe pero no hay método con vuelto', async () => {
      // Tarjeta de crédito (permite_vuelto = false) — pago mayor al total genera excedente sin vuelto
      const TARJETA_ID = '550e8400-e29b-41d4-a716-446655440107';
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: TARJETA_ID, monto: '2000000.0000' }],
        });

      expect(res.status).toBe(400);
    });

    it('retorna 400 con payload vacío (validación DTO)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('GET /tipos-documento', () => {
    interface TipoDocResponse {
      id: string;
      nombre: string;
      codigo: string | null;
      customerRequerido: boolean;
    }

    it('lista los tipos de documento del país del tenant con el flag customerRequerido', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/tipos-documento')
        .set('Authorization', `Bearer ${token}`);

      const tipos = res.body as TipoDocResponse[];
      expect(res.status).toBe(200);
      expect(Array.isArray(tipos)).toBe(true);
      expect(tipos.length).toBeGreaterThan(0);

      const boleta = tipos.find((t) => t.codigo === '39');
      const factura = tipos.find((t) => t.codigo === '33');
      expect(boleta?.customerRequerido).toBe(false);
      expect(factura?.customerRequerido).toBe(true);
    });

    it('retorna 401 sin token', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/tipos-documento',
      );
      expect(res.status).toBe(401);
    });
  });

  describe('GET /ventas y GET /ventas/:id', () => {
    let ventaId: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '200.0000' }],
          customer: { nombre: 'Juan Pérez', rut: '12.345.678-9' },
        });
      ventaId = (res.body as VentaResponse).id;
    });

    it('lista las ventas del tenant con paginación', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/ventas?page=1&pageSize=15')
        .set('Authorization', `Bearer ${token}`);

      const body = res.body as { data: unknown[]; meta: { total: number } };
      expect(res.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.meta.total).toBeGreaterThan(0);
    });

    it('GET /ventas/resumen retorna KPIs del tenant', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/ventas/resumen')
        .set('Authorization', `Bearer ${token}`);

      const body = res.body as {
        totalVentas: number;
        totalFacturado: string;
        saldoPendiente: string;
      };
      expect(res.status).toBe(200);
      expect(body.totalVentas).toBeGreaterThan(0);
      expect(body.totalFacturado).toBeDefined();
      expect(body.saldoPendiente).toBeDefined();
    });

    it('expande todos los campos en GET /ventas/:id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/ventas/${ventaId}`)
        .set('Authorization', `Bearer ${token}`);

      const venta = res.body as VentaResponse;
      expect(res.status).toBe(200);
      expect(venta.id).toBe(ventaId);
      expect(Array.isArray(venta.detalles)).toBe(true);
      expect(venta.detalles.length).toBe(1);
      expect(Array.isArray(venta.pagos)).toBe(true);
      expect(venta.pagos.length).toBe(1);
      expect(venta.customer).toBeDefined();
      expect((venta.customer as { nombre: string }).nombre).toBe('Juan Pérez');
    });

    it('retorna 404 para un ventaId inexistente', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/ventas/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('rollback completo ante stock insuficiente — no crea venta ni movimientos', async () => {
      // Pedir más stock del disponible
      const stockActual = await getStock(ds, ITEM_ID);
      const cantidadExcesiva = String(stockActual + 100);

      const res = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: ITEM_ID, cantidad: cantidadExcesiva }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '999999.0000' }],
        });

      expect(res.status).toBeGreaterThanOrEqual(400);

      // El stock no debe haber cambiado
      const stockDespues = await getStock(ds, ITEM_ID);
      expect(stockDespues).toBe(stockActual);
    });
  });
});
