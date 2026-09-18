import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import Decimal from 'decimal.js';
import { AppModule } from '../src/app.module';
import { abrirCaja, cerrarCaja, type CajaAbierta } from './helpers/caja';

/**
 * El CPP de `item_producto.costo_actual` es UNO SOLO por producto para todo el
 * tenant (`docs/features/bodegas-y-traslados.md`, «Por qué el costo no se parte
 * por ubicación (decisión 3)»), así que el peso del promedio es el stock del
 * producto en TODAS sus ubicaciones — no el de la ubicación del movimiento,
 * que es lo que guarda el `stock_anterior` del kardex.
 *
 * Hasta el 2026-09-18 `registrarMovimiento` ponderaba con el saldo de la
 * ubicación del movimiento. Medido contra ese código, los tres primeros casos
 * daban 1.500,0000, 1.333,3333 y 1.900,0000.
 *
 * Todo el escenario se monta por la API (nunca SQL directo): si un caso
 * necesitara `ds.query` para existir, sería señal de que ese estado no es
 * alcanzable por la API y el hueco real está en el endpoint, no en el test.
 */

const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface ItemResponse {
  id: string;
  costoActual: string | null;
  stock: string | null;
}
interface IdResponse {
  id: string;
}
interface UbicacionListada {
  id: string;
  nombre: string;
  tipo: 'local' | 'bodega';
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

const nombreUnico = (base: string) =>
  `${base} ${Date.now()}-${Math.floor(Math.random() * 100000)}`;

describe('Costeo CPP multi-ubicación (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let caja: CajaAbierta;
  let localId: string;
  let bodegaId: string;
  let motivoTrasladoId: string;

  async function crearItemProducto(): Promise<string> {
    const resCreate = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: nombreUnico('CPP multi-ubicación'),
        tipo: 'producto',
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        stock: '0',
      });
    expect(resCreate.status).toBe(201);
    return (resCreate.body as ItemResponse).id;
  }

  async function ajustarStock(
    itemId: string,
    ubicacionId: string,
    cantidad: string,
    costoUnitario: string,
    motivo = 'compra',
  ): Promise<void> {
    const res = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        cantidad,
        tipo: 'entrada',
        motivo,
        ubicacionId,
        costoUnitario,
      });
    expect(res.status).toBe(200);
  }

  async function costoActualDe(itemId: string): Promise<string> {
    const { body } = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return new Decimal((body as ItemResponse).costoActual!).toFixed(4);
  }

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

    const resUbic = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`);
    expect(resUbic.status).toBe(200);
    localId = (resUbic.body as UbicacionListada[]).find(
      (u) => u.tipo === 'local',
    )!.id;

    // Bodega PROPIA del spec, no la del seed ("Bodega Subsuelo"): este
    // archivo mide saldos por ubicación y compartirla lo volvería dependiente
    // del orden de las suites — mismo criterio que `traslados.e2e-spec.ts`.
    const resBodega = await request(app.getHttpServer())
      .post('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: nombreUnico('Bodega CPP E2E'), tipo: 'bodega' });
    expect(resBodega.status).toBe(201);
    bodegaId = (resBodega.body as IdResponse).id;

    const resMotivos = await request(app.getHttpServer())
      .get('/api/motivos-traslado?soloActivas=true')
      .set('Authorization', `Bearer ${token}`);
    expect(resMotivos.status).toBe(200);
    motivoTrasladoId = (resMotivos.body as IdResponse[])[0].id;

    caja = await abrirCaja(app, token, {
      comentario: 'Apertura E2E costeo CPP multi-ubicación',
    });
  });

  afterAll(async () => {
    // `close` en un `finally`: mismo motivo que `costeo-cpp.e2e-spec.ts` — si
    // `cerrarCaja` tira, igual hay que soltar la app antes de propagar.
    try {
      if (caja) await cerrarCaja(app, token, caja);
    } finally {
      await app.close();
    }
  });

  it(
    'una compra en el local pondera contra el stock TOTAL del ítem, aunque ' +
      'el local esté en cero',
    async () => {
      const itemId = await crearItemProducto();

      // Bodega: 100 kg a $1.000 → primera entrada del ítem en cualquier
      // ubicación, sin masa previa que promediar: el costo de compra manda
      // tal cual (la rama "sin stock previo").
      await ajustarStock(itemId, bodegaId, '100', '1000');
      expect(await costoActualDe(itemId)).toBe('1000.0000');

      // Local: 10 kg a $1.500. El LOCAL nunca tuvo stock, pero el producto
      // sí: 100 kg a $1.000 en la bodega. El promedio pondera los 110 kg:
      //   (100×1.000 + 10×1.500) / 110 = 1.045,4545
      // Ponderando con el saldo del local (0) caía en la rama "sin stock
      // previo" y el costo de compra pisaba el de los 100 kg: 1.500.
      await ajustarStock(itemId, localId, '10', '1500');

      expect(await costoActualDe(itemId)).toBe('1045.4545');
    },
  );

  it(
    'un traslado bodega→local antes de la compra no cambia el promedio: ' +
      'mueve kilos, no valor',
    async () => {
      const itemId = await crearItemProducto();

      // Mismo punto de partida que el caso anterior: 100 kg a $1.000 en
      // bodega, costo_actual = 1.000.
      await ajustarStock(itemId, bodegaId, '100', '1000');

      // Traslado de 5 kg bodega→local ANTES de la compra. Un traslado
      // reubica kilos, no valor (`traslados.service.ts` ~L431-438: la
      // entrada del traslado no lleva `costoUnitario`), así que el valor
      // total del producto sigue siendo $100.000 sobre 100 kg, y el CPP
      // después de la compra tiene que dar lo mismo que en el caso anterior:
      // 1.045,4545, sin importar el traslado.
      const resTraslado = await request(app.getHttpServer())
        .post('/api/traslados')
        .set('Authorization', `Bearer ${token}`)
        .send({
          origenId: bodegaId,
          destinoId: localId,
          motivoTrasladoId,
          lineas: [{ itemId, cantidad: '5' }],
        });
      expect(resTraslado.status).toBe(201);
      // El traslado no toca el promedio: sigue en 1.000.
      expect(await costoActualDe(itemId)).toBe('1000.0000');

      // Compra 10 kg a $1.500 en el local, que ahora tiene los 5 kg
      // trasladados. Ponderando solo con el local se ignoraban los 95 kg de
      // la bodega — (5×1.000 + 10×1.500) / 15 = 1.333,3333 — y el traslado
      // cambiaba un resultado que no debería tocar.
      await ajustarStock(itemId, localId, '10', '1500');
      expect(await costoActualDe(itemId)).toBe('1045.4545');
    },
  );

  it(
    'anular una venta repone en el local ponderando contra el stock de todas ' +
      'las ubicaciones, bodega incluida',
    async () => {
      const itemId = await crearItemProducto();

      // Bodega y local arrancan al mismo costo ($1.000) para que el estado
      // de partida sea limpio: 100 kg en bodega + 10 kg en local, los dos a
      // $1.000, así que el promedio de tenant es trivialmente $1.000 sin
      // que ninguna de las dos compras necesite promediar contra la otra
      // ubicación.
      await ajustarStock(itemId, bodegaId, '100', '1000');
      await ajustarStock(itemId, localId, '10', '1000');
      expect(await costoActualDe(itemId)).toBe('1000.0000');

      // Vende 1 unidad (siempre descuenta del local): local queda en 9 kg.
      // La salida congela en el kardex el costo vigente al vender: $1.000.
      const resVenta = await request(app.getHttpServer())
        .post('/api/ventas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          lineas: [{ itemId, cantidad: '1' }],
          pagos: [],
        });
      expect(resVenta.status).toBe(201);
      const ventaId = (resVenta.body as { id: string }).id;

      // Ajuste de costo directo a $2.000 — un override auditado, no
      // ponderado por ubicación (`AjusteCostoDto` es deliberadamente sin
      // `ubicacionId`: "el costo es un promedio ponderado por PRODUCTO para
      // todo el tenant"). Deja costo_actual = 2.000, representando el valor
      // vigente de TODO el stock del tenant (bodega 100 kg + local 9 kg =
      // 109 kg) en el momento justo antes de anular.
      const resAjuste = await request(app.getHttpServer())
        .post('/api/inventario/ajustes-costo')
        .set('Authorization', `Bearer ${token}`)
        .send({
          itemId,
          costoNuevo: '2000',
          comentario: 'CPP multi-ubicación E2E',
        });
      expect(resAjuste.status).toBe(201);
      expect(await costoActualDe(itemId)).toBe('2000.0000');

      // Anula la venta: la unidad vuelve al costo con el que salió ($1.000,
      // el congelado en el kardex), y el CPP se recalcula incluyéndola
      // (decisión del owner, 2026-08-15 — `inventario-kardex.md` § Regla de
      // costo). Pondera contra los 109 kg del producto (100 en bodega + 9 en
      // local), no solo contra los 9 kg del local:
      //   (109×2.000 + 1×1.000) / 110 = 1.990,9091
      // Solo con el local daba (9×2.000 + 1×1.000) / 10 = 1.900.
      await request(app.getHttpServer())
        .post(`/api/ventas/${ventaId}/anular`)
        .set('Authorization', `Bearer ${token}`)
        .send({ motivo: 'Anulada para medir el CPP multi-ubicación' })
        .expect(201);
      expect(await costoActualDe(itemId)).toBe('1990.9091');
    },
  );

  it(
    'dos compras simultáneas del mismo ítem en ubicaciones distintas ' +
      'ponderan una detrás de la otra',
    async () => {
      const itemId = await crearItemProducto();
      await ajustarStock(itemId, bodegaId, '100', '1000');

      // Las dos toman el lock de `item_producto` antes de leer el stock
      // total, así que la segunda ve la entrada de la primera. Las compras
      // son simétricas (10 kg a $1.500 cada una) para que el resultado sea
      // el mismo en cualquier orden:
      //   1ª: (100×1.000 + 10×1.500) / 110 = 1.045,4545
      //   2ª: (110×1.045,4545 + 10×1.500) / 120 = 1.083,3333
      // Si las dos leyeran el total antes de que la otra commitee (100 kg),
      // la última en escribir dejaría 1.045,4545. Eso depende del
      // intercalado, así que este caso lo ve cuando ocurre, no en cada
      // corrida; el orden de lectura lo explica el comentario de
      // `registrarMovimiento`.
      await Promise.all([
        ajustarStock(itemId, localId, '10', '1500'),
        ajustarStock(itemId, bodegaId, '10', '1500'),
      ]);

      expect(await costoActualDe(itemId)).toBe('1083.3333');
    },
  );
});
