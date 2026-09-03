import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const USD_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440005';
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const EFECTIVO_ID = '550e8400-e29b-41d4-a716-446655440105';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
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
  advertencias?: string[];
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
  let caja: CajaAbierta;
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
    // `switch-tenant` y `refresh` leen `req.cookies`, y `cookieParser` vive en
    // `main.ts`, que el e2e no ejecuta. Sin esto los dos cortan con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();

    ds = app.get(DataSource);
    token = await login(app);
    caja = await abrirCaja(app, token, {
      comentario: 'Apertura E2E grupos-modificadores-overrides',
    });

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
    // `close` en un `finally`: `cerrarCaja` afirma sus status adentro, así que
    // si la caja no cierra **tira**, y sin esto la app de Nest quedaba viva con
    // su `@Cron` escribiéndole a la base durante las suites siguientes. El
    // fallo sigue propagando; lo que cambia es que ya no se lleva el cierre
    // puesto. Ver `docs/agent/pendientes.md` § 1.
    try {
      if (caja) await cerrarCaja(app, token, caja);
    } finally {
      await app.close();
    }
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
        // Receta afecta (default): 3500 + 19% IVA = 4165 (Task 1, ADR-018).
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '4165.0000' }],
      });

    expect(resVenta.status).toBe(201);
    const venta = resVenta.body as VentaResponse;
    expect(venta.estado).toBe('pagada');
    expect(venta.advertencias ?? []).toEqual([]);
    expect(venta.totalFinal).toBe('4165.0000');

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
        // Receta afecta (default): 3500 + 19% IVA = 4165 (Task 1, ADR-018).
        pagos: [{ metodoPagoId: EFECTIVO_ID, monto: '4165.0000' }],
      });

    expect(resVenta.status).toBe(201);
    const venta = resVenta.body as VentaResponse;
    expect(venta.estado).toBe('pagada');
    expect(venta.advertencias ?? []).toEqual([]);

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

  it('9. GET /grupos-modificadores/:id/items devuelve la moneda DE CADA receta, no la oficial del tenant', async () => {
    // La opción hereda la moneda del ítem al que se aplica (owner, 2026-08-25),
    // así que el drawer "usado en recetas" formatea y enmascara con la moneda de
    // cada fila. Esta receta va en USD —habilitada para Paris en el seed— para
    // que devolver la oficial del tenant (CLP, como hacía la pantalla antes) no
    // pueda pasar el test.
    const resRecetaUsd = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Hamburguesa USD OV E2E ${Date.now()}`,
        precioBase: '9.90',
        monedaId: USD_MONEDA_ID,
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
    expect(resRecetaUsd.status).toBe(201);
    const recetaUsdId = (resRecetaUsd.body as ItemResponse).id;

    const res = await request(app.getHttpServer())
      .get(`/api/grupos-modificadores/${grupoProteinaId}/items`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const filas = res.body as { itemId: string; monedaId: string }[];

    const enUsd = filas.find((f) => f.itemId === recetaUsdId);
    expect(enUsd?.monedaId).toBe(USD_MONEDA_ID);
    // Y la de al lado, creada en pesos, sigue en pesos: el campo es por fila.
    const enClp = filas.find((f) => f.itemId === recetaClasicaId);
    expect(enClp?.monedaId).toBe(CLP_MONEDA_ID);
  });
});
