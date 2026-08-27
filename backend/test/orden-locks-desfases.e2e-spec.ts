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
  /** Lo que la bandeja propone hoy. El descarte tiene que mandarlo de vuelta. */
  costoPropuesto: string;
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
 * `esperandoLockEnLaCompuerta` NO es decorativo: es lo único que separa este
 * verde del verde de un test mudo. `{statuses:[201,201], deadlocksNuevos:0}` es
 * TAMBIÉN la salida exacta de una compuerta que no enganchó — si el `FOR UPDATE`
 * no retuvo nada, o si los 600 ms no alcanzaron y las requests pasaron de largo,
 * el spec daría verde sin haber ejercitado nada. Es el modo de falla que
 * `concurrencia-pool.e2e-spec.ts:15-18` ya documenta en un test hermano que
 * "pasaba sin ejercitar nada". Contar los esperadores
 * (`pg_stat_activity.wait_event_type = 'Lock'`) justo ANTES de soltar la
 * compuerta afirma que las dos requests estaban de verdad encoladas. Medido: 2,
 * en los cuatro casos.
 *
 * QUÉ FIJA CADA `it`:
 * - El `it` principal fija que dos `descartar` en órdenes opuestos no se abrazan.
 *   Por sí solo NO fija la DIRECCIÓN del orden canónico: un `descartarDesfases`
 *   que bloqueara `item_combo` ANTES que `item_receta` lo pondría en verde igual,
 *   y sería una regresión. El proyecto ya declaró la dirección
 *   `item_receta → item_combo` y `ItemsService.aplicarDesfases` la implementa en
 *   sus dos `SELECT … ORDER BY item_id FOR UPDATE`; un `descartar` invertido
 *   cerraría un ciclo NUEVO, `aplicar` ↔ `descartar`, sobre el mismo par.
 * - Por eso el `it` CRUZADO —`descartar([combo, receta])` contra
 *   `aplicar([receta, combo])`— es el que sí fija la dirección: `aplicarDesfases`
 *   toma R→C pase lo que pase (su `FOR UPDATE` no depende del orden del cliente),
 *   así que solo un `descartar` que también tome R→C lo apaga. Con el orden
 *   canónico invertido este `it` seguiría rojo.
 * - Los dos CONTROL (los dos lotes en el MISMO orden) son el piso: miden que la
 *   compuerta, sin desacuerdo de orden, no produce nada. NO son equivalentes
 *   entre sí. En `receta primero` cada request sostiene una fila distinta
 *   mientras espera — es el que se parece al caso real y aun así no cierra el
 *   ciclo, y es el que aporta. En `combo primero` las dos hacen cola en C sin
 *   sostener nada: es el escenario trivial, y está solo para cerrar la simetría.
 *
 * NO PRUEBA:
 * - No prueba nada sobre los otros dos caminos que escriben estas tablas (alta y
 *   edición de ítems compuestos). Cubre `descartar` y su cruce con `aplicar`.
 * - `deadlocksNuevos` sale de `pg_stat_database`, que cuenta los deadlocks de
 *   TODA la base, de cualquier sesión: `maxWorkers: 1` serializa los workers de
 *   jest, no las sesiones de Postgres, y el contenedor `tecnica_backend` está
 *   levantado contra el mismo `DATABASE_URL`. El argumento no es "el e2e corre
 *   solo" —no lo hace—: es que ningún otro spec provoca `40P01` y que el contador
 *   SOLO SUBE, así que una sesión ajena contamina hacia el rojo falso, nunca
 *   hacia el verde falso. Se afirma además del status para que un "arreglo" que
 *   reintente el `40P01` y devuelva 201 no pase por bueno: la tarea es no cerrar
 *   el ciclo, no absorberlo.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('Orden de bloqueo de filas en ítems compuestos (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let token: string;
  let port: number;
  let recetaId: string;
  let comboId: string;
  /**
   * El propuesto de cada fila, leído UNA vez del `GET /desfases` del setup.
   *
   * ⚠️ Desde el 2026-08-25 el descarte solo escribe si el `costoPropuestoVisto`
   * coincide con el recalculado. Mandar un número inventado haría que el service
   * **no tome ningún lock** y este spec quedaría midiendo una compuerta vacía —
   * lo caza `esperandoLockEnLaCompuerta`, que exigiría 2 y vería 0, pero conviene
   * que la razón esté escrita y no se descubra por un rojo raro.
   *
   * Se lee una sola vez, y vale acá por una razón ACOTADA a esta fixture: el
   * combo de este spec cuelga de un **producto**, no de la receta, así que
   * `aplicarDesfases` —que mueve `costo_actual`— no le mueve el propuesto a
   * nadie del lote.
   *
   * ⚠️ **No es una propiedad general**: para un combo cuyo componente es una
   * receta, el costo del insumo ES `item_receta.costo_actual`
   * (`componentesPorCombo`: `COALESCE(ip.costo_actual, ir.costo_actual)`), y por
   * eso `aplicarDesfases` devuelve `afectados` — aplicar una receta SÍ mueve el
   * propuesto de sus combos. Quien cambie la fixture para colgar el combo de la
   * receta tiene que releer los propuestos entre `it` y `it`.
   */
  const propuestoPorId = new Map<string, string>();

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
    for (const f of filas) propuestoPorId.set(f.itemId, f.costoPropuesto);

    // Por HTTP real contra un puerto bindeado (ver concurrencia-pool).
    // ⚠️ Misma premisa muerta que allá: el listener efímero por request de
    // supertest dejó de existir el 2026-08-27, y que la ráfaga anduviera hoy por
    // supertest no se midió. Se corrige la razón, no la conducta.
    const server = app.getHttpServer() as Server;
    if (!server.listening) {
      // El host va explícito por la misma razón que en `setup-supertest.ts`:
      // `listen(0)` bindea el wildcard y acá abajo se le habla a 127.0.0.1, y ese
      // desencuentro es el `401` fantasma. Hoy este bloque no corre —`init()` ya
      // dejó el server escuchando— pero si algún día vuelve a correr, que no reabra
      // el agujero.
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
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

  const postear = (ruta: string, cuerpo: unknown) =>
    fetch(`http://127.0.0.1:${port}${ruta}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(cuerpo),
    });

  const descartar = (itemIds: string[]) => () =>
    postear('/api/desfases/descartar', {
      items: itemIds.map((itemId) => ({
        itemId,
        costoPropuestoVisto: propuestoPorId.get(itemId)!,
      })),
    });

  /**
   * `aplicarDesfases` NO respeta el orden del cliente: su `FOR UPDATE` es
   * `item_receta` y después `item_combo`, siempre. El arreglo lo recibe igual
   * para que el `it` cruzado se lea como el caso de uso real (dos usuarios
   * mandando el mismo par), no como un detalle de implementación.
   */
  const aplicar = (itemIds: string[]) => () =>
    postear('/api/desfases/aplicar', {
      items: itemIds.map((itemId) => ({ itemId })),
    });

  const deadlocks = async (): Promise<number> => {
    const filas: { deadlocks: string }[] = await ds.query(
      `SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`,
    );
    return Number(filas[0].deadlocks);
  };

  /** Sesiones frenadas en un lock ahora mismo. Ver el header: es lo que separa
   * el verde real del verde de una compuerta que no enganchó. */
  const esperandoLock = async (): Promise<number> => {
    const filas: { count: string }[] = await ds.query(
      `SELECT count(*) FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    return Number(filas[0].count);
  };

  /**
   * Corre el protocolo de la compuerta: retiene la fila del combo, deja entrar
   * `primerLote` y después `segundoLote`, cuenta los esperadores y recién ahí
   * suelta.
   */
  const conCompuerta = async (
    primerLote: () => Promise<Response>,
    segundoLote: () => Promise<Response>,
  ) => {
    const antes = await deadlocks();
    const compuerta = ds.createQueryRunner();
    let esperandoLockEnLaCompuerta = -1;
    let statuses: number[] = [];
    try {
      await compuerta.connect();
      await compuerta.startTransaction();
      await compuerta.query(
        `SELECT item_id FROM item_combo WHERE item_id = $1 FOR UPDATE`,
        [comboId],
      );

      const primera = primerLote();
      // 600 ms: sobra para que la request llegue a su primer lock y se encole.
      // Es el único punto sensible al tiempo, y solo puede fallar de más (si no
      // llegó a encolarse no hay ciclo y el test daría verde de mentira) — por
      // eso se cuentan los esperadores antes de soltar.
      await dormir(600);
      const segunda = segundoLote();
      await dormir(600);

      esperandoLockEnLaCompuerta = await esperandoLock();
      await compuerta.rollbackTransaction();

      const [rPrimera, rSegunda] = await Promise.all([primera, segunda]);
      statuses = [rPrimera.status, rSegunda.status];
    } finally {
      // Sin esto, un throw arriba (el `FOR UPDATE`, un `fetch`) se lleva el
      // `release()` puesto y deja la conexión colgada: una falla ruidosa se
      // convertiría en el cuelgue que documenta el `afterAll`.
      if (compuerta.isTransactionActive) await compuerta.rollbackTransaction();
      await compuerta.release();
    }
    return {
      esperandoLockEnLaCompuerta,
      statuses,
      deadlocksNuevos: (await deadlocks()) - antes,
    };
  };

  const SIN_ABRAZO = {
    esperandoLockEnLaCompuerta: 2,
    statuses: [201, 201],
    deadlocksNuevos: 0,
  };

  it('dos descartes del mismo par receta/combo en ORDEN OPUESTO no se abrazan', async () => {
    const medido = await conCompuerta(
      descartar([comboId, recetaId]),
      descartar([recetaId, comboId]),
    );
    expect(medido).toEqual(SIN_ABRAZO);
  }, 60000);

  /**
   * El que fija la DIRECCIÓN del orden canónico, no solo que haya uno.
   * `aplicarDesfases` toma `item_receta` y después `item_combo` pase lo que pase,
   * así que entra segundo sosteniendo R y encolado en C; el `descartar` que entró
   * primero se lleva C y va por R. Solo un `descartarDesfases` que también tome
   * R→C lo apaga: con la dirección invertida este `it` seguiría rojo.
   */
  it('descartar([combo, receta]) contra aplicar del mismo par no se abrazan', async () => {
    const medido = await conCompuerta(
      descartar([comboId, recetaId]),
      aplicar([recetaId, comboId]),
    );
    expect(medido).toEqual(SIN_ABRAZO);
  }, 60000);

  // El piso. Ojo: los dos NO son equivalentes (ver el header). El que aporta es
  // `receta primero`, donde cada request sostiene una fila distinta mientras
  // espera y aun así no se cierra el ciclo; en `combo primero` las dos hacen cola
  // en C sin sostener nada, que es el caso trivial.
  //
  // El orden del lote se DERIVA de la etiqueta, no se escribe al lado: escritos
  // por separado se desincronizaron (una tabla de índices `[1,0]`/`[0,1]` sobre
  // el par dejó cada etiqueta corriendo el caso contrario), y como los dos casos
  // afirman lo mismo el pass/fail no lo delataba. Con una sola fuente de verdad
  // el error deja de ser posible: para que el lote cambie hay que cambiar el
  // nombre del caso.
  it.each([
    'receta primero (cada una sostiene una fila distinta)',
    'combo primero (las dos encolan en C, sin sostener nada)',
  ])(
    'CONTROL: con los dos lotes en el MISMO orden — %s — la compuerta no produce deadlock',
    async (etiqueta) => {
      const lote = etiqueta.startsWith('receta')
        ? [recetaId, comboId]
        : [comboId, recetaId];
      const medido = await conCompuerta(descartar(lote), descartar(lote));
      expect(medido).toEqual(SIN_ABRAZO);
    },
    60000,
  );
});
