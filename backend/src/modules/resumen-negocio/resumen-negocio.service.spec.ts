import { Test, type TestingModule } from '@nestjs/testing';
import { Db } from '../../common/db/db.service';
import { ResumenNegocioService } from './resumen-negocio.service';

const TENANT = 'tenant-uuid';

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

describe('ResumenNegocioService', () => {
  let service: ResumenNegocioService;
  let queryMock: jest.Mock;

  beforeEach(async () => {
    queryMock = jest.fn();
    const dbMock = {
      query: queryMock,
      transaccion: jest.fn((cb: (manager: unknown) => unknown) => cb({})),
      sinTransaccion: (fn: () => unknown) => fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ResumenNegocioService, { provide: Db, useValue: dbMock }],
    }).compile();

    service = module.get(ResumenNegocioService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /**
   * Encadena las 4 respuestas de `Db.query`, EN ORDEN: zona, ventas, cobrado,
   * por cobrar — el mismo orden en que `ResumenNegocioService.hoy` las pide.
   * Cada bloque parte de un fixture "todo cero" para que un test solo declare
   * lo que le importa.
   */
  function mockRespuestas(opts: {
    zona?: string;
    ventas?: Partial<VentasRowFixture>;
    cobrado?: Partial<CobradoRowFixture>;
    porCobrar?: Partial<PorCobrarRowFixture>;
  }): void {
    queryMock
      .mockResolvedValueOnce([
        { zona_horaria: opts.zona ?? 'America/Santiago' },
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
      .mockResolvedValueOnce([{ cantidad: 0, saldo: '0', ...opts.porCobrar }]);
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
  });

  it('el cobrado lee pago_aplicaciones con tipo = venta, no pagos.monto (que trae el vuelto)', async () => {
    mockRespuestas({});

    await service.hoy(TENANT);

    const [cobradoSql] = queryMock.mock.calls[2] as [string];
    expect(cobradoSql).toMatch(/SUM\(pa\.monto\)/);
    expect(cobradoSql).toMatch(/pa\.tipo\s*=\s*'venta'/);
    expect(cobradoSql).not.toMatch(/SUM\(p\.monto\)/);
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

  it('la zona se resuelve una sola vez: 22:00 de Chile sigue siendo hoy, y el rango de la semana pasada sale de la fecha pura', async () => {
    // 2026-09-19T01:00:00Z es 2026-09-18 ~22:00 en Chile (UTC-3/UTC-4 según
    // horario de verano): el calendario UTC ya cruzó al 19, el de Chile no.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-19T01:00:00Z'));
    mockRespuestas({ zona: 'America/Santiago' });

    const res = await service.hoy(TENANT);

    expect(res.fecha).toBe('2026-09-18');
    // Una sola consulta de zona: el mock encadenó 4 respuestas y las 4 se
    // consumieron — si el service volviera a pedirla (por ejemplo llamando a
    // `fechaLocalTenant` ADEMÁS de `zonaHorariaTenant`), sobrarían llamadas
    // sin respuesta mockeada y el service fallaría con datos `undefined`
    // antes de llegar acá.
    expect(queryMock).toHaveBeenCalledTimes(4);
    const [, ventasParams] = queryMock.mock.calls[1] as [string, unknown[]];
    expect(ventasParams).toEqual([
      TENANT,
      '2026-09-18',
      'America/Santiago',
      '2026-09-11',
    ]);
  });
});
