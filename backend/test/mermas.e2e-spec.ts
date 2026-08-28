import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const CARNE_MOLIDA_ID = '550e8400-e29b-41d4-a716-446655440257';
const CAUSA_VENCIMIENTO_ID = '550e8400-e29b-41d4-a716-446655440266';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface CausaMermaItem {
  id: string;
  nombre: string;
  esFijo: boolean;
}
interface ItemResponse {
  id: string;
}
interface MermaResponse {
  movimientoId: string;
  stockResultante: string;
  costoUnitario: string | null;
  costoPerdido: string | null;
  causaNombre: string;
}
interface MermaListItem {
  id: string;
  itemId: string;
  causaNombre: string | null;
  costoPerdido: string | null;
}
interface PaginatedMermas {
  data: MermaListItem[];
  meta: { total: number };
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

describe('Mermas — causas, registro y rechazo en ajuste (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let itemId: string;
  let roturaCausaId: string;
  let mermaMovimientoId: string;
  let stockAntesDeLaMerma: string;

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /causas-merma devuelve al menos 5 causas fijas del seed', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/causas-merma')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const causas = res.body as CausaMermaItem[];
    expect(Array.isArray(causas)).toBe(true);
    expect(causas.length).toBeGreaterThanOrEqual(5);

    const fijas = causas.filter((c) => c.esFijo);
    expect(fijas.length).toBeGreaterThanOrEqual(5);
    expect(fijas.some((c) => c.nombre === 'Vencimiento')).toBe(true);
  });

  it('POST /causas-merma crea causa custom Rotura envase', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/causas-merma')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Rotura envase' });

    expect(res.status).toBe(201);
    roturaCausaId = (res.body as { id: string }).id;
    expect(roturaCausaId).toBeDefined();
  });

  it('usa producto seed Carne molida con stock y costo', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/items/${CARNE_MOLIDA_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    itemId = CARNE_MOLIDA_ID;
    expect(res.body.costoActual).toBeTruthy();
    expect(parseFloat(res.body.stock as string)).toBeGreaterThan(0);
    stockAntesDeLaMerma = res.body.stock as string;
  });

  it('POST /mermas registra merma con Vencimiento y costoPerdido', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/mermas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId,
        cantidad: '1',
        causaMermaId: CAUSA_VENCIMIENTO_ID,
        comentario: 'E2E merma vencimiento',
      });

    expect(res.status).toBe(201);
    const body = res.body as MermaResponse;
    mermaMovimientoId = body.movimientoId;
    expect(body.causaNombre).toBe('Vencimiento');
    expect(body.costoUnitario).toBeTruthy();
    expect(body.costoPerdido).toBeTruthy();
    expect(parseFloat(body.costoPerdido)).toBeGreaterThan(0);

    // El efecto de una merma sobre el saldo no lo fijaba NADA de extremo a
    // extremo, y ésta es la única capa que corre contra Postgres real. La
    // respuesta ya traía `stockResultante` y el test no lo miraba.
    expect(parseFloat(body.stockResultante)).toBeCloseTo(
      parseFloat(stockAntesDeLaMerma) - 1,
      4,
    );

    // Y contra la base, no solo contra lo que el POST dice de sí mismo: un
    // `stockResultante` bien calculado y mal persistido pasaría lo de arriba.
    const resItem = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resItem.status).toBe(200);
    expect(parseFloat(resItem.body.stock as string)).toBeCloseTo(
      parseFloat(body.stockResultante),
      4,
    );
  });

  it('GET /mermas incluye causaNombre y costoPerdido', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/mermas')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const list = res.body as PaginatedMermas;
    expect(list.data.length).toBeGreaterThan(0);

    const fila = list.data.find((m) => m.id === mermaMovimientoId);
    expect(fila).toBeDefined();
    expect(fila?.causaNombre).toBe('Vencimiento');
    expect(fila?.costoPerdido).toBeTruthy();
  });

  it('PATCH /items/:id/stock con motivo merma es rechazado (400)', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'salida',
        motivo: 'merma',
        cantidad: '1',
      });

    expect(res.status).toBe(400);
  });

  // El `@IsOptional()` sin `@IsNotEmpty()` dejaba pasar `''`: el service solo
  // mira `if (dto.nombre !== undefined)`, así que persistía el `.trim()` y la
  // causa quedaba sin nombre, apareciendo como una opción en blanco en el
  // selector de `mermas.vue`. Va a nivel e2e porque el que rechaza es el
  // `ValidationPipe`, que en unit no corre.
  it('PATCH de una causa con el nombre vacío devuelve 400 y no la deja sin nombre', async () => {
    // Los tres valores que rompían de tres formas distintas, y cada uno lo
    // ataja un decorador distinto del DTO: `''` el `@IsNotEmpty()`, `'   '` el
    // `@Transform` que trimea antes de validar, y `null` el `@ValidateIf` que
    // reemplazó al `@IsOptional()` (que trataba null como ausente y se salteaba
    // todo, dejando que el service hiciera `.trim()` sobre null → 500 crudo).
    for (const invalido of ['', '   ', null]) {
      const res = await request(app.getHttpServer())
        .patch(`/api/causas-merma/${roturaCausaId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ nombre: invalido });
      expect(res.status).toBe(400);
    }

    // Y la fila sigue con su nombre: el rechazo ocurrió antes de escribir.
    const resLista = await request(app.getHttpServer())
      .get('/api/causas-merma')
      .set('Authorization', `Bearer ${token}`);
    expect(resLista.status).toBe(200);
    const causa = (resLista.body as { id: string; nombre: string }[]).find(
      (c) => c.id === roturaCausaId,
    );
    expect(causa?.nombre).toBeTruthy();
  });

  it('PATCH causa fija y DELETE causa en uso devuelven 400', async () => {
    const resPatch = await request(app.getHttpServer())
      .patch(`/api/causas-merma/${CAUSA_VENCIMIENTO_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Vencimiento modificado' });
    expect(resPatch.status).toBe(400);

    const resMermaCustom = await request(app.getHttpServer())
      .post('/api/mermas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId,
        cantidad: '0.1',
        causaMermaId: roturaCausaId,
      });
    expect(resMermaCustom.status).toBe(201);

    const resDelete = await request(app.getHttpServer())
      .delete(`/api/causas-merma/${roturaCausaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDelete.status).toBe(400);
  });

  it('la merma de un producto sin costo se registra sin valorizar', async () => {
    const resCreate = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Insumo sin costo E2E ${Date.now()}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'kg',
      });
    expect(resCreate.status).toBe(201);
    const itemSinCostoId = (resCreate.body as ItemResponse).id;

    // Entrada de stock SIN costoUnitario, para que costo_actual quede en NULL.
    const resEntrada = await request(app.getHttpServer())
      .patch(`/api/items/${itemSinCostoId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'inventario_inicial',
        cantidad: '5',
      });
    expect(resEntrada.status).toBe(200);

    const resMerma = await request(app.getHttpServer())
      .post('/api/mermas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId: itemSinCostoId,
        cantidad: '1',
        causaMermaId: CAUSA_VENCIMIENTO_ID,
      });
    expect(resMerma.status).toBe(201);
    expect((resMerma.body as MermaResponse).costoPerdido).toBeNull();
    expect((resMerma.body as MermaResponse).costoUnitario).toBeNull();
  });
});
