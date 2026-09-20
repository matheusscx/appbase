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

const HARINA = 'item-harina';
const LOCAL = 'ubic-local';

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

  /** Mockea, en orden: el COUNT de grupos y la página de grupos. */
  function mockGrupos(filas: Record<string, unknown>[]): void {
    dbQueryMock
      .mockResolvedValueOnce([{ total: filas.length }])
      .mockResolvedValueOnce(filas);
  }

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
