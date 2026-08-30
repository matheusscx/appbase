import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * Una venta de total $0 —el caso real de una promoción que descuenta el 100%—
 * es una venta **PAGADA, sin línea de pago**: queda registrada, descuenta stock,
 * emite su documento y **no** aparece como deuda.
 *
 * Antes no tenía ningún camino: `ventas.service.ts` solo calculaba el estado
 * `if (saved.pagos.length > 0)`, así que una venta sin pagos quedaba `pendiente`
 * con saldo $0 y se arrastraba en los listados de deuda — justo lo que la
 * decisión rechaza.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface ItemResponse {
  id: string;
}
interface VentaResponse {
  id: string;
  estado: string;
}
interface VentaDetalle {
  estado: string;
  totalFinal: string;
  pagos: unknown[];
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

describe('Venta de total $0 (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let itemGratisId: string;
  let itemPagoId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(process.env.API_PREFIX ?? '/api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    token = await login(app);

    // `precioBase: '0'` es válido (`@IsDecimalNoNegativo`) y desde el 2026-08-30
    // es la ÚNICA forma de llegar a un total 0 por API con un ítem gratis: la
    // línea de `CreateVentaDto` ya no acepta ningún precio (antes tenía un
    // `precioUnitario` opcional, que además exigía > 0).
    const resGratis = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Promo 100% E2E ${Date.now()}`,
        precioBase: '0',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
      });
    expect(resGratis.status).toBe(201);
    itemGratisId = (resGratis.body as ItemResponse).id;

    const resPago = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Servicio con precio E2E ${Date.now()}`,
        precioBase: '5000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'servicio',
      });
    expect(resPago.status).toBe(201);
    itemPagoId = (resPago.body as ItemResponse).id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function detalle(ventaId: string): Promise<VentaDetalle> {
    const res = await request(app.getHttpServer())
      .get(`/api/ventas/${ventaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as VentaDetalle;
  }

  it('sin pagos y con total 0, la venta nace PAGADA', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        canal: 'online',
        lineas: [{ itemId: itemGratisId, cantidad: '1' }],
      });
    expect(res.status).toBe(201);
    expect((res.body as VentaResponse).estado).toBe('pagada');

    const d = await detalle((res.body as VentaResponse).id);
    expect(d.estado).toBe('pagada');
    expect(d.totalFinal).toBe('0.0000');
    // Pagada y sin línea de pago: no hay nada que cobrar, así que no se inventa
    // un pago de $0 con un método elegido a dedo.
    expect(d.pagos).toHaveLength(0);
  });

  it('con total > 0 y sin pagos, la venta online SIGUE rechazándose', async () => {
    // El contrapunto que prueba que sacar el `if (saved.pagos.length > 0)` no
    // aflojó nada: la regla "las ventas online requieren el pago completo" es
    // anterior e independiente, y sigue en pie. Lo que cambió es solo qué
    // estado se calcula, no quién puede crear una venta sin pagar.
    const res = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        canal: 'online',
        lineas: [{ itemId: itemPagoId, cantidad: '1' }],
      });
    expect(res.status).toBe(400);
    expect((res.body as { message: string }).message).toContain(
      'pago completo',
    );
  });

  it('la venta de $0 no aparece como deuda en el listado de pendientes', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/ventas?estado=pendiente&pageSize=100')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const pendientes = (res.body as { data: { totalFinal: string }[] }).data;
    // Ninguna venta pendiente puede tener saldo cero: ese era exactamente el
    // arrastre que la decisión vino a sacar de los listados de deuda.
    expect(pendientes.every((v) => v.totalFinal !== '0.0000')).toBe(true);
  });
});
