import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

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
