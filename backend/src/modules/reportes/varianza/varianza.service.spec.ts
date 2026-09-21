import { Test, type TestingModule } from '@nestjs/testing';
import { Db } from '../../../common/db/db.service';
import { assertSinHuecos } from '../../../common/db/db.spec-helper';
import { VarianzaService } from './varianza.service';

const TENANT = 'tenant-uuid';

/**
 * Rango con HORA, no fecha pura, a propósito: así `requiereDiaNegocio` da
 * `false` y `findAll` no dispara la consulta del día del negocio, que no es lo
 * que estos tests miden. El molde es el de `anulaciones-reporte.service.spec.ts`.
 *
 * El día del negocio tiene su propia cobertura: el e2e prueba fecha pura contra
 * Postgres real, que es el único lugar donde el `AT TIME ZONE` se ejerce de
 * verdad.
 */
const RANGO = {
  desde: '2026-09-01T00:00:00.000Z',
  hasta: '2026-09-30T00:00:00.000Z',
};

/** Rango del resumen: con HORA, para no disparar la consulta del día del negocio. */
const RANGO_RESUMEN = {
  desde: '2026-09-01T00:00:00.000Z',
  hasta: '2026-09-30T00:00:00.000Z',
};

const HARINA = 'item-harina';
const LOCAL = 'ubic-local';
const CLP = 'moneda-clp';

/**
 * Fila cruda de la consulta de ventanas: un (item, ubicación) con los dos
 * recuentos que lo cierran ya resueltos por SQL.
 */
const grupoRow = (overrides: Record<string, unknown> = {}) => ({
  item_id: HARINA,
  item_nombre: 'Harina',
  unidad_medida: 'kg',
  ubicacion_id: LOCAL,
  ubicacion_nombre: 'Local',
  recuentos: 2,
  recuento_inicial_id: 'rec-A',
  recuento_final_id: 'rec-B',
  desde_el: new Date('2026-09-01T12:00:00Z'),
  hasta_el: new Date('2026-09-20T12:00:00Z'),
  secuencia_desde: '1000',
  secuencia_hasta: '2000',
  // Lo que la consulta que pagina agrega al grupo: la moneda —que sale del
  // `GROUP BY`, no del `LATERAL`— más la cantidad sin explicación, su plata y si
  // algún movimiento vino sin costo, que esos tres sí los calcula
  // `SQL_COSTO_LATERAL`. Van acá y no en el bucket porque son la misma consulta
  // que elige y ordena la página.
  moneda_id: CLP,
  sin_explicacion: '0.0000',
  monto: '0.0000',
  falta_costo: false,
  ...overrides,
});

describe('VarianzaService', () => {
  let service: VarianzaService;
  let dbQueryMock: jest.Mock;

  beforeEach(async () => {
    dbQueryMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VarianzaService,
        { provide: Db, useValue: { query: dbQueryMock } },
      ],
    }).compile();

    service = module.get<VarianzaService>(VarianzaService);
  });

  /**
   * Mockea, en orden: el COUNT de grupos, la página de grupos y la agregación
   * de buckets del kardex.
   *
   * ⚠️ La tercera solo se dispara si hay algún grupo MEDIBLE: sin ventanas no
   * hay nada que agregar, y pedirla igual sería una consulta al pedo. Por eso
   * `buckets` es opcional y por defecto va vacío.
   */
  function mockGrupos(
    filas: Record<string, unknown>[],
    buckets: Record<string, unknown>[] = [],
    saldos: Record<string, unknown>[] = [],
  ): void {
    dbQueryMock
      .mockResolvedValueOnce([{ total: filas.length }])
      .mockResolvedValueOnce(filas)
      .mockResolvedValueOnce(buckets)
      .mockResolvedValueOnce(saldos);
  }

  /**
   * Fila cruda de la agregación de buckets, ya sumada por (item, ubicación).
   *
   * Los valores de los tests son **primos y distintos entre sí** a propósito:
   * con dos buckets en la misma cantidad, un bug que los sume al lado
   * equivocado pasa el test sin que nadie lo note.
   */
  const bucketRow = (overrides: Record<string, unknown> = {}) => ({
    item_id: HARINA,
    ubicacion_id: LOCAL,
    teorico: '0.0000',
    merma: '0.0000',
    cortesia: '0.0000',
    abastecimiento: '0.0000',
    ...overrides,
  });

  /** Fila cruda de la consulta de saldos: el stock en cada borde de la ventana. */
  const saldoRow = (overrides: Record<string, unknown> = {}) => ({
    item_id: HARINA,
    ubicacion_id: LOCAL,
    saldo_desde: '0.0000',
    saldo_hasta: '0.0000',
    ...overrides,
  });

  describe('la ventana de cada (producto, ubicación)', () => {
    it('con DOS recuentos aplicados en el rango, la fila es medible y usa el más viejo y el más nuevo', async () => {
      mockGrupos([grupoRow()]);

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data).toHaveLength(1);
      expect(res.data[0]).toMatchObject({
        itemId: HARINA,
        ubicacionId: LOCAL,
        medible: true,
        recuentoInicialId: 'rec-A',
        recuentoFinalId: 'rec-B',
      });
    });

    /**
     * Con TRES, el del medio **no es borde**: sus movimientos caen DENTRO de la
     * ventana, que es lo correcto —una diferencia que ese conteo descubrió es
     * varianza del período, no el cierre de otro—. Lo que se verifica acá es
     * que los bordes siguen siendo el primero y el último.
     */
    it('con TRES recuentos, los bordes son el primero y el último, no el del medio', async () => {
      mockGrupos([
        grupoRow({
          recuentos: 3,
          recuento_inicial_id: 'rec-A',
          recuento_final_id: 'rec-C',
          secuencia_desde: '1000',
          secuencia_hasta: '3000',
        }),
      ]);

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data[0]).toMatchObject({
        medible: true,
        recuentoInicialId: 'rec-A',
        recuentoFinalId: 'rec-C',
      });
    });

    /**
     * Un solo recuento en el rango: **no hay ventana**. La fila igual aparece,
     * porque alguien contó ese producto y merece saber que no alcanza — pero
     * sin números, que es la diferencia entre "no se perdió nada" y "todavía no
     * se puede medir".
     */
    it('con UN solo recuento, la fila no es medible y no trae números', async () => {
      mockGrupos([
        grupoRow({
          recuentos: 1,
          recuento_inicial_id: 'rec-A',
          recuento_final_id: null,
          hasta_el: null,
          secuencia_hasta: null,
        }),
      ]);

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data[0]).toMatchObject({
        itemId: HARINA,
        medible: false,
        teorico: null,
        merma: null,
        cortesia: null,
        sinExplicacion: null,
        otros: null,
      });
    });

    /**
     * ⚠️ El borde del recuento que **dio justo** no tiene `movimiento_id`, así
     * que su `secuencia` viene `null` y el filtro cae en `aplicado_el`
     * (spec § 5.2). La fila sigue siendo medible: lo que cambia es de dónde sale
     * el borde, no si se puede medir.
     */
    it('un recuento sin movimiento propio (delta cero) deja la secuencia en null pero la fila sigue siendo medible', async () => {
      mockGrupos([grupoRow({ secuencia_desde: null })]);

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data[0]).toMatchObject({ medible: true });
    });

    /**
     * ⚠️ **Este test afirma sobre el SQL y no sobre la conducta, y hay un motivo
     * medido.** El test de arriba NO prueba que el `LEFT` esté: pasa porque el
     * fixture *ya trae* la secuencia en `null`. Se verificó mutando
     * `LEFT JOIN` → `JOIN`: **los nueve tests siguieron en verde**, porque con
     * `Db` mockeado el mock devuelve las filas que se le piden sin importar el
     * JOIN.
     *
     * El `LEFT` carga peso real: con un `JOIN` normal, el grupo cuyo recuento
     * dio **delta cero** —el que no escribió movimiento, y por lo tanto tiene
     * `rl.movimiento_id` en `NULL`— desaparecería del reporte. Justo el conteo
     * que salió perfecto.
     *
     * La prueba de conducta de verdad vive en el e2e, contra Postgres real. Esta
     * es el guard rápido que mata el mutante en el ciclo corto. No hay colisión
     * con el docblock que también dice "LEFT JOIN": la aserción corre sobre el
     * string que llega a `Db.query`, no sobre el archivo.
     */
    it('el JOIN al kardex es LEFT, o el recuento de delta cero se cae del reporte', async () => {
      mockGrupos([grupoRow()]);

      await service.findAll(TENANT, RANGO);

      const [sqlPagina] = dbQueryMock.mock.calls[1] as [string, unknown[]];
      expect(sqlPagina).toContain('LEFT JOIN movimientos_inventario mv');
    });

    /**
     * ⚠️ **También afirma sobre el SQL, y por una razón parecida: el caso no se
     * puede montar por la API.** `aplicado_el` es el `NOW()` de la transacción
     * del aplicar, así que dos recuentos empatados al microsegundo no se pueden
     * provocar desde un test — ni siquiera con Postgres real.
     *
     * Lo que protege: los seis `array_agg` de los bordes son llamadas
     * **independientes**. Con la clave de orden empatada, nada garantiza que el
     * id, la fecha y la secuencia salgan de la MISMA fila, y el resultado sería
     * una ventana con el id de un recuento y la fecha de otro — un período que
     * nunca existió, sin ningún síntoma. `r.recuento_id` es único: alcanza para
     * que el orden sea total y los seis coincidan siempre.
     */
    it('los bordes desempatan por recuento_id, o con aplicado_el empatado salen mezclados', async () => {
      mockGrupos([grupoRow()]);

      await service.findAll(TENANT, RANGO);

      const [sqlPagina] = dbQueryMock.mock.calls[1] as [string, unknown[]];
      const conDesempate = sqlPagina.match(
        /ORDER BY r\.aplicado_el (?:ASC|DESC), r\.recuento_id (?:ASC|DESC)/g,
      );
      const total = sqlPagina.match(/ORDER BY r\.aplicado_el/g);
      expect(conDesempate).toHaveLength(total?.length ?? 0);
      expect(conDesempate?.length).toBe(6);
    });
  });

  /**
   * ⛔ **Lo que este bloque NO prueba, y conviene saberlo antes de confiar en
   * él.** La **clasificación** de cada movimiento en su bucket vive entera en
   * el SQL (`SQL_BUCKETS`), y con `Db` mockeado el mock devuelve los buckets
   * **ya clasificados**. Medido el 2026-09-20: mutar el filtro de `merma` para
   * que se coma también la cortesía dejó **los 18 tests en verde**.
   *
   * O sea: estos tests cubren el **mapeo y el formato** —que el número llegue a
   * su columna, con su signo y a escala 4—, no que el movimiento haya caído en
   * el bucket correcto. Eso solo lo puede probar el e2e contra Postgres real,
   * donde el escenario se arma vendiendo, anulando y mermando de verdad.
   *
   * ⚠️ El plan original prometía "un mutante por bucket, cada uno mata solo su
   * test". Con el mock eso es falso, y darlo por cierto habría dejado la
   * clasificación sin ninguna cobertura.
   */
  describe('los cuatro números', () => {
    /**
     * Valores primos y distintos entre sí en todos los casos: con dos buckets
     * en la misma cantidad, un bug que sume al lado equivocado pasa el test.
     */
    it('una salida de venta va al teórico', async () => {
      mockGrupos([grupoRow()], [bucketRow({ teorico: '13.0000' })]);

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data[0]).toMatchObject({
        teorico: '13.0000',
        merma: '0.0000',
        cortesia: '0.0000',
        sinExplicacion: '0.0000',
      });
    });

    /**
     * El teórico es **neto**: cancelar una venta repone los ingredientes al
     * kardex (`motivo='anulacion'`), así que esa entrada tiene que restar del
     * teórico y no sumar a ningún otro bucket. Acá la resta ya viene hecha por
     * el SQL; lo que el unitario verifica es que el service no la vuelva a
     * tocar ni la mande a otra columna.
     */
    it('el teórico llega neto de anulaciones y devoluciones', async () => {
      mockGrupos([grupoRow()], [bucketRow({ teorico: '7.0000' })]);

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data[0]).toMatchObject({ teorico: '7.0000' });
    });

    it('merma y cortesía viajan separadas, cada una en su columna', async () => {
      mockGrupos(
        [grupoRow()],
        [bucketRow({ merma: '11.0000', cortesia: '3.0000' })],
      );

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data[0]).toMatchObject({
        merma: '11.0000',
        cortesia: '3.0000',
      });
    });

    /**
     * ⚠️ **El signo importa y es el caso que más fácil se escribe al revés.**
     * Un recuento con SOBRANTE es una entrada: encontraste MÁS de lo que el
     * sistema creía, así que el consumo real fue MENOR. `sinExplicacion` sale
     * negativo, y un valor absoluto lo convertiría en una pérdida que no
     * existió.
     */
    it('un sobrante deja sinExplicacion en negativo, no en valor absoluto', async () => {
      mockGrupos([grupoRow({ sin_explicacion: '-3.0000' })]);

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data[0]).toMatchObject({ sinExplicacion: '-3.0000' });
    });

    /**
     * Un grupo medible cuya ventana no tuvo NINGÚN movimiento no vuelve en la
     * agregación —no hay filas que sumar—, y aun así sus números tienen que ser
     * ceros y no `null`: la ventana existe y la respuesta es "no se movió
     * nada", que es distinto de "no se puede medir".
     */
    it('un grupo medible sin movimientos en la ventana da ceros, no null', async () => {
      mockGrupos([grupoRow()], []);

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data[0]).toMatchObject({
        medible: true,
        teorico: '0.0000',
        merma: '0.0000',
        cortesia: '0.0000',
        sinExplicacion: '0.0000',
      });
    });

    /**
     * Los buckets se piden UNA vez para todas las ventanas de la página, no una
     * consulta por fila. Con dos grupos, el total de llamadas sigue siendo tres:
     * COUNT, página y buckets.
     */
    it('resuelve los buckets de TODAS las ventanas en una sola consulta', async () => {
      const OTRO = 'item-aceite';
      mockGrupos(
        [grupoRow(), grupoRow({ item_id: OTRO, item_nombre: 'Aceite' })],
        [
          bucketRow({ teorico: '13.0000' }),
          bucketRow({ item_id: OTRO, teorico: '17.0000' }),
        ],
      );

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data.find((f) => f.itemId === HARINA)?.teorico).toBe(
        '13.0000',
      );
      expect(res.data.find((f) => f.itemId === OTRO)?.teorico).toBe('17.0000');

      // ⚠️ La aserción que importa NO es un número fijo de llamadas: ése hay que
      // corregirlo en cada tarea que sume una consulta, y entonces deja de
      // proteger nada. Lo que define un N+1 es que las llamadas **crezcan con
      // la cantidad de filas**, así que eso es lo que se compara: dos grupos
      // tienen que costar lo mismo que uno.
      const conDosGrupos = dbQueryMock.mock.calls.length;

      dbQueryMock.mockReset();
      mockGrupos([grupoRow()], [bucketRow()], [saldoRow()]);
      await service.findAll(TENANT, RANGO);

      expect(dbQueryMock.mock.calls).toHaveLength(conDosGrupos);
    });

    /**
     * Sin ningún grupo medible no hay ventana que agregar: pedir la consulta de
     * buckets igual sería un viaje a la base para nada.
     */
    it('no consulta el kardex si ninguna fila es medible', async () => {
      mockGrupos([grupoRow({ recuentos: 1, recuento_final_id: null })]);

      await service.findAll(TENANT, RANGO);

      expect(dbQueryMock.mock.calls).toHaveLength(2);
    });
  });

  describe('la columna «Otros»', () => {
    /**
     * ⛔ **Lo que este bloque prueba y lo que no.** «Otros» es el **residuo**
     * entre las dos formas de calcular el consumo real, y esa resta es
     * aritmética en TypeScript: **acá sí se prueba de verdad**. Lo que NO se
     * puede probar con `Db` mockeado es QUÉ movimientos cuentan como
     * abastecimiento —eso vive en el `FILTER` del SQL— ni que los saldos de
     * borde sean los correctos. Eso lo cubre el e2e (lección medida en la
     * Tarea 3: los cuatro mutantes de clasificación sobrevivieron a los
     * unitarios).
     *
     * La identidad que se verifica:
     *   consumoPorSaldos = saldoDesde + abastecimiento − saldoHasta
     *   otros            = consumoPorSaldos − (teórico + merma + cortesía + sinExpl.)
     */
    it('cuando la cuenta cierra, otros da exactamente cero', async () => {
      // 100 al abrir, 40 de abastecimiento, 110 al cerrar → consumo real 30.
      // Buckets: 21 de venta + 6 de merma + 3 sin explicación = 30. Cierra.
      mockGrupos(
        [grupoRow({ sin_explicacion: '3.0000' })],
        [
          bucketRow({
            teorico: '21.0000',
            merma: '6.0000',
            abastecimiento: '40.0000',
          }),
        ],
        [saldoRow({ saldo_desde: '100.0000', saldo_hasta: '110.0000' })],
      );

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data[0]).toMatchObject({ otros: '0.0000' });
    });

    /**
     * ⚠️ **El caso que distingue el detector del adorno.** Un `otros` cableado a
     * `'0.0000'` pasa el test de arriba igual; solo falla si la cuenta NO cierra
     * y el número tiene que valer la diferencia exacta.
     *
     * Acá el consumo por saldos es 30 y los buckets suman 23: hay 7 que ningún
     * bucket clasificó — un `motivo` que el reporte no conoce.
     */
    it('cuando NO cierra, otros vale exactamente la diferencia', async () => {
      mockGrupos(
        [grupoRow()],
        [
          bucketRow({
            teorico: '21.0000',
            merma: '2.0000',
            abastecimiento: '40.0000',
          }),
        ],
        [saldoRow({ saldo_desde: '100.0000', saldo_hasta: '110.0000' })],
      );

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data[0]).toMatchObject({ otros: '7.0000' });
    });

    /**
     * El residuo puede salir **negativo**: significa que los buckets explican
     * MÁS consumo del que los saldos sostienen. Es tan anómalo como el positivo
     * y no se puede tapar con un valor absoluto, que lo haría ver como una
     * pérdida más.
     */
    it('un residuo negativo se muestra negativo, no en valor absoluto', async () => {
      mockGrupos(
        [grupoRow()],
        [
          bucketRow({
            teorico: '35.0000',
            abastecimiento: '40.0000',
          }),
        ],
        [saldoRow({ saldo_desde: '100.0000', saldo_hasta: '110.0000' })],
      );

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data[0]).toMatchObject({ otros: '-5.0000' });
    });

    /**
     * ⚠️ **`otros` viaja SIEMPRE, incluso en `'0.0000'`.** Omitirlo cuando es
     * cero dejaría al consumidor sin poder distinguir "cerró perfecto" de "esta
     * versión todavía no lo calcula", que es justo la ambigüedad que la columna
     * existe para cerrar.
     */
    it('otros está presente en la respuesta aunque valga cero', async () => {
      mockGrupos([grupoRow()], [bucketRow()], [saldoRow()]);

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data[0]).toHaveProperty('otros', '0.0000');
    });

    it('en una fila no medible, otros es null como los demás números', async () => {
      mockGrupos([grupoRow({ recuentos: 1, recuento_final_id: null })]);

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data[0]).toMatchObject({ medible: false, otros: null });
    });

    /**
     * Los saldos de TODAS las ventanas salen en una consulta, no una por fila.
     * Con dos grupos medibles el total de llamadas sigue siendo cuatro: COUNT,
     * página, buckets y saldos.
     */
    it('resuelve los saldos de todas las ventanas en una sola consulta', async () => {
      const OTRO = 'item-aceite';
      mockGrupos(
        [grupoRow(), grupoRow({ item_id: OTRO, item_nombre: 'Aceite' })],
        [bucketRow(), bucketRow({ item_id: OTRO })],
        [saldoRow(), saldoRow({ item_id: OTRO })],
      );

      await service.findAll(TENANT, RANGO);
      const conDosGrupos = dbQueryMock.mock.calls.length;

      dbQueryMock.mockReset();
      mockGrupos([grupoRow()], [bucketRow()], [saldoRow()]);
      await service.findAll(TENANT, RANGO);

      expect(dbQueryMock.mock.calls).toHaveLength(conDosGrupos);
    });

    it('no consulta saldos si ninguna fila es medible', async () => {
      mockGrupos([grupoRow({ recuentos: 1, recuento_final_id: null })]);

      await service.findAll(TENANT, RANGO);

      expect(dbQueryMock.mock.calls).toHaveLength(2);
    });
  });

  describe('la plata de la varianza', () => {
    /**
     * ⚠️ **Lo que estos unitarios NO prueban, y hay que decirlo:** el `Db`
     * mockeado devuelve las filas que el test le dicta, así que no ve la suma,
     * ni el `ROUND`, ni el orden de la página, ni el filtro. Todo eso es SQL y
     * vive en `reportes-varianza-plata.e2e-spec.ts`, contra Postgres real. Acá
     * solo se prueba el **mapeo**: qué hace el service con lo que le llega.
     * (Es la lección medida de la Tarea 3: los cuatro mutantes de clasificación
     * sobrevivieron a 18 unitarios con `Db` mockeado.)
     */
    it('la plata sale con la moneda del ítem, sin inventarla', async () => {
      mockGrupos([
        grupoRow({ sin_explicacion: '4.0000', monto: '12400.0000' }),
      ]);

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data[0]).toMatchObject({
        sinExplicacion: '4.0000',
        costoSinExplicacion: [{ monedaId: CLP, monto: '12400.0000' }],
        faltaCosto: false,
      });
    });

    /**
     * Dos monedas distintas **no se suman ni se convierten**. Y son dos FILAS:
     * `items.moneda_id` es `NOT NULL` y una fila es un ítem, así que una sola
     * fila nunca puede traer dos monedas. Un test que lo intentara estaría
     * probando un caso que el esquema no permite.
     */
    it('dos productos en monedas distintas quedan separados, cada uno con la suya', async () => {
      const USD = 'moneda-usd';
      mockGrupos([
        grupoRow({ sin_explicacion: '4.0000', monto: '12400.0000' }),
        grupoRow({
          item_id: 'item-vino',
          item_nombre: 'Vino',
          moneda_id: USD,
          sin_explicacion: '2.0000',
          monto: '31.0000',
        }),
      ]);

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data[0].costoSinExplicacion).toEqual([
        { monedaId: CLP, monto: '12400.0000' },
      ]);
      expect(res.data[1].costoSinExplicacion).toEqual([
        { monedaId: USD, monto: '31.0000' },
      ]);
    });

    /**
     * ⛔ **Sin un costo, la fila va sin cifra — no con la cifra de los que sí lo
     * tenían.** Es el criterio de `anulaciones-reporte.service.ts`: una suma
     * parcial se lee como completa. La CANTIDAD sí sigue viajando: esa no
     * depende del costo, y es justo lo que el encargado necesita ver para
     * entender que le falta cargar un precio.
     */
    it('si algún movimiento vino sin costo, la fila va sin cifra pero con la cantidad', async () => {
      mockGrupos([
        grupoRow({
          sin_explicacion: '4.0000',
          monto: '3100.0000',
          falta_costo: true,
        }),
      ]);

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data[0]).toMatchObject({
        sinExplicacion: '4.0000',
        costoSinExplicacion: [],
        faltaCosto: true,
      });
    });

    /**
     * `bool_or` sobre cero movimientos vuelve `NULL`, no `false`. Leerlo como
     * booleano a secas marcaría `faltaCosto` en una fila que no tiene ningún
     * movimiento del cual falte nada.
     */
    it('un falta_costo en null no marca la fila', async () => {
      mockGrupos([grupoRow({ falta_costo: null })]);

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data[0].faltaCosto).toBe(false);
    });

    /**
     * Una fila que no se puede medir no tiene plata que mostrar: sin dos
     * conteos no hay ventana, y un `'0.0000'` ahí se leería como "no perdiste
     * nada" cuando lo cierto es "todavía no se puede saber".
     */
    it('una fila no medible va sin plata, no con plata en cero', async () => {
      mockGrupos([
        grupoRow({
          recuentos: 1,
          recuento_final_id: null,
          monto: '12400.0000',
          falta_costo: true,
        }),
      ]);

      const res = await service.findAll(TENANT, RANGO);

      expect(res.data[0]).toMatchObject({
        medible: false,
        sinExplicacion: null,
        costoSinExplicacion: [],
        faltaCosto: false,
      });
    });
  });

  describe('qué recuentos cuentan como borde', () => {
    /**
     * `estado = 'aplicado'` y no `<> 'cancelado'`: un recuento en `borrador`
     * todavía no movió stock, así que tomarlo como borde mediría contra un
     * saldo que nadie escribió.
     */
    it('la consulta exige estado aplicado y filtra el borrado', async () => {
      mockGrupos([grupoRow()]);

      await service.findAll(TENANT, RANGO);

      const [sql] = dbQueryMock.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("r.estado = 'aplicado'");
      expect(sql).toContain('r.eliminado_el IS NULL');
      expect(sql).toContain('rl.eliminado_el IS NULL');
    });

    /**
     * ⚠️ **No hay `HAVING COUNT(...) >= 2`, y es deliberado.** La primera versión
     * del plan lo pedía, pero escondería las filas con un solo recuento — y esas
     * tienen que aparecer, como "falta contarlo". La consulta cuenta los
     * recuentos por grupo y **el service decide** con ese número; el filtro que
     * el plan proponía haría invisible el caso que más le importa a alguien que
     * recién empieza a contar.
     *
     * `COUNT(DISTINCT r.recuento_id)` y no `COUNT(*)`: el `DISTINCT` es lo que
     * impide que dos líneas del mismo recuento inflen el número y hagan pasar
     * por medible a un grupo contado una sola vez.
     *
     * La aserción va sobre la consulta de la PÁGINA (llamada 1), no sobre el
     * `COUNT` de paginación (llamada 0), que solo cuenta grupos.
     */
    it('cuenta recuentos DISTINTOS por grupo, sin filtrarlos con HAVING', async () => {
      mockGrupos([grupoRow()]);

      await service.findAll(TENANT, RANGO);

      const [sqlPagina] = dbQueryMock.mock.calls[1] as [string, unknown[]];
      expect(sqlPagina).toContain('COUNT(DISTINCT r.recuento_id)');
      expect(sqlPagina).not.toContain('HAVING');
    });
  });

  /**
   * ⚠️ Las aserciones de abajo recorren `dbQueryMock.mock.calls`, y **un `for`
   * sobre cero llamadas pasa en verde sin afirmar nada**. Con `findAll`
   * devolviendo una página vacía sin consultar, los tres tests de binds y
   * tenant pasaban vacuamente — medido el 2026-09-19 al correrlos antes de
   * implementar. Este guard es lo que los vuelve tests de verdad: primero se
   * exige que HAYA consultas, después se las audita.
   */
  function exigirQueConsulto(): void {
    expect(dbQueryMock.mock.calls.length).toBeGreaterThan(0);
  }

  describe('el resumen', () => {
    const USD = 'moneda-usd';

    /**
     * ⚠️ El mock despacha **por el texto del SQL**, no por orden de llamada. Hoy
     * el resumen consulta en secuencia, así que un mock posicional también
     * andaría — pero se rompería en silencio al agregar, sacar o reordenar una
     * consulta, que es justo lo que pasó al quitar el aviso de teórico
     * incompleto. Despachar por contenido además deja en evidencia si una
     * consulta deja de existir: su mock nunca se usa y el test falla por el lado
     * correcto.
     */
    function mockResumen(datos: {
      montos?: Record<string, unknown>[];
      conteo?: Record<string, unknown>[];
    }): void {
      dbQueryMock.mockImplementation((sql: string) => {
        // El día del negocio: lo pide `diaNegocioTenant` cuando el rango viene en
        // fecha PURA. Con zona vacía el util no expande nada, que es lo que estos
        // tests quieren — lo que hace el `AT TIME ZONE` se prueba en el e2e.
        if (sql.includes('zona_horaria'))
          return Promise.resolve([{ zona_horaria: 'UTC', hora_corte: null }]);
        if (sql.includes('consumo_total'))
          return Promise.resolve(datos.montos ?? []);
        if (sql.includes('MAX(q.recuentos)'))
          return Promise.resolve(datos.conteo ?? []);
        throw new Error(
          `consulta inesperada en el resumen: ${sql.slice(0, 80)}`,
        );
      });
    }

    const montoRow = (overrides: Record<string, unknown> = {}) => ({
      item_id: HARINA,
      item_nombre: 'Harina',
      moneda_id: CLP,
      teorico: '0',
      merma: '0',
      cortesia: '0',
      sin_explicacion: '0',
      consumo_total: '0',
      abastecimiento: '0',
      falta_costo: false,
      ...overrides,
    });

    describe('el rango, que acá es obligatorio y tiene tope', () => {
      it('rechaza un hasta anterior al desde', async () => {
        mockResumen({});
        await expect(
          service.resumen(TENANT, { desde: '2026-09-30', hasta: '2026-09-01' }),
        ).rejects.toThrow('hasta no puede ser anterior a desde');
      });

      /**
       * ⛔ El tope no es cosmético: el resumen corre sin `LIMIT` sobre todo el
       * rango, así que sin piso un pedido con dos años traería a memoria el
       * historial entero del tenant. Es el bug que la ronda de fix de anulaciones
       * cerró, con este mismo mensaje.
       */
      it('rechaza un rango de más de 366 días', async () => {
        mockResumen({});
        await expect(
          service.resumen(TENANT, { desde: '2025-01-01', hasta: '2026-06-01' }),
        ).rejects.toThrow('no puede superar 366 días');
      });

      /** 366 justos entran: el tope es "más de", no "desde". */
      it('acepta exactamente 366 días', async () => {
        mockResumen({});
        await expect(
          service.resumen(TENANT, { desde: '2026-01-01', hasta: '2027-01-02' }),
        ).resolves.toBeDefined();
      });

      /**
       * ⛔ **La validación corre ANTES de cualquier consulta.** Si corriera
       * después, el rango sin tope ya habría hecho el trabajo que el tope viene a
       * evitar.
       */
      it('no consulta nada si el rango es inválido', async () => {
        mockResumen({});
        await expect(
          service.resumen(TENANT, { desde: '2020-01-01', hasta: '2026-01-01' }),
        ).rejects.toThrow();
        expect(dbQueryMock).not.toHaveBeenCalled();
      });
    });

    it('los totales van por moneda y no se suman entre sí', async () => {
      mockResumen({
        montos: [
          montoRow({ merma: '1200.0000', consumo_total: '1200.0000' }),
          montoRow({
            item_id: 'item-vino',
            item_nombre: 'Vino',
            moneda_id: USD,
            merma: '7.0000',
            consumo_total: '7.0000',
          }),
        ],
      });

      const res = await service.resumen(TENANT, RANGO_RESUMEN);

      expect(res.totales.merma).toEqual([
        { monedaId: CLP, monto: '1200.0000' },
        { monedaId: USD, monto: '7.0000' },
      ]);
    });

    /**
     * ⛔ **«Otros» se DESPEJA, no se enumera.** El movimiento que no cae en
     * ningún balde —acá 5 de ajuste manual— aparece en «Otros» sin que nadie lo
     * haya nombrado: es lo que hace que un motivo nuevo no quede invisible.
     *
     * consumo_total 30 = teórico 21 + merma 6 + sin explicación 3 + otros 5 − abastecimiento 5
     */
    it('otros sale de la resta, sin que ningún motivo esté nombrado', async () => {
      mockResumen({
        montos: [
          montoRow({
            teorico: '21.0000',
            merma: '6.0000',
            sin_explicacion: '3.0000',
            abastecimiento: '5.0000',
            consumo_total: '30.0000',
          }),
        ],
      });

      const res = await service.resumen(TENANT, RANGO_RESUMEN);

      expect(res.totales.otros).toEqual([{ monedaId: CLP, monto: '5.0000' }]);
    });

    /**
     * ⚠️ **El ranking es por plata PERDIDA, sin el teórico.** El teórico es lo
     * que el local gastó cocinando, no lo que perdió: meterlo pondría primeros a
     * los productos que más se venden. Acá el que más teórico tiene es el que
     * menos perdió, justamente para que el test lo distinga.
     */
    it('el top ordena por pérdida y no por consumo', async () => {
      mockResumen({
        montos: [
          montoRow({
            item_id: 'item-vende-mucho',
            item_nombre: 'Vende mucho',
            teorico: '900.0000',
            merma: '1.0000',
            consumo_total: '901.0000',
          }),
          montoRow({
            item_id: 'item-pierde',
            item_nombre: 'Pierde',
            teorico: '10.0000',
            sin_explicacion: '80.0000',
            consumo_total: '90.0000',
          }),
        ],
      });

      const res = await service.resumen(TENANT, RANGO_RESUMEN);

      expect(res.top.map((t) => t.itemId)).toEqual([
        'item-pierde',
        'item-vende-mucho',
      ]);
      expect(res.fueraDelTop).toBe(0);
    });

    it('con más de diez productos con pérdida, el resto se cuenta aparte', async () => {
      mockResumen({
        montos: Array.from({ length: 14 }, (_, n) =>
          montoRow({
            item_id: `item-${n}`,
            item_nombre: `Producto ${n}`,
            merma: `${n + 1}.0000`,
            consumo_total: `${n + 1}.0000`,
          }),
        ),
      });

      const res = await service.resumen(TENANT, RANGO_RESUMEN);

      expect(res.top).toHaveLength(10);
      expect(res.fueraDelTop).toBe(4);
      expect(res.top[0].itemId).toBe('item-13');
    });

    /** Un producto que no perdió nada no ocupa lugar en la gráfica ni se cuenta. */
    it('los que no perdieron nada no entran al top ni a fueraDelTop', async () => {
      mockResumen({
        montos: [
          montoRow({ teorico: '50.0000', consumo_total: '50.0000' }),
          montoRow({
            item_id: 'item-pierde',
            item_nombre: 'Pierde',
            merma: '2.0000',
            consumo_total: '2.0000',
          }),
        ],
      });

      const res = await service.resumen(TENANT, RANGO_RESUMEN);

      expect(res.top).toHaveLength(1);
      expect(res.fueraDelTop).toBe(0);
    });

    /**
     * El mismo ítem en dos ubicaciones es UNA fila del ranking: al encargado le
     * importa qué producto pierde plata, no en qué depósito.
     */
    it('el mismo ítem en dos ubicaciones suma en una sola fila del top', async () => {
      mockResumen({
        montos: [
          montoRow({ merma: '3.0000', consumo_total: '3.0000' }),
          montoRow({ merma: '4.0000', consumo_total: '4.0000' }),
        ],
      });

      const res = await service.resumen(TENANT, RANGO_RESUMEN);

      expect(res.top).toHaveLength(1);
      expect(res.top[0].merma).toBe('7.0000');
    });

    it('si algún movimiento vino sin costo, el resumen lo declara', async () => {
      mockResumen({ montos: [montoRow({ falta_costo: true })] });

      const res = await service.resumen(TENANT, RANGO_RESUMEN);

      expect(res.faltaCosto).toBe(true);
    });

    /**
     * ⛔ **Los dos conjuntos del faltante son disjuntos por construcción** —cero
     * recuentos contra exactamente uno— y el total de cada uno tiene que ser el
     * largo de su propia lista: si la línea dice 2, que 2 sea lo que aparece al
     * abrirla.
     */
    it('el faltante de conteo se abre en dos, y cada total cierra con su lista', async () => {
      mockResumen({
        conteo: [
          { item_id: 'i1', nombre: 'Aceite', recuentos: 0 },
          { item_id: 'i2', nombre: 'Harina', recuentos: 1 },
          { item_id: 'i3', nombre: 'Sal', recuentos: 0 },
        ],
      });

      const res = await service.resumen(TENANT, RANGO_RESUMEN);

      expect(res.sinConteo.nuncaContado.total).toBe(2);
      expect(res.sinConteo.nuncaContado.items).toHaveLength(2);
      expect(res.sinConteo.contadoUnaSolaVez.total).toBe(1);
      expect(res.sinConteo.contadoUnaSolaVez.items).toEqual([
        { itemId: 'i2', nombre: 'Harina' },
      ]);
      const enLosDos = res.sinConteo.nuncaContado.items.filter((n) =>
        res.sinConteo.contadoUnaSolaVez.items.some(
          (u) => u.itemId === n.itemId,
        ),
      );
      expect(enLosDos).toEqual([]);
    });
  });

  describe('binds', () => {
    /**
     * Todo `$n` del SQL tiene su bind y todo bind está referenciado. Un hueco
     * revienta en Postgres real con `42P18` y **el mock de `Db.query` nunca lo
     * ve** — es el único modo de que un unitario falle por ese bug
     * (`db.spec-helper.ts`). Importa especialmente acá: las posiciones se
     * arman dinámicamente según qué filtros vengan.
     */
    it('ninguna consulta tiene huecos de parámetros', async () => {
      mockGrupos([grupoRow()]);

      await service.findAll(TENANT, {
        ...RANGO,
        ubicacionId: LOCAL,
        itemId: HARINA,
      });

      exigirQueConsulto();
      for (const [sql, params] of dbQueryMock.mock.calls as [
        string,
        unknown[] | undefined,
      ][]) {
        assertSinHuecos(sql, params);
      }
    });

    /**
     * ⛔ **El resumen arma sus binds por caminos distintos del listado**: el
     * faltante de conteo no pasa por `buildFiltros` —arranca en `items` para
     * poder encontrar a los que nunca se contaron— y la plata agrega un bind más
     * al final, para la lista de motivos. Son justamente las dos formas donde un
     * `$n` desalineado no lo ve nadie hasta que Postgres tira `42P18`.
     */
    it('el resumen tampoco tiene huecos, con filtros y sin ellos', async () => {
      for (const extra of [{}, { ubicacionId: LOCAL, itemId: HARINA }]) {
        dbQueryMock.mockReset();
        dbQueryMock.mockResolvedValue([]);

        await service.resumen(TENANT, { ...RANGO_RESUMEN, ...extra });

        expect(dbQueryMock.mock.calls.length).toBeGreaterThan(0);
        for (const [sql, params] of dbQueryMock.mock.calls as [
          string,
          unknown[] | undefined,
        ][]) {
          assertSinHuecos(sql, params);
        }
      }
    });

    it('sin filtros opcionales tampoco quedan huecos', async () => {
      mockGrupos([grupoRow()]);

      await service.findAll(TENANT, RANGO);

      exigirQueConsulto();
      for (const [sql, params] of dbQueryMock.mock.calls as [
        string,
        unknown[] | undefined,
      ][]) {
        assertSinHuecos(sql, params);
      }
    });
  });

  describe('alcance por tenant', () => {
    it('el tenantId del token es el primer bind de toda consulta', async () => {
      mockGrupos([grupoRow()]);

      await service.findAll(TENANT, RANGO);

      exigirQueConsulto();
      for (const [, params] of dbQueryMock.mock.calls as [
        string,
        unknown[],
      ][]) {
        expect(params[0]).toBe(TENANT);
      }
    });
  });
});
