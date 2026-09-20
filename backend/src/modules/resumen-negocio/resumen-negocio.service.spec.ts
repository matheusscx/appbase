import { Test, type TestingModule } from '@nestjs/testing';
import { Db } from '../../common/db/db.service';
import { assertSinHuecos } from '../../common/db/db.spec-helper';
import { ResumenNegocioService } from './resumen-negocio.service';
import {
  AnulacionesReporteService,
  type ResumenAnulaciones,
} from '../salones/anulaciones-reporte.service';
import { MermasService, type ResumenMermas } from '../mermas/mermas.service';
import { TipoMotivoBaja } from '../motivos-baja/tipo-motivo-baja.enum';

const TENANT = 'tenant-uuid';

const RESUMEN_ANULACIONES_VACIO: ResumenAnulaciones = {
  porTipo: [],
  porGarzon: [],
  porAutorizo: [],
};

const RESUMEN_MERMAS_VACIO: ResumenMermas = {
  cantidad: 0,
  costo: [],
  sinValorizar: 0,
};

interface VentasRowFixture {
  vendido_hoy: string;
  vendido_semana_pasada: string;
  cantidad_hoy: number;
  cantidad_semana_pasada: number;
  vendido_fisico_hoy: string;
  vendido_online_hoy: string;
}

interface CobradoRowFixture {
  cobrado_hoy: string;
  cobrado_semana_pasada: string;
}

interface PorCobrarRowFixture {
  cantidad: number;
  saldo: string;
}

interface MasVendidoRowFixture {
  item_id: string;
  item_nombre: string;
  cantidad: string;
  monto: string;
}

describe('ResumenNegocioService', () => {
  let service: ResumenNegocioService;
  let queryMock: jest.Mock;
  let anulacionesResumenMock: jest.Mock;
  let mermasResumenMock: jest.Mock;

  beforeEach(async () => {
    queryMock = jest.fn();
    const dbMock = {
      query: queryMock,
      transaccion: jest.fn((cb: (manager: unknown) => unknown) => cb({})),
      sinTransaccion: (fn: () => unknown) => fn(),
    };
    anulacionesResumenMock = jest.fn();
    mermasResumenMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResumenNegocioService,
        { provide: Db, useValue: dbMock },
        {
          provide: AnulacionesReporteService,
          useValue: { resumen: anulacionesResumenMock },
        },
        { provide: MermasService, useValue: { resumen: mermasResumenMock } },
      ],
    }).compile();

    service = module.get(ResumenNegocioService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Encadena las 5 respuestas de `Db.query`, EN ORDEN: zona, ventas, cobrado,
   * por cobrar, más vendidos — el mismo orden en que `ResumenNegocioService.hoy`
   * las pide. `AnulacionesReporteService.resumen` y `MermasService.resumen`
   * NO son `Db.query`: son servicios inyectados aparte, mockeados con su
   * propio default "todo cero" (Task 2, spec § 4.4). Cada bloque parte de un
   * fixture "todo cero" para que un test solo declare lo que le importa.
   */
  function mockRespuestas(opts: {
    zona?: string;
    horaCorte?: number;
    ventas?: Partial<VentasRowFixture>;
    cobrado?: Partial<CobradoRowFixture>;
    porCobrar?: Partial<PorCobrarRowFixture>;
    masVendidos?: MasVendidoRowFixture[];
    anulaciones?: ResumenAnulaciones;
    mermas?: ResumenMermas;
  }): void {
    queryMock
      .mockResolvedValueOnce([
        {
          zona_horaria: opts.zona ?? 'America/Santiago',
          hora_corte: opts.horaCorte ?? 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          vendido_hoy: '0',
          vendido_semana_pasada: '0',
          cantidad_hoy: 0,
          cantidad_semana_pasada: 0,
          vendido_fisico_hoy: '0',
          vendido_online_hoy: '0',
          ...opts.ventas,
        },
      ])
      .mockResolvedValueOnce([
        { cobrado_hoy: '0', cobrado_semana_pasada: '0', ...opts.cobrado },
      ])
      .mockResolvedValueOnce([{ cantidad: 0, saldo: '0', ...opts.porCobrar }])
      .mockResolvedValueOnce(opts.masVendidos ?? []);
    anulacionesResumenMock.mockResolvedValueOnce(
      opts.anulaciones ?? RESUMEN_ANULACIONES_VACIO,
    );
    mermasResumenMock.mockResolvedValueOnce(
      opts.mermas ?? RESUMEN_MERMAS_VACIO,
    );
  }

  it('vendido hoy 184500.0000 y semana pasada 150000.0000 → variación 0.2300', async () => {
    mockRespuestas({
      ventas: {
        vendido_hoy: '184500.0000',
        vendido_semana_pasada: '150000.0000',
        cantidad_hoy: 3,
        cantidad_semana_pasada: 3,
      },
    });

    const res = await service.hoy(TENANT);

    expect(res.ventas.vendido.hoy).toBe('184500.0000');
    expect(res.ventas.vendido.semanaPasada).toBe('150000.0000');
    expect(res.ventas.vendido.variacion).toBe('0.2300');
  });

  it('variación es null cuando la semana pasada vale 0', async () => {
    mockRespuestas({
      ventas: {
        vendido_hoy: '50000.0000',
        vendido_semana_pasada: '0',
        cantidad_hoy: 1,
      },
    });

    const res = await service.hoy(TENANT);

    expect(res.ventas.vendido.variacion).toBeNull();
  });

  it('ticketPromedio.hoy es null cuando la cantidad de hoy es 0', async () => {
    mockRespuestas({ ventas: { vendido_hoy: '0', cantidad_hoy: 0 } });

    const res = await service.hoy(TENANT);

    expect(res.ventas.ticketPromedio.hoy).toBeNull();
  });

  it('ticket con división no exacta: 100000.0000 / 3 → 33333.3333', async () => {
    mockRespuestas({
      ventas: { vendido_hoy: '100000.0000', cantidad_hoy: 3 },
    });

    const res = await service.hoy(TENANT);

    expect(res.ventas.ticketPromedio.hoy).toBe('33333.3333');
  });

  it('el SQL de ventas excluye canceladas y notas de crédito, afirmando sobre la cláusula', async () => {
    mockRespuestas({});

    await service.hoy(TENANT);

    // Llamada #2: zona es la #1. Afirmar sobre la CLÁUSULA y no con un
    // `toContain` suelto, que también matchearía el comentario que explica
    // por qué el JOIN a `td` no filtra `eliminado_el`.
    const [ventasSql] = queryMock.mock.calls[1] as [string];
    expect(ventasSql).toMatch(/v\.estado\s*<>\s*'cancelada'/);
    expect(ventasSql).toMatch(
      /COALESCE\(td\.es_nota_credito,\s*false\)\s*=\s*false/,
    );
    // `v\.eliminado_el` (no `vd\.` ni `td\.`) acotado al WHERE de esta
    // consulta: una venta soft-deleteada no puede nacer por API, así que el
    // e2e no la puede probar — esta es la única red para el mutante
    // "dropear el filtro" (task-6-mutantes.md, mutante #5).
    expect(ventasSql).toMatch(/WHERE[\s\S]*?v\.eliminado_el IS NULL/);
  });

  it('el cobrado lee pago_aplicaciones con tipo = venta, no pagos.monto (que trae el vuelto)', async () => {
    mockRespuestas({});

    await service.hoy(TENANT);

    const [cobradoSql] = queryMock.mock.calls[2] as [string];
    expect(cobradoSql).toMatch(/SUM\(pa\.monto\)/);
    expect(cobradoSql).toMatch(/pa\.tipo\s*=\s*'venta'/);
    expect(cobradoSql).not.toMatch(/SUM\(p\.monto\)/);
  });

  it('el SQL de cobrado filtra pagos y pago_aplicaciones no eliminados', async () => {
    mockRespuestas({});

    await service.hoy(TENANT);

    const [cobradoSql] = queryMock.mock.calls[2] as [string];
    // `pa.eliminado_el IS NULL` vive en el ON del JOIN, no en el WHERE —se
    // acota a esa condición para no ser un `toMatch` suelto.
    expect(cobradoSql).toMatch(
      /ON pa\.pago_id = p\.pago_id[\s\S]*?pa\.eliminado_el IS NULL/,
    );
    // `p.eliminado_el IS NULL` sí vive en el WHERE de esta consulta.
    expect(cobradoSql).toMatch(/WHERE[\s\S]*?p\.eliminado_el IS NULL/);
  });

  it('porCanal mapea vendido_fisico_hoy y vendido_online_hoy sin cruzarlos', async () => {
    // Valores distintos y discriminadores: si el mapeo cruzara fisico↔online,
    // esta aserción los detecta — con los dos iguales, un swap pasaría igual.
    mockRespuestas({
      ventas: {
        vendido_fisico_hoy: '70000.0000',
        vendido_online_hoy: '15000.0000',
      },
    });

    const res = await service.hoy(TENANT);

    expect(res.ventas.porCanal.fisico).toBe('70000.0000');
    expect(res.ventas.porCanal.online).toBe('15000.0000');
  });

  it('el SQL de ventas filtra por canal en FILTER (WHERE …), afirmando sobre la cláusula', async () => {
    mockRespuestas({});

    await service.hoy(TENANT);

    const [ventasSql] = queryMock.mock.calls[1] as [string];
    // El rango de fecha adentro del FILTER trae sus propios paréntesis
    // (`bordeFechaSql`/`bordeHastaSql`), así que la cláusula NO se puede
    // acotar con `[^)]*` — hay que dejar pasar cualquier carácter hasta
    // encontrar la condición de canal.
    expect(ventasSql).toMatch(
      /FILTER\s*\(WHERE[\s\S]*?v\.canal\s*=\s*'fisico'/,
    );
    expect(ventasSql).toMatch(
      /FILTER\s*\(WHERE[\s\S]*?v\.canal\s*=\s*'online'/,
    );
  });

  it('el SQL de por cobrar filtra v.eliminado_el IS NULL', async () => {
    mockRespuestas({});

    await service.hoy(TENANT);

    // Llamada #4: zona(0), ventas(1), cobrado(2), porCobrar(3).
    const [porCobrarSql] = queryMock.mock.calls[3] as [string];
    // Esta consulta tiene DOS WHERE (el del subselect de pagos aplicados y
    // el de la `ventas v` externa): el regex no-greedy encuentra el primer
    // WHERE y busca hacia adelante la cláusula de la venta externa, que es
    // la que importa acá.
    expect(porCobrarSql).toMatch(/WHERE[\s\S]*?v\.eliminado_el IS NULL/);
  });

  it('la zona se resuelve una sola vez: 22:00 de Chile sigue siendo hoy, y el rango de la semana pasada sale de la fecha pura', async () => {
    // 2026-09-19T01:00:00Z es 2026-09-18 ~22:00 en Chile (UTC-3/UTC-4 según
    // horario de verano): el calendario UTC ya cruzó al 19, el de Chile no.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-19T01:00:00Z'));
    mockRespuestas({ zona: 'America/Santiago' });

    const res = await service.hoy(TENANT);

    expect(res.fecha).toBe('2026-09-18');
    // Una sola consulta de zona: el mock encadenó las 5 respuestas de
    // `Db.query` (zona, ventas, cobrado, por cobrar, más vendidos) y las 5 se
    // consumieron — si el service volviera a pedirla (por ejemplo llamando a
    // `fechaLocalTenant` ADEMÁS de `zonaHorariaTenant`), sobrarían llamadas
    // sin respuesta mockeada y el service fallaría con datos `undefined`
    // antes de llegar acá.
    expect(queryMock).toHaveBeenCalledTimes(5);
    const [, ventasParams] = queryMock.mock.calls[1] as [string, unknown[]];
    expect(ventasParams).toEqual([
      TENANT,
      '2026-09-18',
      'America/Santiago',
      '2026-09-11',
      0, // hora_corte, IDX_DIA.corte = 5
    ]);
  });

  // Task 2 (spec 2026-09-18-dashboard-inicio § 4.4/§ 5.1): perdidas + masVendidos.
  describe('perdidas y masVendidos', () => {
    it('pasa { desde: fecha, hasta: fecha } al resumen de anulaciones y devuelve su porTipo tal cual', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-18T15:00:00Z'));
      const porTipoFixture: ResumenAnulaciones['porTipo'] = [
        {
          tipo: TipoMotivoBaja.CORTESIA,
          platos: '2.0000',
          precioCarta: '5000.0000',
          costo: [{ monedaId: 'clp-uuid', monto: '1200.0000' }],
          sinValorizar: 0,
        },
      ];
      mockRespuestas({
        zona: 'America/Santiago',
        anulaciones: { ...RESUMEN_ANULACIONES_VACIO, porTipo: porTipoFixture },
      });

      const res = await service.hoy(TENANT);

      expect(anulacionesResumenMock).toHaveBeenCalledWith(TENANT, {
        desde: '2026-09-18',
        hasta: '2026-09-18',
      });
      // Tal cual: ni se reordena ni se le agrega/quita nada.
      expect(res.perdidas.anulaciones).toBe(porTipoFixture);
    });

    it('pasa (tenantId, fecha, fecha) a MermasService.resumen y devuelve su resultado tal cual en perdidas.mermas', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-18T15:00:00Z'));
      const mermasFixture: ResumenMermas = {
        cantidad: 4,
        costo: [{ monedaId: 'clp-uuid', monto: '900.0000' }],
        sinValorizar: 1,
      };
      mockRespuestas({ zona: 'America/Santiago', mermas: mermasFixture });

      const res = await service.hoy(TENANT);

      expect(mermasResumenMock).toHaveBeenCalledWith(
        TENANT,
        '2026-09-18',
        '2026-09-18',
      );
      expect(res.perdidas.mermas).toBe(mermasFixture);
    });

    it('masVendidos mapea snake_case → camelCase, hasta las filas que la consulta devuelva (tope 5 lo pone el SQL)', async () => {
      mockRespuestas({
        masVendidos: [
          {
            item_id: 'item-1',
            item_nombre: 'Lomo a lo pobre',
            cantidad: '3.0000',
            monto: '29997000.0000',
          },
          {
            item_id: 'item-2',
            item_nombre: 'Papas fritas',
            cantidad: '10.0000',
            monto: '35000.0000',
          },
        ],
      });

      const res = await service.hoy(TENANT);

      expect(res.masVendidos).toEqual([
        {
          itemId: 'item-1',
          itemNombre: 'Lomo a lo pobre',
          cantidad: '3.0000',
          monto: '29997000.0000',
        },
        {
          itemId: 'item-2',
          itemNombre: 'Papas fritas',
          cantidad: '10.0000',
          monto: '35000.0000',
        },
      ]);
    });

    it('sin ventas hoy, masVendidos es []', async () => {
      mockRespuestas({});

      const res = await service.hoy(TENANT);

      expect(res.masVendidos).toEqual([]);
    });

    it('la consulta de más vendidos excluye canceladas y notas de crédito, y filtra venta_detalles.eliminado_el, afirmando sobre la cláusula', async () => {
      mockRespuestas({});

      await service.hoy(TENANT);

      // Orden de `Db.query`: zona(0), ventas(1), cobrado(2), porCobrar(3),
      // masVendidos(4).
      const [masVendidosSql] = queryMock.mock.calls[4] as [string];
      expect(masVendidosSql).toMatch(/FROM venta_detalles vd/);
      expect(masVendidosSql).toMatch(/v\.estado\s*<>\s*'cancelada'/);
      expect(masVendidosSql).toMatch(
        /COALESCE\(td\.es_nota_credito,\s*false\)\s*=\s*false/,
      );
      expect(masVendidosSql).toMatch(/vd\.eliminado_el IS NULL/);
      // `v\.eliminado_el` (la venta), no solo `vd\.eliminado_el` (el
      // detalle): son dos filas de soft-delete independientes.
      expect(masVendidosSql).toMatch(/WHERE[\s\S]*?v\.eliminado_el IS NULL/);
      expect(masVendidosSql).toMatch(/GROUP BY vd\.item_id/);
      expect(masVendidosSql).toMatch(/LIMIT 5/);
    });

    it('la consulta de más vendidos ordena por el SUM numérico, no por el alias de texto (evita el orden lexicográfico)', async () => {
      mockRespuestas({});

      await service.hoy(TENANT);

      const [masVendidosSql] = queryMock.mock.calls[4] as [string];
      expect(masVendidosSql).toMatch(
        /ORDER BY SUM\(vd\.total_linea\) DESC, vd\.item_id/,
      );
    });

    // Regresión de `QueryFailedError 42P18: could not determine data type of
    // parameter $4` (medido 2026-09-19): la consulta de más vendidos pasaba
    // el `params` COMPARTIDO con ventas/cobrado (5 elementos, con
    // `fechaSemanaPasada` en $4), pero su SQL nunca menciona `fechaSemanaPasada`
    // — solo necesita el rango de HOY. Postgres infiere el tipo de cada
    // parámetro por dónde se USA en el texto; uno que no aparece en ningún
    // lado no tiene de dónde inferirlo y tira 42P18 en tiempo de ejecución.
    // Ningún mock de `Db.query` (acá o en cualquier test unitario) ve ese
    // error — la aserción vive en `db.spec-helper.ts` (`assertSinHuecos`,
    // ítem 3 de `2026-09-19-residuos-hora-de-corte`, fix round 1: extraída
    // de acá y otras tres copias).
    it('la consulta de más vendidos: cada $n del SQL tiene param, y cada param está referenciado (evita 42P18)', async () => {
      mockRespuestas({});

      await service.hoy(TENANT);

      const [masVendidosSql, masVendidosParams] = queryMock.mock.calls[4] as [
        string,
        unknown[],
      ];
      assertSinHuecos(masVendidosSql, masVendidosParams);
    });
  });
});
