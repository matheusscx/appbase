import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
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
  costoActual: string | null;
  disponible: number | null;
}
interface VentaResponse {
  id: string;
  estado: string;
  advertenciasReceta?: string[];
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
    .send({ saldoInicial: '100000.0000', comentario: 'Apertura E2E recetas' });
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

async function crearIngrediente(
  app: INestApplication<App>,
  token: string,
  nombre: string,
  unidad: string,
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
      tipo: 'ingrediente',
      unidadMedida: unidad,
      stock,
      costo,
    });
  expect(res.status).toBe(201);
  return (res.body as ItemResponse).id;
}

describe('Recetas — flujo completo (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let cajaId: string;
  let panId: string;
  let carneId: string;
  let quesoId: string;

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
    cajaId = await abrirCaja(app, token);
    panId = await crearIngrediente(
      app,
      token,
      'Pan E2E',
      'unidad',
      '10',
      '500',
    );
    carneId = await crearIngrediente(
      app,
      token,
      'Carne E2E',
      'kg',
      '1',
      '8000',
    );
    quesoId = await crearIngrediente(
      app,
      token,
      'Queso E2E',
      'kg',
      '0.01',
      '6000',
    );
  }, 60000);

  afterAll(async () => {
    if (cajaId) await cerrarCaja(app, token, cajaId);
    await app.close();
  });

  it('1. crea la receta y calcula el costo', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Hamburguesa E2E ${Date.now()}`,
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
          {
            ingredienteItemId: carneId,
            cantidad: '150',
            unidadCodigo: 'g',
            bloqueante: true,
          },
          {
            ingredienteItemId: quesoId,
            cantidad: '20',
            unidadCodigo: 'g',
            bloqueante: false,
          },
        ],
      });

    expect(res.status).toBe(201);
    const recetaId = (res.body as ItemResponse).id;

    const resGet = await request(app.getHttpServer())
      .get(`/api/items/${recetaId}`)
      .set('Authorization', `Bearer ${token}`);
    // 500*1 + 8000*0.15 + 6000*0.02 = 1820
    expect((resGet.body as ItemResponse).costoActual).toBe('1820.0000');
  });

  it('2-3-4-5. vende con stock suficiente, sin queso (no bloqueante), sin carne (bloqueante) y refleja disponible', async () => {
    const localPan = await crearIngrediente(
      app,
      token,
      'Pan local',
      'unidad',
      '10',
      '500',
    );
    // 1 kg = 1000 g; a 150 g/venta alcanzan para 6 ventas exactas (floor(1000/150)=6).
    const localCarne = await crearIngrediente(
      app,
      token,
      'Carne local',
      'kg',
      '1',
      '8000',
    );
    // 30 g: alcanza para la primera venta (20 g) pero no para la segunda.
    const localQueso = await crearIngrediente(
      app,
      token,
      'Queso local',
      'kg',
      '0.03',
      '6000',
    );

    const resReceta = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Hamburguesa local ${Date.now()}`,
        precioBase: '3500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: localPan,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
          {
            ingredienteItemId: localCarne,
            cantidad: '150',
            unidadCodigo: 'g',
            bloqueante: true,
          },
          {
            ingredienteItemId: localQueso,
            cantidad: '20',
            unidadCodigo: 'g',
            bloqueante: false,
          },
        ],
      });
    const recetaId = (resReceta.body as ItemResponse).id;

    // 5. Disponible: pan floor(10/1)=10, carne floor(1000g/150g)=6 → mínimo 6.
    // Queso no cuenta (no bloqueante), aunque ya sepamos que solo alcanza para 1 venta.
    const resListado = await request(app.getHttpServer())
      .get('/api/items?tipo=receta&pageSize=100')
      .set('Authorization', `Bearer ${token}`);
    const recetaListada = (
      resListado.body as { data: ItemResponse[] }
    ).data.find((i) => i.id === recetaId);
    expect(recetaListada?.disponible).toBe(6);

    async function venderUna() {
      return request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId: recetaId, cantidad: '1' }],
          pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '3500' }],
        });
    }

    // 2. Venta con stock suficiente de TODO (queso recién sembrado con 30 g) →
    // sin advertencias. Esta es venta #1 de las 6 que la carne permite.
    const resVenta1 = await venderUna();
    expect(resVenta1.status).toBe(201);
    expect((resVenta1.body as VentaResponse).advertenciasReceta ?? []).toEqual(
      [],
    );

    // 4. Venta #2: queso quedó en 10 g (30-20), no alcanza para los 20 g
    // requeridos → no bloqueante, se omite con advertencia; pan y carne sí se descuentan.
    const resVenta2 = await venderUna();
    expect(resVenta2.status).toBe(201);
    expect((resVenta2.body as VentaResponse).advertenciasReceta?.length).toBe(
      1,
    );

    // Ventas #3-#6: la carne todavía alcanza (2 de las 6 ya se usaron).
    for (let i = 0; i < 4; i++) {
      const res = await venderUna();
      expect(res.status).toBe(201);
    }

    // 3. Venta #7: la carne ya se agotó (6*150g = 1000g = el stock total) →
    // ingrediente bloqueante sin stock rechaza la venta completa.
    const resVentaFinal = await venderUna();
    expect(resVentaFinal.status).toBe(400);
  });

  it('6. bloquea borrar un ingrediente en uso', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/items/${panId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });
});
