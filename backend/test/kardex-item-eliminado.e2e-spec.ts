import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

/**
 * "Lo que está en el kardex queda en el kardex."
 *
 * Dar de baja un producto no puede borrar de las pantallas de auditoría los
 * movimientos que ya ocurrieron. Lo que hacía el filtro `i.eliminado_el IS NULL`
 * no era dejar la fila vacía ni tachada: estaba también en el `COUNT(*)`, así
 * que **el total bajaba** y la pantalla informaba menos movimientos de los que
 * hay, sin decir que ocultaba nada.
 *
 * Por eso cada caso de acá compara el `meta.total` además de las filas: un fix
 * que corrija solo el listado deja el total mintiendo, y un test que cuente
 * `data.length` no lo nota.
 */

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const CAUSA_VENCIMIENTO_ID = '550e8400-e29b-41d4-a716-446655440266';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface ItemResponse {
  id: string;
}
interface MovimientoListItem {
  id: string;
  itemId: string;
  itemNombre: string;
  motivo: string;
  itemEliminado: boolean;
}
interface MermaListItem {
  id: string;
  itemId: string;
  itemNombre: string;
  itemEliminado: boolean;
}
interface Paginated<T> {
  data: T[];
  meta: { total: number };
}
interface RecuentoCreateResponse {
  id: string;
}
interface RecuentoLinea {
  lineaId: string;
  itemId: string;
  itemNombre: string | null;
  itemEliminado: boolean;
}
interface RecuentoDetalleResponse {
  estado: string;
  lineas: RecuentoLinea[];
}
interface RecuentoListItem {
  id: string;
  cantidadLineas: number;
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

describe('Kardex, mermas y recuento con el ítem eliminado (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let itemId: string;

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

    // Producto propio del spec: el del seed lo comparten otras suites y acá se
    // lo elimina, que es justo lo que no se le puede hacer a un ítem prestado.
    const resItem = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Producto kardex eliminado E2E ${Date.now()}`,
        precioBase: '10000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
      });
    expect(resItem.status).toBe(201);
    itemId = (resItem.body as ItemResponse).id;

    const resStock = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: '10',
        costoUnitario: '1000',
      });
    expect(resStock.status).toBe(200);

    const resMerma = await request(app.getHttpServer())
      .post('/api/mermas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId,
        cantidad: '1',
        causaMermaId: CAUSA_VENCIMIENTO_ID,
        comentario: 'E2E kardex con ítem eliminado',
      });
    expect(resMerma.status).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  async function kardex(): Promise<Paginated<MovimientoListItem>> {
    const res = await request(app.getHttpServer())
      .get(`/api/inventario/movimientos?itemId=${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as Paginated<MovimientoListItem>;
  }

  async function mermas(): Promise<Paginated<MermaListItem>> {
    const res = await request(app.getHttpServer())
      .get(`/api/mermas?itemId=${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body as Paginated<MermaListItem>;
  }

  let totalKardexAntes: number;
  let totalMermasAntes: number;
  let recuentoId: string;

  it('con el producto vivo: el kardex y las mermas lo listan sin marcar', async () => {
    const k = await kardex();
    // compra + merma
    expect(k.meta.total).toBeGreaterThanOrEqual(2);
    expect(k.data.every((m) => m.itemEliminado === false)).toBe(true);
    totalKardexAntes = k.meta.total;

    const m = await mermas();
    expect(m.meta.total).toBeGreaterThanOrEqual(1);
    expect(m.data.every((x) => x.itemEliminado === false)).toBe(true);
    totalMermasAntes = m.meta.total;
  });

  it('deja abierta una sesión de recuento sobre el producto', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/recuentos')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemIds: [itemId] });
    expect(res.status).toBe(201);
    recuentoId = (res.body as RecuentoCreateResponse).id;
  });

  it('el producto con kardex se puede eliminar: no se bloquea la baja', async () => {
    // Impedir discontinuar un producto que alguna vez se movió equivale a no
    // poder discontinuar casi ninguno. La decisión fue conservar el rastro, no
    // frenar la baja.
    const res = await request(app.getHttpServer())
      .delete(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect([200, 204]).toContain(res.status);
  });

  it('el kardex conserva los movimientos y el TOTAL no baja', async () => {
    const k = await kardex();
    expect(k.meta.total).toBe(totalKardexAntes);
    expect(k.data.length).toBeGreaterThanOrEqual(2);
    expect(k.data.every((m) => m.itemEliminado === true)).toBe(true);
    // El nombre sobrevive: el ítem sigue en `items`, solo con `eliminado_el`.
    expect(k.data.every((m) => !!m.itemNombre)).toBe(true);
  });

  it('el listado de mermas conserva la merma y el TOTAL no baja', async () => {
    const m = await mermas();
    expect(m.meta.total).toBe(totalMermasAntes);
    expect(m.data.length).toBeGreaterThanOrEqual(1);
    expect(m.data.every((x) => x.itemEliminado === true)).toBe(true);
    expect(m.data.every((x) => !!x.itemNombre)).toBe(true);
  });

  it('el detalle del recuento muestra la línea marcada, y ya no discrepa del listado', async () => {
    const resDetalle = await request(app.getHttpServer())
      .get(`/api/recuentos/${recuentoId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDetalle.status).toBe(200);
    const detalle = resDetalle.body as RecuentoDetalleResponse;

    const linea = detalle.lineas.find((l) => l.itemId === itemId);
    expect(linea).toBeDefined();
    expect(linea!.itemEliminado).toBe(true);
    expect(linea!.itemNombre).toBeTruthy();

    // El desacuerdo que motivó la entrada: el listado contaba una línea que el
    // detalle escondía.
    const resList = await request(app.getHttpServer())
      .get('/api/recuentos')
      .set('Authorization', `Bearer ${token}`);
    expect(resList.status).toBe(200);
    const fila = (resList.body as { data: RecuentoListItem[] }).data.find(
      (r) => r.id === recuentoId,
    );
    expect(fila).toBeDefined();
    expect(detalle.lineas).toHaveLength(fila!.cantidadLineas);
  });

  it('sobre el producto eliminado se rechaza una compra, nombrándolo', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: '5',
        costoUnitario: '1000',
      });
    // 404 del propio `ajustarStock`, que filtra el ítem antes de llegar al
    // chokepoint. El guard de `registrarMovimiento` es la red de abajo —
    // cubierto en el unit test, porque por API no hay forma de saltarse este
    // 404 (se midió caller por caller).
    expect(res.status).toBe(404);
  });
});
