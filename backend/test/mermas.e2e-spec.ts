import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { localDelSegundoTenant } from './helpers/segundo-tenant';

const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const MOTIVO_VENCIMIENTO_ID = '550e8400-e29b-41d4-a716-446655440266';
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';

const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface MotivoBajaItem {
  id: string;
  nombre: string;
  esFijo: boolean;
}
interface ItemResponse {
  id: string;
  costoActual: string | null;
  /** El stock DEL LOCAL (`docs/features/bodegas-y-traslados.md`, «GET /items,
   *  GET /items/:id»). `stock` a secas es el TOTAL de todas las ubicaciones —
   *  no sirve para afirmar "el local no se movió". */
  stockVendible: string | null;
}
interface MermaResponse {
  movimientoId: string;
  stockResultante: string;
  costoUnitario: string | null;
  costoPerdido: string | null;
  motivoBajaNombre: string;
}
interface UbicacionListada {
  id: string;
  nombre: string;
  tipo: 'local' | 'bodega';
}
interface MermaListItem {
  id: string;
  itemId: string;
  motivoBajaId: string | null;
  motivoBajaNombre: string | null;
  costoPerdido: string | null;
  /** Task 4: `true` cuando el movimiento nace de anular un plato en mesa
   *  (`cuenta_linea_anulacion_id IS NOT NULL`), no de una merma de bodega. */
  deAnulacion: boolean;
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

describe('Mermas — motivos, registro y rechazo en ajuste (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let localId: string;
  let itemId: string;
  let roturaMotivoId: string;
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

    const resUbic = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${token}`);
    expect(resUbic.status).toBe(200);
    localId = (resUbic.body as UbicacionListada[]).find(
      (u) => u.tipo === 'local',
    )!.id;
  });

  afterAll(async () => {
    // Soft delete, no `DELETE`: mismo molde que
    // `items-pausados.e2e-spec.ts:814-824`. Sin esto, cada corrida local sin
    // `reset-db.sh` deja un ítem más sembrado en el tenant, y con
    // `ORDER BY i.nombre ASC` + el `pageSize` máximo (100) la acumulación
    // puede terminar empujando los fixtures del filtro `sinCosto` fuera de la
    // página — intermitente en vez de repetible.
    //
    // El motivo "Rotura envase" se limpia por SQL y no por la API porque el
    // `DELETE` de un motivo en uso devuelve 400 a propósito —lo afirma el
    // test de más abajo, que además la deja en uso con la merma que él mismo
    // registra—. Su nombre es fijo, así que sin esta limpieza la segunda
    // corrida sin `reset-db.sh` rebota en `assertNombreUnico` y arrastra 5 de
    // 9 tests (medido el 2026-08-28). El soft delete alcanza para liberar el
    // nombre porque el índice único es parcial (`WHERE eliminado_el IS NULL`,
    // `seeder.service.ts:1174`). Consecuencia asumida: la merma que quedó
    // registrada con ese motivo pasa a listarse con `motivoBajaNombre: null`, porque
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
      if (roturaMotivoId) {
        await ds.query(
          `UPDATE motivo_baja SET eliminado_el = NOW()
             WHERE motivo_baja_id = $1`,
          [roturaMotivoId],
        );
      }
    } finally {
      await app.close();
    }
  });

  it('GET /motivos-baja devuelve al menos 5 motivos fijos del seed', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/motivos-baja')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const motivos = res.body as MotivoBajaItem[];
    expect(Array.isArray(motivos)).toBe(true);
    expect(motivos.length).toBeGreaterThanOrEqual(5);

    const fijas = motivos.filter((c) => c.esFijo);
    expect(fijas.length).toBeGreaterThanOrEqual(5);
    expect(fijas.some((c) => c.nombre === 'Vencimiento')).toBe(true);
  });

  it('GET /motivos-baja?tipo=merma no devuelve cortesía ni no_elaborado', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/motivos-baja?tipo=merma')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const motivos = res.body as { nombre: string; tipo: string }[];
    expect(motivos.length).toBeGreaterThanOrEqual(5);
    expect(motivos.every((m) => m.tipo === 'merma')).toBe(true);
  });

  it('POST /motivos-baja crea motivo custom Rotura envase', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/motivos-baja')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Rotura envase', tipo: 'merma' });

    expect(res.status).toBe(201);
    roturaMotivoId = (res.body as { id: string }).id;
    expect(roturaMotivoId).toBeDefined();
  });

  /**
   * ⚠️ **Se siembra el producto acá y no se usa el del seed** (decisión del
   * owner, 2026-09-03). Hasta entonces esto tomaba `Carne molida`, que nace con
   * **1,5 kg**; una corrida de este archivo se lleva **1,1** —1 kg la merma con
   * Vencimiento y 0,1 la de motivo custom—, así que la segunda corrida sin
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
        ubicacionId: localId,
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
        ubicacionId: localId,
        cantidad: '1',
        motivoBajaId: MOTIVO_VENCIMIENTO_ID,
        comentario: 'E2E merma vencimiento',
      });

    expect(res.status).toBe(201);
    const body = res.body as MermaResponse;
    mermaMovimientoId = body.movimientoId;
    expect(body.motivoBajaNombre).toBe('Vencimiento');
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

  it('POST /mermas con "Cortesía de la casa" da 400, y con Deterioro 201', async () => {
    const resMotivos = await request(app.getHttpServer())
      .get('/api/motivos-baja')
      .set('Authorization', `Bearer ${token}`);
    expect(resMotivos.status).toBe(200);
    const motivos = resMotivos.body as MotivoBajaItem[];
    const cortesia = motivos.find((m) => m.nombre === 'Cortesía de la casa')!;
    const deterioro = motivos.find((m) => m.nombre === 'Deterioro')!;
    expect(cortesia).toBeDefined();
    expect(deterioro).toBeDefined();

    const rechazada = await request(app.getHttpServer())
      .post('/api/mermas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId,
        ubicacionId: localId,
        cantidad: '0.1',
        motivoBajaId: cortesia.id,
      });
    expect(rechazada.status).toBe(400);

    const aceptada = await request(app.getHttpServer())
      .post('/api/mermas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId,
        ubicacionId: localId,
        cantidad: '0.1',
        motivoBajaId: deterioro.id,
      });
    expect(aceptada.status).toBe(201);
  });

  it('GET /mermas incluye motivoBajaNombre y costoPerdido', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/mermas')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const list = res.body as PaginatedMermas;
    expect(list.data.length).toBeGreaterThan(0);

    const fila = list.data.find((m) => m.id === mermaMovimientoId);
    expect(fila).toBeDefined();
    expect(fila?.motivoBajaNombre).toBe('Vencimiento');
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
  // motivo quedaba sin nombre, apareciendo como una opción en blanco en el
  // selector de `mermas.vue`. Va a nivel e2e porque el que rechaza es el
  // `ValidationPipe`, que en unit no corre.
  it('PATCH de un motivo con el nombre vacío devuelve 400 y no la deja sin nombre', async () => {
    // Los tres valores que rompían de tres formas distintas, y cada uno lo
    // ataja un decorador distinto del DTO: `''` el `@IsNotEmpty()`, `'   '` el
    // `@Transform` que trimea antes de validar, y `null` el `@ValidateIf` que
    // reemplazó al `@IsOptional()` (que trataba null como ausente y se salteaba
    // todo, dejando que el service hiciera `.trim()` sobre null → 500 crudo).
    for (const invalido of ['', '   ', null]) {
      const res = await request(app.getHttpServer())
        .patch(`/api/motivos-baja/${roturaMotivoId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ nombre: invalido });
      expect(res.status).toBe(400);
    }

    // Y la fila sigue con su nombre: el rechazo ocurrió antes de escribir.
    const resLista = await request(app.getHttpServer())
      .get('/api/motivos-baja')
      .set('Authorization', `Bearer ${token}`);
    expect(resLista.status).toBe(200);
    const motivo = (resLista.body as { id: string; nombre: string }[]).find(
      (c) => c.id === roturaMotivoId,
    );
    expect(motivo?.nombre).toBeTruthy();
  });

  it('PATCH motivo fijo y DELETE motivo en uso devuelven 400', async () => {
    const resPatch = await request(app.getHttpServer())
      .patch(`/api/motivos-baja/${MOTIVO_VENCIMIENTO_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Vencimiento modificado' });
    expect(resPatch.status).toBe(400);

    const resMermaCustom = await request(app.getHttpServer())
      .post('/api/mermas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId,
        ubicacionId: localId,
        cantidad: '0.1',
        motivoBajaId: roturaMotivoId,
      });
    expect(resMermaCustom.status).toBe(201);

    const resDelete = await request(app.getHttpServer())
      .delete(`/api/motivos-baja/${roturaMotivoId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(resDelete.status).toBe(400);
  });

  // Depende del orden del archivo: va DESPUÉS del test de arriba, que registra
  // una merma con `roturaMotivoId` y lo deja en uso.
  it('cambiar el tipo de un motivo propio después de usarlo da 400', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/motivos-baja/${roturaMotivoId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'no_elaborado' });
    expect(res.status).toBe(400);
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
        ubicacionId: localId,
        cantidad: '5',
      });
    expect(resEntrada.status).toBe(200);

    const resMerma = await request(app.getHttpServer())
      .post('/api/mermas')
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId: itemSinCostoId,
        ubicacionId: localId,
        cantidad: '1',
        motivoBajaId: MOTIVO_VENCIMIENTO_ID,
      });
    expect(resMerma.status).toBe(201);
    const bodyMerma = resMerma.body as MermaResponse;
    expect(bodyMerma.costoPerdido).toBeNull();
    expect(bodyMerma.costoUnitario).toBeNull();

    // Y contra lo persistido, no solo contra lo que el POST dice de sí mismo
    // (mismo criterio que la regla 2 de
    // `docs/superpowers/specs/2026-08-28-merma-sin-costo-tipeado-design.md`:
    // sin valorizar "para siempre" vive en el kardex, y GET /mermas deriva
    // costoPerdido de esa columna — un bug que devolviera null en el POST pero
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

  // Frente de bodegas y traslados: la merma pasa a decir DÓNDE ocurrió. Este
  // bloque cubre las tres formas nuevas de fallar/acertar.
  describe('ubicacionId — la merma dice de dónde sale', () => {
    it('POST /mermas sin ubicacionId → 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/mermas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          itemId,
          cantidad: '0.1',
          motivoBajaId: MOTIVO_VENCIMIENTO_ID,
        });
      expect(res.status).toBe(400);
    });

    it('un ubicacionId de otro tenant da 404, y la merma no se registra', async () => {
      // Stock ANTES del intento, no el snapshot original de la suite: para
      // este punto ya corrieron otras mermas sobre el mismo `itemId` y
      // comparar contra el valor de arriba daría un falso negativo.
      const resItemAntes = await request(app.getHttpServer())
        .get(`/api/items/${itemId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(resItemAntes.status).toBe(200);
      const stockAntes = resItemAntes.body.stock as string;

      const { localId: ubicacionFalabellaId } =
        await localDelSegundoTenant(app);

      const res = await request(app.getHttpServer())
        .post('/api/mermas')
        .set('Authorization', `Bearer ${token}`) // token de PARIS
        .send({
          itemId,
          ubicacionId: ubicacionFalabellaId,
          cantidad: '0.1',
          motivoBajaId: MOTIVO_VENCIMIENTO_ID,
        });
      expect(res.status).toBe(404);

      // Y no dejó rastro: el GET del ítem sigue con el mismo stock local.
      const resItemDespues = await request(app.getHttpServer())
        .get(`/api/items/${itemId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(resItemDespues.status).toBe(200);
      expect(resItemDespues.body.stock).toBe(stockAntes);
    });

    /**
     * Números que DISCRIMINAN local de bodega a propósito (10 y 20): si el
     * service ignorara `dto.ubicacionId` y siguiera escribiendo en el local (el
     * bug que este mismo frente ya tuvo en el recuento — ver el tapón de
     * `recuentos.service.ts`), este test lo agarra porque local y bodega
     * arrancan en cantidades DISTINTAS. Con números iguales un mutante que
     * leyera la ubicación equivocada sobreviviría.
     */
    it('con ubicacionId de una bodega, la merma descuenta AHÍ y el local no se mueve', async () => {
      const resBodega = await request(app.getHttpServer())
        .post('/api/ubicaciones')
        .set('Authorization', `Bearer ${token}`)
        .send({ nombre: `Bodega Mermas E2E ${Date.now()}`, tipo: 'bodega' });
      expect(resBodega.status).toBe(201);
      const bodegaId = (resBodega.body as { id: string }).id;

      const resItem = await request(app.getHttpServer())
        .post('/api/items')
        .set('Authorization', `Bearer ${token}`)
        .send({
          nombre: `Producto bodega merma E2E ${Date.now()}`,
          precioBase: '1000',
          monedaId: CLP_MONEDA_ID,
          tipo: 'producto',
          unidadMedida: 'unidad',
          stock: '30', // nace entero en el local
        });
      expect(resItem.status).toBe(201);
      const itemBodegaId = (resItem.body as ItemResponse).id;

      const resMotivos = await request(app.getHttpServer())
        .get('/api/motivos-traslado?soloActivas=true')
        .set('Authorization', `Bearer ${token}`);
      expect(resMotivos.status).toBe(200);
      const motivoTrasladoId = (resMotivos.body as { id: string }[])[0].id;

      // Local 30 → traslada 20 a la bodega: local 10, bodega 20.
      const resTraslado = await request(app.getHttpServer())
        .post('/api/traslados')
        .set('Authorization', `Bearer ${token}`)
        .send({
          origenId: localId,
          destinoId: bodegaId,
          motivoTrasladoId,
          lineas: [{ itemId: itemBodegaId, cantidad: '20' }],
        });
      expect(resTraslado.status).toBe(201);

      const resMerma = await request(app.getHttpServer())
        .post('/api/mermas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          itemId: itemBodegaId,
          ubicacionId: bodegaId,
          cantidad: '5',
          motivoBajaId: MOTIVO_VENCIMIENTO_ID,
        });
      expect(resMerma.status).toBe(201);
      // `stockResultante` es el saldo de la UBICACIÓN del movimiento (la
      // bodega), no el total ni el del local: 20 − 5 = 15.
      expect(
        parseFloat((resMerma.body as MermaResponse).stockResultante),
      ).toBeCloseTo(15, 4);

      // El local, sin tocar: sigue en 10, no en 5 (que sería el bug de
      // escribir la merma en el local pese al ubicacionId de la bodega).
      const resItemFinal = await request(app.getHttpServer())
        .get(`/api/items/${itemBodegaId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(resItemFinal.status).toBe(200);
      // `stockVendible`, no `stock`: ese último es el TOTAL de todas las
      // ubicaciones (10 en el local + 15 en la bodega = 25) y pasaría el test
      // aunque la merma hubiera descontado del local por error.
      expect(
        parseFloat((resItemFinal.body as ItemResponse).stockVendible!),
      ).toBeCloseTo(10, 4);
    });
  });
});

// Describe propio: un tenant recién creado, para afirmar el seed de los siete
// motivos fijos con su tipo — tocar `Paris` acá le rompería el resto de la
// suite de arriba. Molde de `crearTenantEn`/`entrarA` calcado de
// `redondeo-por-pais.e2e-spec.ts` (superadmin, POST /api/admin/tenants,
// switch-tenant).
describe('Motivos de baja — un tenant nuevo nace con los siete fijos (e2e)', () => {
  let app: INestApplication<App>;
  const PROV_RM = '550e8400-e29b-41d4-a716-446655440001'; // Chile
  const SUPERADMIN = { email: 'admin@sistema.com', pass: 'admin' };

  async function crearTenantEn(provinciaId: string): Promise<{ id: string }> {
    const loginSuper = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: SUPERADMIN.email, password: SUPERADMIN.pass });
    expect(loginSuper.status).toBe(200);
    const tokenSuper = (loginSuper.body as TokenResponse).access_token;

    const sufijo = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const res = await request(app.getHttpServer())
      .post('/api/admin/tenants')
      .set('Authorization', `Bearer ${tokenSuper}`)
      .send({
        nombre: `E2E Motivos Baja ${sufijo}`,
        correo: `motivos-baja-${sufijo}@e2e.test`,
        provinciaId,
      });
    expect(res.status).toBe(201);
    return res.body as { id: string };
  }

  async function entrarA(tenantId: string): Promise<string> {
    const loginSuper = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: SUPERADMIN.email, password: SUPERADMIN.pass });
    expect(loginSuper.status).toBe(200);
    const res = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set(
        'Cookie',
        (loginSuper.headers['set-cookie'] as unknown as string[]) ?? [],
      )
      .set(
        'Authorization',
        `Bearer ${(loginSuper.body as TokenResponse).access_token}`,
      )
      .send({ tenantId });
    expect(res.status).toBe(200);
    return (res.body as TokenResponse).access_token;
  }

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
  });

  afterAll(async () => {
    // Sin limpieza del tenant creado: `redondeo-por-pais.e2e-spec.ts`, de
    // donde sale este molde, tampoco borra los que crea con `crearTenantEn`
    // (no tiene `afterAll` de datos, solo `app.close()`). Mismo criterio acá:
    // un tenant de más no rompe ninguna otra suite — nada cuenta tenants
    // totales ni itera "todos los tenants" en los tests de este repo.
    await app.close();
  });

  it('trae los siete fijos con su tipo', async () => {
    const tenant = await crearTenantEn(PROV_RM);
    const tokenTenantNuevo = await entrarA(tenant.id);

    const res = await request(app.getHttpServer())
      .get('/api/motivos-baja')
      .set('Authorization', `Bearer ${tokenTenantNuevo}`);
    expect(res.status).toBe(200);
    const motivos = res.body as {
      nombre: string;
      tipo: string;
      esFijo: boolean;
    }[];
    expect(
      motivos
        .filter((m) => m.esFijo)
        .map((m) => [m.nombre, m.tipo])
        .sort(),
    ).toEqual([
      ['Cortesía de la casa', 'cortesia'],
      ['Deterioro', 'merma'],
      ['Error operativo', 'merma'],
      ['No se llegó a hacer', 'no_elaborado'],
      ['Otro', 'merma'],
      ['Robo', 'merma'],
      ['Vencimiento', 'merma'],
    ]);
  });
});

// Task 4 (spec `2026-09-18-reporte-anulaciones-design.md` § 5.2): `GET /mermas`
// deja de listar cortesías y marca `deAnulacion` en lo que vino de anular un
// plato en mesa. Describe propio, con su propio `app`: el molde de fixtures
// (garzón, salón, mesa, ítem ruteado a cocina) es el de
// `salones-anular-linea.e2e-spec.ts` / `salones-anulaciones-reporte.e2e-spec.ts`
// — la sesión de garzón es única por garzón y varias suites la comparten, así
// que este archivo se siembra el suyo en vez de tomar uno del seed
// (`docs/agent/pendientes.md`).
describe('Mermas — deja de listar cortesías, marca deAnulacion (Task 4, e2e)', () => {
  let app: INestApplication<App>;
  let tokenAdmin: string;
  let mesaId: string;
  let garzon: { id: string; pin: string };
  let localId: string;
  let platoId: string;
  let motivoMermaId: string;
  let motivoCortesiaId: string;
  let motivoMermaNombre: string;

  async function post<T>(
    url: string,
    body: Record<string, unknown>,
    token = tokenAdmin,
    esperado = 201,
  ): Promise<T> {
    const res = await request(app.getHttpServer())
      .post(url)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    expect(res.status).toBe(esperado);
    return res.body as T;
  }

  interface CuentaLineaDetalle {
    id: string;
    itemId: string;
    cantidad: string;
    cantidadEnviada: string;
  }
  interface CuentaDetalle {
    id: string;
    lineas: CuentaLineaDetalle[];
  }

  async function abrirCuentaCon(
    lineas: { itemId: string; cantidad: string }[],
  ): Promise<CuentaDetalle> {
    const cuenta = await post<CuentaDetalle>(`/api/mesas/${mesaId}/cuentas`, {
      garzonId: garzon.id,
      pin: garzon.pin,
    });
    for (const linea of lineas) {
      await post(`/api/cuentas/${cuenta.id}/lineas`, linea);
    }
    return cuenta;
  }

  async function despachar(cuentaId: string): Promise<void> {
    await post(`/api/cuentas/${cuentaId}/comanda/reclamar`, {});
  }

  async function detalleCuenta(cuentaId: string): Promise<CuentaDetalle> {
    const res = await request(app.getHttpServer())
      .get(`/api/mesas/${mesaId}/cuentas`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    const cuenta = (res.body as CuentaDetalle[]).find((c) => c.id === cuentaId);
    expect(cuenta).toBeDefined();
    return cuenta!;
  }

  async function anular(
    cuentaId: string,
    lineaId: string,
    body: { cantidad: string; motivoBajaId: string },
  ): Promise<CuentaDetalle> {
    const res = await request(app.getHttpServer())
      .post(`/api/cuentas/${cuentaId}/lineas/${lineaId}/anular`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send(body);
    expect(res.status).toBe(201);
    return res.body as CuentaDetalle;
  }

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

    tokenAdmin = await login(app);

    const resUbic = await request(app.getHttpServer())
      .get('/api/ubicaciones')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resUbic.status).toBe(200);
    localId = (resUbic.body as UbicacionListada[]).find(
      (u) => u.tipo === 'local',
    )!.id;

    const resMotivos = await request(app.getHttpServer())
      .get('/api/motivos-baja')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(resMotivos.status).toBe(200);
    const motivos = resMotivos.body as {
      id: string;
      nombre: string;
      tipo: string;
    }[];
    const motivoMerma = motivos.find((m) => m.tipo === 'merma')!;
    motivoMermaId = motivoMerma.id;
    motivoMermaNombre = motivoMerma.nombre;
    motivoCortesiaId = motivos.find((m) => m.tipo === 'cortesia')!.id;
    expect(motivoMermaId).toBeTruthy();
    expect(motivoCortesiaId).toBeTruthy();

    const marca = Date.now();

    // Ruteo a cocina: sin impresora, `reclamarComanda` nunca avanza
    // `cantidadEnviada`, y sin eso no hay nada que anular con tope > 0.
    const cocinaId = (
      await post<{ id: string }>('/api/impresoras', {
        nombre: `Cocina mermas-anulacion E2E ${marca}`,
        rol: 'comanda',
        tipoConexion: 'sistema',
        nombreCola: `cola-mermas-anulacion-e2e-${marca}`,
      })
    ).id;
    const catCocinaId = (
      await post<{ id: string }>('/api/categorias', {
        nombre: `Cocina mermas-anulacion E2E ${marca}`,
        impresoraId: cocinaId,
      })
    ).id;

    platoId = (
      await post<ItemResponse>('/api/items', {
        nombre: `Plato mermas-anulacion E2E ${marca}`,
        tipo: 'producto',
        precioBase: '5000',
        monedaId: CLP_MONEDA_ID,
        unidadMedida: 'unidad',
        stock: '1000',
        costo: '1000',
        categoriaId: catCocinaId,
      })
    ).id;

    garzon = await post<{ id: string; pin: string }>('/api/garzones', {
      nombre: `Garzón mermas-anulacion E2E ${marca}`,
    });
    await post('/api/sesiones-garzon/iniciar', {
      garzonId: garzon.id,
      pin: garzon.pin,
      turnoId: '550e8400-e29b-41d4-a716-446655440277', // turno mañana, fijo del seed
    });

    const salonId = (
      await post<{ id: string }>('/api/salones', {
        nombre: `Salón mermas-anulacion E2E ${marca}`,
      })
    ).id;
    mesaId = (
      await post<{ id: string }>(`/api/salones/${salonId}/mesas`, {
        nombre: 'Mesa mermas-anulacion',
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    const fallos: string[] = [];
    try {
      const cerrar = await request(app.getHttpServer())
        .post('/api/sesiones-garzon/cerrar')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ garzonId: garzon.id, pin: garzon.pin });
      if (![200, 201].includes(cerrar.status)) {
        fallos.push(`cerrar sesión del garzón → ${cerrar.status}`);
      }
    } finally {
      await app.close();
    }
    expect(fallos).toEqual([]);
  });

  it('la cortesía no aparece, la merma en mesa sí con deAnulacion:true, la de bodega con deAnulacion:false, y meta.total coincide con las filas', async () => {
    const cuenta = await abrirCuentaCon([{ itemId: platoId, cantidad: '2' }]);
    await despachar(cuenta.id);
    const lineaInicial = (await detalleCuenta(cuenta.id)).lineas.find(
      (l) => l.itemId === platoId,
    )!;

    // Cortesía: 1 de las 2 unidades despachadas.
    await anular(cuenta.id, lineaInicial.id, {
      cantidad: '1',
      motivoBajaId: motivoCortesiaId,
    });
    const lineaTrasCortesia = (await detalleCuenta(cuenta.id)).lineas.find(
      (l) => l.itemId === platoId,
    )!;
    // Merma de mesa: la unidad restante.
    await anular(cuenta.id, lineaTrasCortesia.id, {
      cantidad: '1',
      motivoBajaId: motivoMermaId,
    });

    // Merma de bodega, sobre el mismo ítem — para que el filtro por itemId de
    // más abajo mida las DOS formas de merma en un solo conteo.
    const resMermaBodega = await request(app.getHttpServer())
      .post('/api/mermas')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        itemId: platoId,
        ubicacionId: localId,
        cantidad: '1',
        motivoBajaId: motivoMermaId,
      });
    expect(resMermaBodega.status).toBe(201);
    const movimientoBodegaId = (resMermaBodega.body as MermaResponse)
      .movimientoId;

    // Acotado con `itemId` propio del spec: la base es compartida y otras
    // suites (incluido `salones-anulaciones-reporte.e2e-spec.ts`) dejan
    // mermas de mesa en el mismo tenant — un assert de conteo sin este filtro
    // pasa aislado y falla en la corrida completa.
    const res = await request(app.getHttpServer())
      .get(`/api/mermas?itemId=${platoId}`)
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    const lista = res.body as PaginatedMermas;

    // meta.total coincide con las filas: exactamente 2 (merma de mesa + merma
    // de bodega), la cortesía no cuenta.
    expect(lista.meta.total).toBe(2);
    expect(lista.data).toHaveLength(2);

    // La cortesía no aparece en absoluto: ninguna fila trae su motivo.
    expect(lista.data.every((m) => m.motivoBajaId !== motivoCortesiaId)).toBe(
      true,
    );

    const filaBodega = lista.data.find((m) => m.id === movimientoBodegaId);
    expect(filaBodega).toBeDefined();
    expect(filaBodega?.deAnulacion).toBe(false);

    const filaMesa = lista.data.find((m) => m.id !== movimientoBodegaId);
    expect(filaMesa).toBeDefined();
    expect(filaMesa?.deAnulacion).toBe(true);
    expect(filaMesa?.motivoBajaId).toBe(motivoMermaId);
    expect(filaMesa?.motivoBajaNombre).toBe(motivoMermaNombre);
  });
});
