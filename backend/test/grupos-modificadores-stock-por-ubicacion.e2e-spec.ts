import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

/**
 * Red de la Tarea 3b (GIRAR 2/2) del plan de bodegas:
 * `docs/superpowers/plans/2026-09-06-bodegas-y-traslados.md`.
 *
 * `GET /grupos-modificadores` y `GET /grupos-modificadores/:id` son catálogo
 * admin: el `stock` de cada opción es informativo (no hay ningún consumidor,
 * backend ni frontend, que lo use para decidir si una opción se puede pedir
 * — eso lo resuelve `GET /items/:id` con `stockDisponible`, ya migrado en la
 * Tarea 3a). Por eso el `stock` de acá tiene que seguir siendo el TOTAL del
 * tenant, no el del local.
 *
 * ⚠️ Misma muleta declarada que `items-stock-por-ubicacion.e2e-spec.ts`: el
 * stock de la bodega se planta con SQL directo a `stock_ubicacion` porque
 * `POST /traslados` todavía no existe (Tarea 9 del plan).
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
}
interface GrupoModificadorResponse {
  grupoModificadorId: string;
}
interface OpcionResponse {
  itemId: string;
  stock: string | null;
}
interface GrupoDetalleResponse {
  opciones: OpcionResponse[];
}
interface GrupoListaItem {
  grupoModificadorId: string;
  opciones: OpcionResponse[];
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

describe('Grupos de modificadores — stock por ubicación (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('el stock de la opción, en findOne y en findAll, es el TOTAL del tenant, no el del local', async () => {
    // 1. Una bodega nueva para este tenant.
    const resBodega = await request(app.getHttpServer())
      .post('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Bodega GM stock E2E ${Date.now()}`,
        tipo: 'bodega',
      });
    expect(resBodega.status).toBe(201);
    const bodegaId = (resBodega.body as UbicacionResponse).id;

    // 2. Un producto nuevo, que va a ser la opción del grupo.
    const nombreItem = `Item opción GM stock E2E ${Date.now()}-${Math.random()}`;
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

    // 3. 10 en el local, por la API real.
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

    // 4. 20 en la bodega — la muleta declarada arriba. 10 y 20 a propósito,
    // no números iguales: así un mutante que lea el local donde va el total
    // (o viceversa) no sobrevive.
    await ds.query(
      `INSERT INTO stock_ubicacion (item_id, ubicacion_id, stock) VALUES ($1, $2, '20.0000')`,
      [itemId, bodegaId],
    );

    // 5. El grupo con ese item como única opción.
    const resGrupo = await request(app.getHttpServer())
      .post('/api/grupos-modificadores')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Grupo GM stock E2E ${Date.now()}`,
        opciones: [{ itemId, cantidad: '1', precioExtra: '0' }],
      });
    expect(resGrupo.status).toBe(201);
    const grupoId = (resGrupo.body as GrupoModificadorResponse)
      .grupoModificadorId;

    // 6. GET /grupos-modificadores/:id (cargarGrupo): 30, no 10.
    const resDetalle = await request(app.getHttpServer())
      .get(`/api/grupos-modificadores/${grupoId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDetalle.status).toBe(200);
    const opcionDetalle = (
      resDetalle.body as GrupoDetalleResponse
    ).opciones.find((o) => o.itemId === itemId);
    expect(opcionDetalle).toBeDefined();
    expect(opcionDetalle!.stock).toBe('30.0000');

    // 7. GET /grupos-modificadores (findAll, batcheado): mismo número.
    const resLista = await request(app.getHttpServer())
      .get('/api/grupos-modificadores')
      .set('Authorization', `Bearer ${token}`);
    expect(resLista.status).toBe(200);
    const grupoEnLista = (resLista.body as GrupoListaItem[]).find(
      (g) => g.grupoModificadorId === grupoId,
    );
    expect(grupoEnLista).toBeDefined();
    const opcionEnLista = grupoEnLista!.opciones.find(
      (o) => o.itemId === itemId,
    );
    expect(opcionEnLista).toBeDefined();
    expect(opcionEnLista!.stock).toBe('30.0000');
  });
});
