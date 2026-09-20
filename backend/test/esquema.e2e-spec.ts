import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { SeederService } from '../src/modules/seeder/seeder.service';
import { serieNormalizadaSql } from '../src/modules/items/entities/item-unidad.entity';

/**
 * Invariantes del ESQUEMA, medidas contra la base real.
 *
 * Qué agrega sobre `src/common/invariants/timestamptz-columns.invariant.spec.ts`,
 * que mira la metadata de TypeORM: **alcance**. Aquel enumera las columnas que
 * reconoce como de auditoría —por modo de decorador o por nombre— y no puede
 * hacer otra cosa: una columna de fecha con otro nombre y un `@Column` común le
 * es invisible. Este mira TODAS las columnas del esquema.
 *
 * No es teórico: `refresh_tokens.expires_at` es exactamente esa columna. Quedó
 * sin zona, ninguna red la miraba, y decide si un token sigue vivo. La encontró
 * una persona leyendo la tabla de al lado.
 *
 * (Al revés, el unit corre en `npm test` sin base y caza la regresión barata
 * —alguien agrega una entity sin `type`— sin esperar al e2e. Por eso los dos.)
 *
 * Lo que NO agrega, para que nadie lo repita: no cubre tablas ajenas a las
 * entities. `startup-pos.sql` es documentación de referencia y **no lo ejecuta
 * nadie** —ni el compose ni `reset-db.sh`, que reconstruyen vía `synchronize` +
 * seeder—, así que su única tabla sin entity (`sub_tenants`) no existe en la
 * base. Medido: 87 columnas `eliminado_el` en la BD, las mismas 87 que declaran
 * las entities.
 */
describe('Esquema (e2e) — invariantes medidas contra Postgres', () => {
  let app: INestApplication<App>;
  let ds: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
    ds = app.get(DataSource);
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  /**
   * NINGUNA columna de timestamp del esquema va sin zona horaria.
   *
   * El bug que cierra: comparar una columna con zona contra una sin zona deja
   * que Postgres castee la segunda usando el `TimeZone` de la sesión que
   * compara, no el que estaba activo al escribir. Medido con `SET TimeZone` en
   * sesiones separadas: matchea 1 de 3 combinaciones.
   *
   * Va sobre el esquema ENTERO y no sólo sobre `creado_el`/`actualizado_el`/
   * `eliminado_el`, que fue por donde entró el problema (partidas 65/22, 66/22 y
   * 64/22 por el default de TypeORM). La razón: el riesgo no es de esas tres
   * columnas, es de **mezclar tipos en una comparación**, y eso lo puede
   * producir cualquier par. `refresh_tokens.expires_at` lo probó — quedó sin
   * zona y ninguna red la miraba, porque no es una columna de auditoría.
   * Después de la migración el esquema tiene CERO columnas sin zona (medido
   * 2026-08-06), así que la regla fuerte sale gratis y es la que corresponde.
   *
   * Si alguna vez hay una columna que legítimamente deba ir sin zona —una fecha
   * de negocio sin instante, tipo un horario de local— va con su justificación
   * en una allowlist acá, como `NON_UUID_ID_ALLOWLIST` en el invariante de
   * ADR-004. Hoy no hay ninguna, así que no se escribe la allowlist vacía.
   */
  it('ninguna columna del esquema quedó sin zona horaria', async () => {
    const sinZona: { table_name: string; column_name: string }[] =
      await ds.query(
        `SELECT table_name, column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND data_type = 'timestamp without time zone'
          ORDER BY table_name, column_name`,
      );

    expect(sinZona.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([]);
  });

  /**
   * Ancla positiva. Sin esto, un `column_name` mal escrito —o un esquema que no
   * se creó— daría cero filas y el test de arriba pasaría sin haber mirado
   * nada. El piso va bajo a propósito: lo que se fija es que HAY esquema, no
   * cuántas tablas tiene hoy, que cambia con cada feature.
   */
  it('el chequeo está mirando un esquema real, no una base vacía', async () => {
    const [{ total }]: { total: number }[] = await ds.query(
      `SELECT COUNT(*)::int AS total
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name IN ('creado_el', 'actualizado_el', 'eliminado_el')`,
    );

    expect(total).toBeGreaterThan(200);
  });

  /**
   * La unicidad de `serie` existe **en la base**, y con la normalización que
   * manda la regla.
   *
   * El bug que cerró la primera versión de este test (2026-09-19):
   * `startup-pos.sql` declaraba el índice pero el esquema lo crea `synchronize`
   * desde las entities, y `ItemUnidad` no declaraba ninguno — `item_unidad` tenía
   * solo su PK y dos unidades vivas podían compartir serie **en silencio**.
   *
   * El segundo bug, que cierra esta versión (owner, 2026-09-20): con el índice
   * sobre la **columna pelada**, `ABC123` y `abc123 ` eran dos series distintas y
   * entraban las dos. La regla es que son la misma, así que el índice va sobre
   * `lower(btrim(serie))`. Y como **TypeORM no sabe expresar una función en
   * `@Index`**, declararlo en la entity volvía a crear el de la columna pelada:
   * por eso hoy lo crea `SeederService.seedItemUnidadSerieIndex()`.
   *
   * Por eso el test mira `pg_indexes` y no el `.sql` ni la entity: la pregunta es
   * qué índice **hay**, no cuál está escrito ni quién lo declara. Afirma sobre la
   * expresión y el `WHERE`, no sobre el nombre, porque el nombre no cambió entre
   * las dos reglas: un índice con el nombre correcto y la definición vieja es
   * exactamente el caso que se escapó.
   */
  it('item_unidad tiene el índice único de serie normalizada por producto vivo', async () => {
    const indices: { indexname: string; indexdef: string }[] = await ds.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'item_unidad' AND indexdef ILIKE '%UNIQUE%'
          AND indexdef ILIKE '%serie%'`,
    );

    // Uno, no dos: si además quedara el de la columna pelada, la regla estaría
    // enforzada dos veces y la de más estricta no sería la normalizada.
    expect(indices).toHaveLength(1);
    // `item_id` + la serie normalizada, en ese orden. El match NO fija la lista
    // de blancos carácter por carácter —Postgres la renderiza con los caracteres
    // de verdad, tabs y newlines incluidos, así que un regex literal sería
    // ilegible y frágil—: fija que estén las dos funciones y que `btrim` reciba
    // su lista. Que la lista sea la correcta lo mide el test de conducta de acá
    // abajo, que es lo que importa.
    expect(indices[0].indexdef).toMatch(/\(item_id, lower\(btrim\(serie, '/);
    // Y el NBSP está en la lista: es el blanco que no se puede confundir con
    // otro y el que delata una lista incompleta (la primera versión de este
    // índice llamaba a `btrim` sin lista, que recorta solo el espacio ASCII).
    expect(indices[0].indexdef).toContain('\u00a0');
    // Parcial: sin el WHERE, una unidad borrada dejaría su serie tomada para
    // siempre.
    expect(indices[0].indexdef).toMatch(/WHERE \(eliminado_el IS NULL\)/);
  });

  /**
   * Y la normalización del índice es la MISMA que usa el guard del chokepoint.
   *
   * No es redundante con el test de arriba: ese mira la forma del índice, este
   * mide la **conducta** contra Postgres, que es lo que decide si un duplicado
   * entra. Se hace con SQL porque lo que se afirma es del motor —cómo compara
   * `lower(btrim(...))`—, no de la API: los caminos de la app los cubre
   * `serie-unica-por-producto.e2e-spec.ts`.
   */
  it('la normalización iguala mayúsculas y TODOS los blancos de borde, y no toca el de adentro', async () => {
    // Se arma con `serieNormalizadaSql`, el mismo helper que usa el índice y el
    // guard: así este test mide la expresión que está vigente, no una copia.
    const norm = (v: string) => `${serieNormalizadaSql(`'${v}'`)}`;
    const [fila]: {
      mayus: boolean;
      espacio: boolean;
      tab: boolean;
      nl: boolean;
      nbsp: boolean;
      adentro: boolean;
    }[] = await ds.query(
      `SELECT ${norm('ABC123')} = ${norm('abc123')} AS mayus,
              ${norm('ABC123')} = ${norm(' ABC123 ')} AS espacio,
              ${norm('ABC123')} = ${norm('\tABC123\t')} AS tab,
              ${norm('ABC123')} = ${norm('\nABC123')} AS nl,
              ${norm('ABC123')} = ${norm('\u00a0ABC123')} AS nbsp,
              ${norm('ABC123')} = ${norm('ABC 123')} AS adentro`,
    );
    expect(fila.mayus).toBe(true);
    expect(fila.espacio).toBe(true);
    // Los tres que la primera versión dejaba pasar: `btrim` sin lista recorta
    // solo el espacio ASCII, así que estos tres daban `false` y el duplicado
    // entraba. Lo levantó la revisión de seguridad.
    expect(fila.tab).toBe(true);
    expect(fila.nl).toBe(true);
    expect(fila.nbsp).toBe(true);
    // Y el blanco de ADENTRO sigue distinguiendo: si esto fuera true, la
    // normalización estaría borrando más de lo que la regla dice.
    expect(fila.adentro).toBe(false);
  });

  /**
   * Y una base creada **con el índice viejo** queda arreglada al arrancar.
   *
   * Es el único test que cubre la migración, y hacía falta: entre el 2026-09-19 y
   * el 2026-09-20 las bases de dev —y la de Railway— quedaron con
   * `uq_unidad_item_serie` sobre la **columna pelada**, o sea el mismo nombre con
   * la definición vieja. Un `CREATE UNIQUE INDEX IF NOT EXISTS` no lo reemplaza:
   * ve el nombre, no hace nada, y la base se queda con la regla anterior sin que
   * nada avise. Por eso el seeder lo precede de un `DROP` condicional.
   *
   * ⚠️ El escenario se monta con SQL directa **a propósito**, y es la excepción
   * que se explica sola: el estado "índice viejo" ya no lo puede producir ningún
   * camino de la app —la entity dejó de declararlo—, así que es un estado
   * HISTÓRICO, no uno inalcanzable por un hueco de cobertura. Lo que se ejercita
   * después sí es el camino real: `onApplicationBootstrap()`, el mismo que corre
   * al arrancar.
   */
  it.each([
    ['columna pelada (2026-09-19)', '(item_id, serie)'],
    [
      'lower(btrim(serie)) sin lista de blancos',
      '(item_id, lower(btrim(serie)))',
    ],
  ])(
    'al arrancar, reemplaza el índice viejo —%s— por el normalizado',
    async (_nombre, definicionVieja) => {
      await ds.query('DROP INDEX IF EXISTS uq_unidad_item_serie');
      await ds.query(`
        CREATE UNIQUE INDEX uq_unidad_item_serie
        ON item_unidad ${definicionVieja} WHERE eliminado_el IS NULL
      `);
      const [viejo]: { indexdef: string }[] = await ds.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_unidad_item_serie'`,
      );
      // El escenario quedó montado: sin esto, el test podría pasar por no haber
      // cambiado nada. El NBSP es la marca del índice nuevo, así que su AUSENCIA
      // es la marca de los viejos.
      expect(viejo.indexdef).not.toContain('\u00a0');

      await app.get(SeederService).onApplicationBootstrap();

      const [ahora]: { indexdef: string }[] = await ds.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_unidad_item_serie'`,
      );
      expect(ahora.indexdef).toContain('\u00a0');
    },
    120000,
  );

  /**
   * Toda columna de dinero es NUMERIC(18,4). Una moneda con más decimales
   * devolvería el recorte final al cast de Postgres —su regla, fuera de
   * modo_redondeo—, que es justo lo que el frente de redondeo vino a cerrar.
   */
  it('ninguna moneda puede tener más decimales de los que la columna de dinero guarda', async () => {
    await expect(
      ds.query(
        `INSERT INTO moneda (nombre, codigo_iso, codigo_numero, simbolo, decimales)
         VALUES ('Moneda de prueba', 'XTS', '963', 'X', 6)`,
      ),
    ).rejects.toThrow(/chk_moneda_decimales/);

    // Y las sembradas cumplen: si alguna no cumpliera, el CHECK no habría podido
    // crearse y este test pasaría por el motivo equivocado.
    const fuera = await ds.query(
      `SELECT codigo_iso FROM moneda WHERE decimales < 0 OR decimales > 4`,
    );
    expect(fuera).toEqual([]);
  });
  /**
   * Las dos perillas de redondeo del país solo pueden imponer valores que
   * existen. Las columnas son `varchar`/`text`, así que hasta el 2026-09-04 un
   * typo en el seeder dejaba a TODOS los tenants de ese país sin ninguna
   * configuración guardable: `assertRedondeoPermitido` exige el valor del país
   * y el `@IsIn` del DTO no lo deja escribir, así que el rechazo llega del
   * `ValidationPipe` hablando de un campo que el tenant nunca tocó.
   */
  it('ningún país puede imponer un modo o un nivel de redondeo que no existe', async () => {
    await expect(
      ds.query(
        `INSERT INTO pais (nombre, codigo_iso, zona_horaria_principal, modo_redondeo_sugerido)
         VALUES ('País de prueba', 'XA', 'UTC', 'HALF_DOWN')`,
      ),
    ).rejects.toThrow(/chk_pais_modo_redondeo_dominio/);

    await expect(
      ds.query(
        `INSERT INTO pais (nombre, codigo_iso, zona_horaria_principal, nivel_redondeo_sugerido)
         VALUES ('País de prueba', 'XB', 'UTC', 'venta')`,
      ),
    ).rejects.toThrow(/chk_pais_nivel_redondeo_dominio/);

    // Y los sembrados cumplen: si alguno no cumpliera, el CHECK no habría
    // podido crearse y este test pasaría por el motivo equivocado.
    const fuera: unknown[] = await ds.query(
      // Sin filtrar `eliminado_el` a propósito: el CHECK tampoco distingue, así
      // que una fila borrada que violara el dominio habría impedido crearlo
      // igual. Filtrar acá escondería justo esa fila.
      `SELECT codigo_iso FROM pais
        WHERE modo_redondeo_sugerido NOT IN ('HALF_UP','HALF_EVEN','FLOOR','CEIL')
           OR nivel_redondeo_sugerido NOT IN ('linea','documento')`,
    );
    expect(fuera).toEqual([]);
  });

  /**
   * El agujero que un `@Check` NO puede tapar, porque cruza dos tablas: el
   * nivel lo sugiere `pais` y los decimales viven en `moneda`.
   *
   * Con `nivel_redondeo_sugerido = 'documento'` y una moneda oficial de 0
   * decimales, las dos reglas se contradicen y el tenant queda sin salida:
   * `TenantsService.create` nace con ese nivel —lo toma del país aunque no sea
   * ley— y `updatePreferenciasFinancieras` rechaza esa misma combinación con
   * *"la moneda oficial del tenant no admite decimales"*. Ni una perilla ni la
   * otra lo saca de ahí.
   *
   * Hoy es inalcanzable —el único país con `'documento'` es México y el peso
   * mexicano tiene dos decimales— y **nada lo impide**: una edición del seeder
   * alcanza. Por eso el test va sobre los datos sembrados y no sobre un
   * rechazo: lo que hay que cazar es la fila que alguien agregue mañana.
   */
  it('ningún país sugiere un nivel de redondeo que su moneda oficial no admite', async () => {
    const imposibles: unknown[] = await ds.query(
      // `moneda` NO se filtra por `eliminado_el` a propósito: si la moneda
      // oficial de un país estuviera borrada, excluirla escondería justo la
      // fila que este test busca.
      `SELECT p.codigo_iso, m.codigo_iso AS moneda, m.decimales
         FROM pais p
         JOIN moneda m ON m.moneda_id = p.moneda_oficial_id
        WHERE p.eliminado_el IS NULL
          AND p.nivel_redondeo_sugerido = 'documento'
          AND m.decimales = 0`,
    );
    expect(imposibles).toEqual([]);

    // Y el `WHERE` está mirando filas de verdad: sin al menos un país que
    // sugiera 'documento', el vacío de arriba sale por falta de datos y no por
    // la invariante — el mismo modo de falla que el test de la base vacía.
    //
    // ⚠️ El control cuenta **sobre el mismo JOIN**, no sobre `pais` sola:
    // `moneda_oficial_id` es nullable, así que un país 'documento' sin moneda
    // se caería del JOIN de arriba y un control sin él seguiría en verde. Con
    // el JOIN adentro, lo único que separa "vacío" de "encontró la fila" es el
    // predicado de los decimales, que es lo que se está probando.
    const [{ total }]: { total: number }[] = await ds.query(
      // `moneda` sin filtrar por `eliminado_el`, por el mismo motivo que la
      // query de arriba: el control tiene que mirar exactamente el mismo
      // conjunto que la invariante, o deja de ser su control.
      `SELECT COUNT(*)::int AS total
         FROM pais p
         JOIN moneda m ON m.moneda_id = p.moneda_oficial_id
        WHERE p.nivel_redondeo_sugerido = 'documento'
          AND p.eliminado_el IS NULL`,
    );
    expect(total).toBeGreaterThan(0);
  });
});
