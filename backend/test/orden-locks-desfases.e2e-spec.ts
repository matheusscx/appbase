import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import type { App } from 'supertest/types';
import type { Server, AddressInfo } from 'net';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';

// Seed (IDs fijos, ver seeder.service.ts)
const CLP_MONEDA_ID = '550e8400-e29b-41d4-a716-446655440003';
const PARIS_TENANT_ID = '550e8400-e29b-41d4-a716-446655440007';
const ADMIN_EMAIL = 'admin.paris@paris.cl';
const ADMIN_PASS = 'admin';

interface TokenResponse {
  access_token: string;
}
interface ItemResponse {
  id: string;
}
interface DesfaseItemResponse {
  itemId: string;
  tipo: 'receta' | 'combo';
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUÉ PRUEBA ESTE SPEC Y QUÉ NO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PRUEBA: que dos transacciones REALES del service (`descartarDesfases`, vía
 * `POST /api/desfases/descartar` por HTTP) sobre las MISMAS dos filas —una de
 * `item_receta` y una de `item_combo`— no se abrazan cuando el cliente manda el
 * lote en órdenes opuestos. Hoy `descartarDesfases` recorre `itemIds` en el
 * orden que manda el cliente y sus `UPDATE` toman el lock de fila en ese mismo
 * orden, así que `[combo, receta]` contra `[receta, combo]` cierra el ciclo
 * A→B / B→A y Postgres mata a una con `40P01` (500). `aplicarDesfases` ya está
 * blindado con `SELECT … ORDER BY item_id FOR UPDATE`, primero `item_receta` y
 * después `item_combo`; `descartarDesfases` no.
 *
 * CÓMO: no hace falta un desfase pendiente para que el lock se tome —el service
 * escribe `costo_propuesto_omitido` incondicionalmente— pero el `beforeAll` monta
 * el escenario completo y AFIRMA que los dos aparecen en la bandeja, para que el
 * caso sea el real y no uno degenerado.
 *
 * El interleaving es DETERMINISTA, no una ráfaga probabilística. Una compuerta
 * (un `QueryRunner` propio, fuera de Nest, con `SELECT … FOR UPDATE` sobre la
 * fila del combo) retiene el combo mientras entran las dos requests, y recién
 * después la suelta:
 *
 *   compuerta: FOR UPDATE combo                 → retiene C
 *   request A: descartar([combo, receta])       → encola en C (no tiene nada)
 *   request B: descartar([receta, combo])       → toma R, encola en C detrás de A
 *   compuerta: ROLLBACK                         → suelta C
 *   → la cola FIFO le da C a A; A pide R (de B) y B espera C (de A) = ciclo.
 *
 * O sea: la compuerta solo ORDENA la entrada. Las dos puntas del abrazo son el
 * service de verdad, ninguna es una réplica a mano de su SQL. Medido: 10 de 10
 * corridas, exactamente 1 deadlock y exactamente 1 víctima.
 *
 * NO PRUEBA:
 * - No prueba nada sobre los otros tres caminos que escriben estas tablas
 *   (`aplicarDesfases`, alta/edición de ítems compuestos). Cubre uno solo.
 * - No prueba que el orden canónico elegido sea uno en particular. Los dos
 *   CONTROL de abajo miden que con CUALQUIER orden común —los dos lotes
 *   `[receta, combo]`, o los dos `[combo, receta]`— la misma compuerta da 201/201
 *   y cero deadlocks. Es la evidencia de que lo único que produce el 500 es el
 *   desacuerdo de orden, y de que ordenar canónicamente en cualquiera de las dos
 *   direcciones lo apaga. Si alguna vez los CONTROL se ponen rojos, el `it`
 *   principal deja de significar lo que dice acá.
 * - `deadlocksNuevos` sale de `pg_stat_database`, que es de toda la base: cuenta
 *   deadlocks de cualquier sesión. Vale porque el e2e corre solo. Se afirma
 *   además del status para que un "arreglo" que reintente el `40P01` y devuelva
 *   201 no pase por bueno: la tarea es no cerrar el ciclo, no absorberlo.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('Orden de bloqueo de filas en ítems compuestos (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let port: number;
  let recetaId: string;
  let comboId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    // `switch-tenant` lee `req.cookies`, y `cookieParser` vive en `main.ts`, que
    // el e2e no ejecuta. Sin esto corta con 401.
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    ds = app.get(DataSource);

    // Login en DOS pasos: el token de `/auth/login` de un usuario multi-tenant
    // sale con `tenant_id: null` y PermisosGuard lo rechaza con 403.
    const resLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASS });
    expect(resLogin.status).toBe(200);
    const resTenant = await request(app.getHttpServer())
      .post('/api/auth/switch-tenant')
      .set(
        'Cookie',
        (resLogin.headers['set-cookie'] as unknown as string[]) ?? [],
      )
      .set(
        'Authorization',
        `Bearer ${(resLogin.body as TokenResponse).access_token}`,
      )
      .send({ tenantId: PARIS_TENANT_ID });
    expect(resTenant.status).toBe(200);
    token = (resTenant.body as TokenResponse).access_token;

    // Escenario propio del spec (nada del seed): un ingrediente que mueve a la
    // receta y un producto que mueve al combo, para que los dos desfases sean
    // independientes entre sí.
    const sello = Date.now();

    const resIng = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Locks Ingrediente ${sello}`,
        precioBase: '500',
        monedaId: CLP_MONEDA_ID,
        tipo: 'ingrediente',
        unidadMedida: 'unidad',
        stock: '20',
        costo: '500',
      });
    expect(resIng.status).toBe(201);
    const ingId = (resIng.body as ItemResponse).id;

    const resRec = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Locks Receta ${sello}`,
        precioBase: '2000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'receta',
        ingredientes: [
          {
            ingredienteItemId: ingId,
            cantidad: '1',
            unidadCodigo: 'unidad',
            bloqueante: true,
          },
        ],
      });
    expect(resRec.status).toBe(201);
    recetaId = (resRec.body as ItemResponse).id;

    const resProd = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Locks Producto ${sello}`,
        precioBase: '900',
        monedaId: CLP_MONEDA_ID,
        tipo: 'producto',
        unidadMedida: 'unidad',
        stock: '20',
        costo: '300',
      });
    expect(resProd.status).toBe(201);
    const prodId = (resProd.body as ItemResponse).id;

    const resCombo = await request(app.getHttpServer())
      .post('/api/items')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: `Locks Combo ${sello}`,
        precioBase: '3000',
        monedaId: CLP_MONEDA_ID,
        tipo: 'combo',
        componentes: [
          { componenteItemId: prodId, cantidad: '1', bloqueante: true },
        ],
      });
    expect(resCombo.status).toBe(201);
    comboId = (resCombo.body as ItemResponse).id;

    // Mover el costo de los dos insumos = desfase pendiente en la receta y en
    // el combo.
    await request(app.getHttpServer())
      .post('/api/inventario/ajustes-costo')
      .set('Authorization', `Bearer ${token}`)
      .send({ itemId: ingId, costoNuevo: '700', comentario: 'Orden locks E2E' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/inventario/ajustes-costo')
      .set('Authorization', `Bearer ${token}`)
      .send({
        itemId: prodId,
        costoNuevo: '400',
        comentario: 'Orden locks E2E',
      })
      .expect(201);

    // Sin esta afirmación el spec podría estar reproduciendo un caso degenerado
    // (sin desfase el service escribe igual, pero no sería el caso real).
    const bandeja = await request(app.getHttpServer())
      .get('/api/desfases')
      .set('Authorization', `Bearer ${token}`);
    expect(bandeja.status).toBe(200);
    const filas = bandeja.body as DesfaseItemResponse[];
    expect(
      filas.some((f) => f.itemId === recetaId && f.tipo === 'receta'),
    ).toBe(true);
    expect(filas.some((f) => f.itemId === comboId && f.tipo === 'combo')).toBe(
      true,
    );

    // Por HTTP real contra un puerto bindeado: supertest levanta un listener
    // efímero por request y varias simultáneas lo tumban con ECONNRESET —
    // fallaría siempre, por la razón equivocada (ver concurrencia-pool:82).
    const server = app.getHttpServer() as Server;
    if (!server.listening) {
      await new Promise<void>((resolve) => server.listen(0, resolve));
    }
    port = (server.address() as AddressInfo).port;
  }, 120000);

  afterAll(async () => {
    // Acumular fallos de limpieza y afirmar DESPUÉS de app.close(): un expect
    // que tira antes de cerrar deja el pool abierto y jest no termina nunca
    // (patrón de concurrencia-pool.e2e-spec.ts:93).
    // La receta y el combo se borran porque quedan en la bandeja de desfases y
    // envenenarían a cualquier suite posterior que la liste.
    const fallos: string[] = [];
    try {
      for (const [etiqueta, id] of [
        ['combo', comboId],
        ['receta', recetaId],
      ] as const) {
        if (!id) continue;
        const res = await request(app.getHttpServer())
          .delete(`/api/items/${id}`)
          .set('Authorization', `Bearer ${token}`);
        if (res.status !== 200)
          fallos.push(`DELETE ${etiqueta}: ${res.status}`);
      }
    } finally {
      await app.close();
    }
    expect(fallos).toEqual([]);
  });

  const descartar = (itemIds: string[]) =>
    fetch(`http://127.0.0.1:${port}/api/desfases/descartar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ itemIds }),
    });

  const deadlocks = async (): Promise<number> => {
    const filas: { deadlocks: string }[] = await ds.query(
      `SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`,
    );
    return Number(filas[0].deadlocks);
  };

  /**
   * Corre el protocolo de la compuerta: retiene la fila del combo, deja entrar
   * `lotePrimero` y después `loteSegundo`, y recién ahí suelta.
   */
  const conCompuerta = async (lotePrimero: string[], loteSegundo: string[]) => {
    const antes = await deadlocks();
    const compuerta = ds.createQueryRunner();
    await compuerta.connect();
    await compuerta.startTransaction();
    await compuerta.query(
      `SELECT item_id FROM item_combo WHERE item_id = $1 FOR UPDATE`,
      [comboId],
    );

    const primera = descartar(lotePrimero);
    // 600 ms: sobra para que la request llegue al primer UPDATE y se encole.
    // Es el único punto sensible al tiempo, y solo puede fallar de más (si no
    // llegó a encolarse no hay ciclo y el test daría verde de mentira) — por
    // eso el CONTROL de abajo, que fija el piso de lo que significa el verde.
    await dormir(600);
    const segunda = descartar(loteSegundo);
    await dormir(600);

    await compuerta.rollbackTransaction();
    await compuerta.release();

    const [rPrimera, rSegunda] = await Promise.all([primera, segunda]);
    return {
      statuses: [rPrimera.status, rSegunda.status],
      deadlocksNuevos: (await deadlocks()) - antes,
    };
  };

  it('dos descartes del mismo par receta/combo en ORDEN OPUESTO no se abrazan', async () => {
    const medido = await conCompuerta([comboId, recetaId], [recetaId, comboId]);
    expect(medido).toEqual({ statuses: [201, 201], deadlocksNuevos: 0 });
  }, 60000);

  it.each([
    ['receta primero', () => [recetaId, comboId]],
    ['combo primero', () => [comboId, recetaId]],
  ])(
    'CONTROL: con los dos lotes en el MISMO orden (%s) la compuerta no produce deadlock',
    async (_etiqueta, lote) => {
      const medido = await conCompuerta(lote(), lote());
      expect(medido).toEqual({ statuses: [201, 201], deadlocksNuevos: 0 });
    },
    60000,
  );
});
