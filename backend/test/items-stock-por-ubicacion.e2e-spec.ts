import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * Red de la Tarea 3a (GIRAR 1/2) del plan de bodegas:
 * `docs/superpowers/specs/2026-09-06-bodegas-y-traslados-design.md` § 5.4.
 * `GET /items` y `GET /items/:id` tienen que devolver los TRES números —
 * `stock` (total del tenant), `stockVendible` (el del local) y
 * `stockDisponible` (`stockVendible − comprometido`, sin cuentas abiertas acá
 * es el mismo número que `stockVendible`)— calculados desde `stock_ubicacion`,
 * y `GET /items/:id` gana el desglose por ubicación.
 *
 * ⚠️ **Muleta declarada, no patrón a copiar.** El stock de la bodega se
 * planta con SQL directo a `stock_ubicacion` porque todavía no existe
 * `POST /traslados` (llega en la Tarea 9 del plan). Cuando exista, este e2e
 * se reescribe para armar el escenario por la API: un escenario que solo se
 * puede montar con SQL suele estar escondiendo un caso que la API no puede
 * producir, y dejarlo así congelaría un estado imposible.
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
interface UbicacionResponse {
  id: string;
  tipo: 'local' | 'bodega';
}
interface ItemListado {
  id: string;
  stock: string;
  stockVendible: string;
  stockDisponible: string;
}
interface ItemListaResponse {
  data: ItemListado[];
}
interface DesgloseUbicacion {
  ubicacionId: string;
  nombre: string;
  stock: string;
}
interface ItemDetalleResponse {
  id: string;
  stock: string;
  stockVendible: string;
  desglosePorUbicacion: DesgloseUbicacion[];
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

describe('items — stock por ubicación (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let localId: string;

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

    ds = app.get(DataSource);
    token = await login(app);

    const rows: { ubicacion_id: string }[] = await ds.query(
      `SELECT ubicacion_id FROM ubicaciones WHERE tenant_id = $1 AND tipo = 'local' AND eliminado_el IS NULL`,
      [PARIS_TENANT_ID],
    );
    localId = rows[0].ubicacion_id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('stock es el total, stockVendible el del local, y stockDisponible frena solo por el local', async () => {
    // 1. Una bodega nueva para este tenant.
    const resBodega = await request(app.getHttpServer())
      .post('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Bodega stock-por-ubicacion E2E ${Date.now()}`,
        tipo: 'bodega',
      });
    expect(resBodega.status).toBe(201);
    const bodegaId = (resBodega.body as UbicacionResponse).id;

    // 2. Un producto nuevo.
    const nombreItem = `Item stock-por-ubicacion E2E ${Date.now()}-${Math.random()}`;
    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: nombreItem,
        precioBase: '1000',
        precioIncluyeImpuesto: true,
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
      });
    expect(resItem.status).toBe(201);
    const itemId = (resItem.body as ItemResponse).id;

    // 3. 10 en el local, por la API real: la compra (sin `ubicacionId` en el
    // body todavía — eso lo gana recién la Tarea 5) cae por default en el
    // local (`InventarioService` resuelve `UbicacionesService.localDe`).
    await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: '10',
        costoUnitario: '500',
      })
      .expect(200);

    // 4. 20 en la bodega — la muleta declarada arriba: sin `POST /traslados`
    // todavía, es la única forma de poner stock ahí. 10 y 20 a propósito, no
    // números iguales: así un mutante que devuelva el total donde va el
    // vendible (o viceversa) no sobrevive.
    await ds.query(
      `INSERT INTO stock_ubicacion (item_id, ubicacion_id, stock) VALUES ($1, $2, '20.0000')`,
      [itemId, bodegaId],
    );

    // 5. GET /items: los tres números de la fila, con el salón vacío
    // (sin cuentas abiertas, `stockDisponible` = `stockVendible`).
    const resLista = await request(app.getHttpServer())
      .get(`/api/items?search=${encodeURIComponent(nombreItem)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resLista.status).toBe(200);
    const fila = (resLista.body as ItemListaResponse).data.find(
      (d) => d.id === itemId,
    );
    expect(fila).toBeDefined();
    expect(fila!.stock).toBe('30.0000');
    expect(fila!.stockVendible).toBe('10.0000');
    expect(fila!.stockDisponible).toBe('10.0000');

    // 6. GET /items/:id: `stock` y `stockVendible` (no `stockDisponible` —
    // ese vive en `GET /items` y en las filas anidadas del drawer de
    // personalización; el detalle de un producto suelto no lo tuvo nunca,
    // ver `docs/superpowers/specs/2026-09-06-bodegas-y-traslados-design.md`
    // § 6), más el desglose — el local primero (aunque el nombre de la
    // bodega gane alfabéticamente), después las bodegas por nombre.
    const resDetalle = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDetalle.status).toBe(200);
    const detalle = resDetalle.body as ItemDetalleResponse;
    expect(detalle.stock).toBe('30.0000');
    expect(detalle.stockVendible).toBe('10.0000');
    expect(detalle.desglosePorUbicacion).toEqual([
      { ubicacionId: localId, nombre: expect.any(String), stock: '10.0000' },
      { ubicacionId: bodegaId, nombre: expect.any(String), stock: '20.0000' },
    ]);
  });
});
