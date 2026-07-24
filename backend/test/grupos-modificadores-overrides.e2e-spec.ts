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
}
interface GrupoOpcionCreadaResponse {
  grupoOpcionId: string;
  itemId: string;
}
interface GrupoModificadorResponse {
  grupoModificadorId: string;
  opciones: GrupoOpcionCreadaResponse[];
}
interface ItemGrupoOpcionDetalle {
  grupoOpcionId: string;
  itemId: string;
  cantidad: string | null;
  cantidadDefault: string | null;
  unidadCodigo: string | null;
  esPendiente: boolean;
}
interface ItemGrupoDetalle {
  grupoModificadorId: string;
  opciones: ItemGrupoOpcionDetalle[];
}
interface ItemDetalleResponse {
  id: string;
  grupos: ItemGrupoDetalle[];
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
  cantidad: string;
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
  const disp = await request(app.getHttpServer())
    .get('/api/caja/cajones-disponibles')
    .set('Authorization', `Bearer ${token}`);
  const cajonId = (disp.body as Array<{ cajonId: string }>)[0]?.cajonId;
  const res = await request(app.getHttpServer())
    .post('/api/caja/abrir')
    .set('Authorization', `Bearer ${token}`)
    .send({
      cajonId,
      saldoInicial: '100000.0000',
      comentario: 'Apertura E2E grupos-modificadores-overrides',
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
    .send({ montoContado: '100000' });
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
      precioBase: '0',
      monedaId: CLP_MONEDA_ID,
      tipo: 'ingrediente',
      unidadMedida: unidad,
      stock,
      costo,
    });
  expect(res.status).toBe(201);
  return (res.body as ItemResponse).id;
}

describe('Grupos de modificadores — override de consumo por receta (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let cajaId: string;
  let panBaseId: string;
  let carneId: string;
  let grupoProteinaId: string;
  let carneOpcionId: string;
  let recetaClasicaId: string;
  let recetaXlId: string;
  let recetaSinOverrideId: string;

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

    // Ingrediente base (bloqueante, no participa del override) para que ambas
    // recetas puedan crearse (una receta requiere al menos un ingrediente).
    panBaseId = await crearIngrediente(
      app,
      token,
      'Pan base OV E2E',
      'unidad',
      '1000',
      '100',
    );

    // 1. Ingrediente "Carne" con stock alto y unidad base g.
    carneId = await crearIngrediente(
      app,
      token,
      'Carne OV E2E',
      'g',
      '100000',
      '10',
    );
  }, 60000);

  afterAll(async () => {
    if (cajaId) await cerrarCaja(app, token, cajaId);
    await app.close();
  });

  it('2. crea el grupo "Proteína" con la opción Carne SIN cantidad default', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/grupos-modificadores')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Proteína OV E2E ${Date.now()}`,
        opciones: [{ itemId: carneId, precioExtra: '0' }],
      });

    expect(res.status).toBe(201);
    const body = res.body as GrupoModificadorResponse;
    grupoProteinaId = body.grupoModificadorId;
    carneOpcionId = body.opciones[0].grupoOpcionId;
    expect(carneOpcionId).toBeDefined();
  });

  it('3. crea la receta "Hamburguesa Clásica" con override de 150 g para la Carne', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Hamburguesa Clásica OV E2E ${Date.now()}`,
        precioBase: '3500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: panBaseId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
        ],
        gruposModificadores: [
          {
            grupoModificadorId: grupoProteinaId,
            min: 1,
            max: 1,
            opciones: [
              {
                grupoOpcionId: carneOpcionId,
                cantidad: '150',
                unidadCodigo: 'g',
              },
            ],
          },
        ],
      });

    expect(res.status).toBe(201);
    recetaClasicaId = (res.body as ItemResponse).id;
  });

  it('4. crea la receta "Hamburguesa XL" reusando el mismo grupo con override de 250 g', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Hamburguesa XL OV E2E ${Date.now()}`,
        precioBase: '3500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: panBaseId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
        ],
        gruposModificadores: [
          {
            grupoModificadorId: grupoProteinaId,
            min: 1,
            max: 1,
            opciones: [
              {
                grupoOpcionId: carneOpcionId,
                cantidad: '250',
                unidadCodigo: 'g',
              },
            ],
          },
        ],
      });

    expect(res.status).toBe(201);
    recetaXlId = (res.body as ItemResponse).id;
  });

  it('5. vende 1 Clásica eligiendo Carne → movimiento de salida de 150 g', async () => {
    const resVenta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [
          {
            itemId: recetaClasicaId,
            cantidad: '1',
            personalizacion: {
              grupos: [
                {
                  grupoId: grupoProteinaId,
                  opciones: [{ itemId: carneId, unidades: 1 }],
                },
              ],
            },
          },
        ],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '3500.0000' }],
      });

    expect(resVenta.status).toBe(201);
    const venta = resVenta.body as VentaResponse;
    expect(venta.estado).toBe('pagada');
    expect(venta.advertenciasReceta ?? []).toEqual([]);
    expect(venta.totalFinal).toBe('3500.0000');

    const movs: MovimientoInventario[] = await ds.query(
      `SELECT tipo, motivo, item_id, cantidad FROM movimientos_inventario
       WHERE venta_id = $1 AND item_id = $2 AND eliminado_el IS NULL`,
      [venta.id, carneId],
    );
    expect(movs).toHaveLength(1);
    expect(movs[0].tipo).toBe('salida');
    expect(movs[0].motivo).toBe('venta');
    expect(movs[0].cantidad).toBe('150.0000');
  });

  it('6. vende 1 XL eligiendo la MISMA Carne → movimiento de salida de 250 g', async () => {
    const resVenta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [
          {
            itemId: recetaXlId,
            cantidad: '1',
            personalizacion: {
              grupos: [
                {
                  grupoId: grupoProteinaId,
                  opciones: [{ itemId: carneId, unidades: 1 }],
                },
              ],
            },
          },
        ],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '3500.0000' }],
      });

    expect(resVenta.status).toBe(201);
    const venta = resVenta.body as VentaResponse;
    expect(venta.estado).toBe('pagada');
    expect(venta.advertenciasReceta ?? []).toEqual([]);

    const movs: MovimientoInventario[] = await ds.query(
      `SELECT tipo, motivo, item_id, cantidad FROM movimientos_inventario
       WHERE venta_id = $1 AND item_id = $2 AND eliminado_el IS NULL`,
      [venta.id, carneId],
    );
    expect(movs).toHaveLength(1);
    expect(movs[0].tipo).toBe('salida');
    expect(movs[0].motivo).toBe('venta');
    expect(movs[0].cantidad).toBe('250.0000');
  });

  it('7. el stock resultante de Carne refleja AMBOS descuentos (150 + 250) sobre el mismo ingrediente', async () => {
    const stockRows: { stock: string }[] = await ds.query(
      `SELECT stock FROM item_producto WHERE item_id = $1`,
      [carneId],
    );
    // 100000 - 150 - 250 = 99600
    expect(stockRows[0]?.stock).toBe('99600.0000');
  });

  it('8. una 3ª receta que asocia el grupo SIN override (default null) queda con la opción esPendiente', async () => {
    const resReceta = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Hamburguesa Sin Override OV E2E ${Date.now()}`,
        precioBase: '3500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: panBaseId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
        ],
        gruposModificadores: [
          { grupoModificadorId: grupoProteinaId, min: 1, max: 1 },
        ],
      });
    expect(resReceta.status).toBe(201);
    recetaSinOverrideId = (resReceta.body as ItemResponse).id;

    const resGet = await request(app.getHttpServer())
      .get(`/api/items/${recetaSinOverrideId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resGet.status).toBe(200);
    const detalle = resGet.body as ItemDetalleResponse;
    const grupo = detalle.grupos.find(
      (g) => g.grupoModificadorId === grupoProteinaId,
    );
    const opcionCarne = grupo?.opciones.find((o) => o.itemId === carneId);
    expect(opcionCarne?.cantidad).toBeNull();
    expect(opcionCarne?.esPendiente).toBe(true);

    // (negativo) vender esa receta eligiendo la opción pendiente → 400
    const resVenta = await request(app.getHttpServer())
      .post('/api/ventas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        lineas: [
          {
            itemId: recetaSinOverrideId,
            cantidad: '1',
            personalizacion: {
              grupos: [
                {
                  grupoId: grupoProteinaId,
                  opciones: [{ itemId: carneId, unidades: 1 }],
                },
              ],
            },
          },
        ],
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '3500.0000' }],
      });
    expect(resVenta.status).toBe(400);
  });
});
