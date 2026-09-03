import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
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
  costoActual: string | null;
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
  let ds: DataSource;
  let token: string;
  let itemId: string;
  let roturaCausaId: string;
  let mermaMovimientoId: string;
  let stockAntesDeLaMerma: string;
  // Sembrado por el test "sin costo" (más abajo); soft-deleted en el afterAll.
  let itemSinCostoId: string | undefined;
  // Ídem, el producto CON costo que esta suite se siembra para no comerse el
  // stock de un fixture compartido — ver el docblock de su test.
  let itemConCostoId: string | undefined;

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
  });

  afterAll(async () => {
    // Soft delete, no `DELETE`: mismo molde que
    // `items-pausados.e2e-spec.ts:814-824`. Sin esto, cada corrida local sin
    // `reset-db.sh` deja un ítem más sembrado en el tenant, y con
    // `ORDER BY i.nombre ASC` + el `pageSize` máximo (100) la acumulación
    // puede terminar empujando los fixtures del filtro `sinCosto` fuera de la
    // página — intermitente en vez de repetible.
    //
    // La causa "Rotura envase" se limpia por SQL y no por la API porque el
    // `DELETE` de una causa en uso devuelve 400 a propósito —lo afirma el
    // test de más abajo, que además la deja en uso con la merma que él mismo
    // registra—. Su nombre es fijo, así que sin esta limpieza la segunda
    // corrida sin `reset-db.sh` rebota en `assertNombreUnico` y arrastra 5 de
    // 9 tests (medido el 2026-08-28). El soft delete alcanza para liberar el
    // nombre porque el índice único es parcial (`WHERE eliminado_el IS NULL`,
    // `seeder.service.ts:1174`). Consecuencia asumida: la merma que quedó
    // registrada con esa causa pasa a listarse con `causaNombre: null`, porque
    // el JOIN de `mermas.service.ts:263` filtra igual — es lo mismo que
    // pasaría con un borrado real, y no lo mira ningún test.
    try {
      for (const id of [itemSinCostoId, itemConCostoId]) {
        if (!id) continue;
        await ds.query(
          `UPDATE items SET eliminado_el = NOW() WHERE item_id = $1`,
          [id],
        );
      }
      if (roturaCausaId) {
        await ds.query(
          `UPDATE causas_merma SET eliminado_el = NOW()
             WHERE causa_merma_id = $1`,
          [roturaCausaId],
        );
      }
    } finally {
      await app.close();
    }
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

  /**
   * ⚠️ **Se siembra el producto acá y no se usa el del seed** (decisión del
   * owner, 2026-09-03). Hasta entonces esto tomaba `Carne molida`, que nace con
   * **1,5 kg**; una corrida de este archivo se lleva **1,1** —1 kg la merma con
   * Vencimiento y 0,1 la de causa custom—, así que la segunda corrida sin
   * `reset-db.sh` en el medio fallaba **2 de 9** con *"Stock insuficiente para
   * la salida"*, y el `GET` que busca esa merma caía detrás. Medido en tres
   * corridas seguidas: 1,5 → 0,4 → 0,3 → 0,2.
   *
   * El seed no estaba mal: su margen está calculado para **una** pasada, que es
   * el flujo que manda `CLAUDE.md` (`reset-db.sh` antes de cada `test:e2e`). Lo
   * que cambia es de quién es el fixture: `combos.e2e-spec.ts` come del mismo
   * kilo y medio, así que gastarlo acá era pisarle el margen a otra suite.
   *
   * Molde: el mismo del *"Insumo sin costo E2E"* de más abajo, con soft delete
   * en el `afterAll`. ⛔ Lo que NO se puede hacer, para no redescubrirlo:
   * devolver el stock al final. Por API es escribir en `movimientos_inventario`
   * (`CLAUDE.md`: detenerse y preguntar) y por SQL directo sobre
   * `item_producto.stock` desincroniza el saldo materializado del kardex.
   */
  it('siembra su propio producto con stock y costo', async () => {
    const resCreate = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Insumo con costo E2E ${Date.now()}`,
        precioBase: '1000',
        monedaId: CLP_MONEDA_ID,
        // `ingrediente` y no `producto`, a propósito: es lo que era `Carne
        // molida` (el seeder la migra a ingrediente), y sembrarlo como producto
        // dejaba a la suite e2e **sin ningún caso de merma sobre un
        // ingrediente** — un mutante que estreche el guard de `mermas.service`
        // a `tipo !== 'producto'` habría sobrevivido el e2e entero. Lo levantó
        // la revisión del diff. El test "sin costo" de más abajo sigue siendo
        // `producto`, así que la suite cubre los dos.
        tipo: 'ingrediente',
        unidadMedida: 'kg',
      });
    expect(resCreate.status).toBe(201);
    itemId = (resCreate.body as ItemResponse).id;
    itemConCostoId = itemId;

    // Entrada CON `costoUnitario`: sin él `costo_actual` queda NULL y los tests
    // de `costoPerdido` de más abajo dejarían de probar lo que dicen. 5 kg
    // contra los 1,1 que la suite consume; el margen sobra porque el producto
    // nace de cero en cada corrida — con 1,2 alcanzaría igual.
    //
    // ⚠️ **Dentro de este endpoint**, `motivo` no es indistinto: solo
    // `['compra', 'anulacion', 'devolucion']` recalculan el CPP
    // (`MOTIVOS_QUE_RECALCULAN_CPP`, `inventario.service.ts`), así que con
    // `inventario_inicial` el stock entra igual y el costo queda en NULL —
    // medido acá, con los tres tests de costo en rojo antes de corregirlo.
    //
    // 📌 Y hay OTRA forma de hacerlo, que no es esta: `POST /items` acepta
    // `stock` y `costo` juntos y deja `costo_actual` no-NULL en una sola
    // llamada. Se usa el alta en dos pasos por el mismo motivo que
    // `costeo-cpp.e2e-spec`: una compra de 5 kg a 2.500 es una operación real
    // del dominio, y el fixture queda con un kardex que se puede leer.
    const resEntrada = await request(app.getHttpServer())
      .patch(`/api/items/${itemId}/stock`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        tipo: 'entrada',
        motivo: 'compra',
        cantidad: '5',
        costoUnitario: '2500',
      });
    expect(resEntrada.status).toBe(200);

    const res = await request(app.getHttpServer())
      .get(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
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

    // Producto CON costo (el que siembra esta suite): costoPerdido no puede ser
    // null acá. Narrow explícito en vez de ensanchar la aserción — si el
    // endpoint alguna vez devolviera null para este producto, el `throw`
    // hace fallar el test con un mensaje claro en vez de un TS2345 en
    // `npm run typecheck` (que `ts-jest` no corre por `isolatedModules`).
    const costoPerdido = body.costoPerdido;
    if (costoPerdido === null) {
      throw new Error(
        'costoPerdido no debería ser null: el producto tiene costo',
      );
    }
    expect(parseFloat(costoPerdido)).toBeGreaterThan(0);

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
    const itemCreado = resCreate.body as ItemResponse;
    itemSinCostoId = itemCreado.id;

    // Verifica el setup aparte de la aserción bajo prueba: si esto fallara,
    // tiene que verse como "el item nació con costo" y no confundirse con
    // el comportamiento nuevo de la merma.
    expect(itemCreado.costoActual).toBeNull();

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
    const bodyMerma = resMerma.body as MermaResponse;
    expect(bodyMerma.costoPerdido).toBeNull();
    expect(bodyMerma.costoUnitario).toBeNull();

    // Y contra lo persistido, no solo contra lo que el POST dice de sí
    // mismo (mismo criterio que la Regla 2 de la spec: sin valorizar
    // "para siempre" vive en el kardex, y GET /mermas deriva costoPerdido
    // de esa columna — un bug que devolviera null en el POST pero
    // congelara otra cosa en movimientos_inventario recién se vería acá).
    const resLista = await request(app.getHttpServer())
      .get('/api/mermas')
      .set('Authorization', `Bearer ${token}`);
    expect(resLista.status).toBe(200);
    const filaMerma = (resLista.body as PaginatedMermas).data.find(
      (m) => m.id === bodyMerma.movimientoId,
    );
    expect(filaMerma).toBeDefined();
    expect(filaMerma?.costoPerdido).toBeNull();
  });
});
