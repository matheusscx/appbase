import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Db } from '../../common/db/db.service';
import { AnulacionesReporteService } from './anulaciones-reporte.service';
import { TipoMotivoBaja } from '../motivos-baja/tipo-motivo-baja.enum';

const TENANT = 'tenant-uuid';

/**
 * `resumen()` exige `desde`/`hasta` (ronda de fix 1). Con hora (`esFechaPura`
 * da `false`) para que `requiereZonaTenant` no dispare la consulta de zona y
 * los tests de agrupación sigan mockeando solo las dos consultas que
 * `resumen()` hace de por sí.
 */
const RANGO = {
  desde: '2026-09-01T00:00:00.000Z',
  hasta: '2026-09-01T00:00:00.000Z',
};

/**
 * Fila cruda de `cuenta_linea_anulaciones` + sus JOINs (molde:
 * `mermas.service.spec.ts`, mock de `Db.query` por orden de llamada).
 */
const anulacionRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'anulacion-1',
  creado_el: new Date('2026-09-18T12:00:00Z'),
  cuenta_id: 'cuenta-1',
  cuenta_numero: 42,
  mesa_nombre: 'Mesa 3',
  salon_nombre: 'Salón principal',
  item_nombre: 'Lomo a lo pobre',
  cantidad: '2.0000',
  precio_unitario: '12900.0000',
  motivo_baja_nombre: 'Cortesía de la casa',
  tipo: TipoMotivoBaja.CORTESIA,
  garzon_nombre: 'Ana Torres',
  autorizado_por_nombre: 'Encargado',
  ...overrides,
});

describe('AnulacionesReporteService', () => {
  let service: AnulacionesReporteService;
  let dbQueryMock: jest.Mock;

  beforeEach(async () => {
    dbQueryMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnulacionesReporteService,
        {
          provide: Db,
          useValue: {
            query: dbQueryMock,
            transaccion: jest.fn((cb: (manager: unknown) => unknown) => cb({})),
            sinTransaccion: (fn: () => unknown) => fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AnulacionesReporteService);
  });

  describe('findAll — mapeo de plata y estados del costo', () => {
    it('mapea una cortesía de cantidad 2 y precio_unitario 12900.0000 a precioCarta 25800.0000', async () => {
      dbQueryMock
        .mockResolvedValueOnce([{ total: 1 }]) // COUNT
        .mockResolvedValueOnce([anulacionRow()]) // página
        .mockResolvedValueOnce([]); // costo (sin movimientos: valorizado con costo [])

      const res = await service.findAll(TENANT, {});

      expect(res.data[0]).toMatchObject({
        id: 'anulacion-1',
        cantidad: '2.0000',
        precioCarta: '25800.0000',
      });
    });

    it('costo valorizado con dos monedas devuelve una lista de dos', async () => {
      dbQueryMock
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([anulacionRow()])
        .mockResolvedValueOnce([
          {
            cuenta_linea_anulacion_id: 'anulacion-1',
            moneda_id: 'clp-uuid',
            monto: '4300.0000',
            falta_costo: false,
          },
          {
            cuenta_linea_anulacion_id: 'anulacion-1',
            moneda_id: 'usd-uuid',
            monto: '3.5000',
            falta_costo: false,
          },
        ]);

      const res = await service.findAll(TENANT, {});

      expect(res.data[0].costoEstado).toBe('valorizado');
      expect(res.data[0].costo).toEqual([
        { monedaId: 'clp-uuid', monto: '4300.0000' },
        { monedaId: 'usd-uuid', monto: '3.5000' },
      ]);
    });

    it('no_elaborado: costoEstado no_aplica, costo [], y NO entra al ANY($2) de la consulta de costo', async () => {
      dbQueryMock.mockResolvedValueOnce([{ total: 1 }]).mockResolvedValueOnce([
        anulacionRow({
          tipo: TipoMotivoBaja.NO_ELABORADO,
          motivo_baja_nombre: 'No se hizo',
        }),
      ]);
      // Sin tercer mockResolvedValueOnce: si el service igual pidiera el
      // costo, `dbQueryMock` devolvería `undefined` y el test fallaría al
      // iterar `rows` de esa respuesta — lo cual es la prueba de que NO se
      // llamó una tercera vez.

      const res = await service.findAll(TENANT, {});

      expect(res.data[0]).toMatchObject({
        costoEstado: 'no_aplica',
        costo: [],
      });
      expect(dbQueryMock).toHaveBeenCalledTimes(2);
      const costoCall = dbQueryMock.mock.calls.find(([sql]) =>
        (sql as string).includes('movimientos_inventario'),
      );
      expect(costoCall).toBeUndefined();
    });

    it('un grupo con falta_costo: sin_valorizar y costo [] (no una cifra parcial)', async () => {
      dbQueryMock
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([anulacionRow({ tipo: TipoMotivoBaja.MERMA })])
        .mockResolvedValueOnce([
          {
            cuenta_linea_anulacion_id: 'anulacion-1',
            moneda_id: 'clp-uuid',
            monto: '1000.0000',
            falta_costo: false,
          },
          {
            cuenta_linea_anulacion_id: 'anulacion-1',
            moneda_id: 'clp-uuid',
            // `falta_costo=true`: al menos un movimiento del grupo no tiene
            // costo_unitario. El `monto` que igual trae la fila (una suma
            // parcial de Postgres) NO tiene que llegar al mapeo.
            monto: '500.0000',
            falta_costo: true,
          },
        ]);

      const res = await service.findAll(TENANT, {});

      expect(res.data[0].costoEstado).toBe('sin_valorizar');
      expect(res.data[0].costo).toEqual([]);
    });

    it('garzon_nombre null mapea a garzonNombre null', async () => {
      dbQueryMock
        .mockResolvedValueOnce([{ total: 1 }])
        .mockResolvedValueOnce([anulacionRow({ garzon_nombre: null })])
        .mockResolvedValueOnce([]);

      const res = await service.findAll(TENANT, {});

      expect(res.data[0].garzonNombre).toBeNull();
    });
  });

  describe('findAll — filtros', () => {
    it('tipo, garzonId, motivoBajaId y desde (fecha pura) llegan como parámetros de la cláusula', async () => {
      dbQueryMock
        .mockResolvedValueOnce([
          { zona_horaria: 'America/Santiago', hora_corte: 0 },
        ]) // diaNegocioTenant
        .mockResolvedValueOnce([{ total: 0 }]) // COUNT
        .mockResolvedValueOnce([]); // página (sin filas → sin consulta de costo)

      await service.findAll(TENANT, {
        tipo: TipoMotivoBaja.CORTESIA,
        garzonId: 'garzon-uuid',
        motivoBajaId: 'motivo-uuid',
        desde: '2026-09-01',
      });

      // Llamada 0: diaNegocioTenant. Llamada 1: el COUNT con el WHERE armado
      // por `buildFilters` — se afirma sobre la cláusula exacta (no un
      // `toContain` suelto que matchee un comentario del SQL).
      const [countSql, countParams] = dbQueryMock.mock.calls[1] as [
        string,
        unknown[],
      ];
      expect(countSql).toContain('AND mb.tipo = $4');
      expect(countSql).toContain('AND cla.garzon_id = $5');
      expect(countSql).toContain('AND cla.motivo_baja_id = $6');
      expect(countSql).toContain(
        'AND cla.creado_el >= ((($7::date)::timestamp + make_interval(hours => $3::int)) AT TIME ZONE $2)',
      );
      expect(countParams).toEqual([
        TENANT,
        'America/Santiago',
        0, // hora_corte
        TipoMotivoBaja.CORTESIA,
        'garzon-uuid',
        'motivo-uuid',
        '2026-09-01',
      ]);

      // La página comparte la misma cláusula de filtros.
      const [pageSql, pageParams] = dbQueryMock.mock.calls[2] as [
        string,
        unknown[],
      ];
      expect(pageSql).toContain('AND mb.tipo = $4');
      expect(pageParams.slice(0, 7)).toEqual(countParams);
    });
  });

  describe('resumen — agrupado, sin paginar', () => {
    /**
     * Fila cruda de la consulta base del resumen (sin `LIMIT`/`OFFSET`, todo
     * el rango). Valores que discriminan: cantidad ≠ 1 y precio ≠ costo, así
     * un mutante que sume el campo equivocado da otro número.
     */
    const filaResumen = (overrides: Record<string, unknown> = {}) => ({
      id: 'anulacion-1',
      cantidad: '2.0000',
      precio_unitario: '1000.0000',
      tipo: TipoMotivoBaja.MERMA,
      garzon_id: 'garzon-1',
      garzon_nombre: 'Garzón Uno',
      usuario_id: 'usuario-1',
      usuario_nombre: 'Encargado',
      ...overrides,
    });

    it('un grupo con una fila valorizada y una sin valorizar: costo solo de la valorizada, sinValorizar 1, platos y precioCarta de las dos', async () => {
      dbQueryMock
        .mockResolvedValueOnce([
          filaResumen({
            id: 'a1',
            cantidad: '2.0000',
            precio_unitario: '1000.0000',
          }), // 2000.0000
          filaResumen({
            id: 'a2',
            cantidad: '3.0000',
            precio_unitario: '500.0000',
          }), // 1500.0000
        ])
        .mockResolvedValueOnce([
          {
            cuenta_linea_anulacion_id: 'a1',
            moneda_id: 'CLP',
            monto: '4300.0000',
            falta_costo: false,
          },
          {
            // `falta_costo=true`: la fila entera (a2) queda sin valorizar y
            // su `monto` parcial NO tiene que sumar al costo del grupo.
            cuenta_linea_anulacion_id: 'a2',
            moneda_id: 'CLP',
            monto: '900.0000',
            falta_costo: true,
          },
        ]);

      const res = await service.resumen(TENANT, RANGO);

      const grupoMerma = res.porTipo.find(
        (g) => g.tipo === TipoMotivoBaja.MERMA,
      )!;
      expect(grupoMerma).toBeDefined();
      expect(grupoMerma.platos).toBe('5.0000'); // 2 + 3
      expect(grupoMerma.precioCarta).toBe('3500.0000'); // 2000 + 1500
      expect(grupoMerma.costo).toEqual([
        { monedaId: 'CLP', monto: '4300.0000' },
      ]);
      expect(grupoMerma.sinValorizar).toBe(1);
    });

    it('costo de dos monedas en un mismo garzón: dos entradas en la lista de costo', async () => {
      dbQueryMock
        .mockResolvedValueOnce([
          filaResumen({
            id: 'a3',
            tipo: TipoMotivoBaja.CORTESIA,
            cantidad: '1.5000',
            precio_unitario: '2000.0000',
            garzon_id: 'garzon-2',
            garzon_nombre: 'Garzón Dos',
          }), // 3000.0000
          filaResumen({
            id: 'a4',
            tipo: TipoMotivoBaja.CORTESIA,
            cantidad: '4.0000',
            precio_unitario: '750.0000',
            garzon_id: 'garzon-2',
            garzon_nombre: 'Garzón Dos',
          }), // 3000.0000
        ])
        .mockResolvedValueOnce([
          {
            cuenta_linea_anulacion_id: 'a3',
            moneda_id: 'CLP',
            monto: '3000.0000',
            falta_costo: false,
          },
          {
            cuenta_linea_anulacion_id: 'a4',
            moneda_id: 'USD',
            monto: '12.0000',
            falta_costo: false,
          },
        ]);

      const res = await service.resumen(TENANT, RANGO);

      const grupoGarzon2 = res.porGarzon.find(
        (g) => g.garzonId === 'garzon-2',
      )!;
      expect(grupoGarzon2).toBeDefined();
      expect(grupoGarzon2.platos).toBe('5.5000'); // 1.5 + 4
      expect(grupoGarzon2.precioCarta).toBe('6000.0000'); // 3000 + 3000
      expect(grupoGarzon2.costo).toEqual([
        { monedaId: 'CLP', monto: '3000.0000' },
        { monedaId: 'USD', monto: '12.0000' },
      ]);
      expect(grupoGarzon2.sinValorizar).toBe(0);
    });

    it('garzonId null es un grupo propio, separado de las filas con garzón', async () => {
      dbQueryMock
        .mockResolvedValueOnce([
          filaResumen({
            id: 'a5',
            cantidad: '1.0000',
            precio_unitario: '900.0000',
            garzon_id: null,
            garzon_nombre: null,
          }),
          filaResumen({
            id: 'a6',
            cantidad: '1.0000',
            precio_unitario: '900.0000',
            garzon_id: 'garzon-1',
            garzon_nombre: 'Garzón Uno',
          }),
        ])
        // Sin movimientos para ninguna de las dos (hueco conocido, spec § 4):
        // valorizado con costo [], no sin_valorizar.
        .mockResolvedValueOnce([]);

      const res = await service.resumen(TENANT, RANGO);

      const grupoSinGarzon = res.porGarzon.find((g) => g.garzonId === null)!;
      expect(grupoSinGarzon).toBeDefined();
      expect(grupoSinGarzon.garzonNombre).toBeNull();
      expect(grupoSinGarzon.platos).toBe('1.0000');
      expect(grupoSinGarzon.costo).toEqual([]);
      expect(grupoSinGarzon.sinValorizar).toBe(0);

      const grupoConGarzon = res.porGarzon.find(
        (g) => g.garzonId === 'garzon-1',
      )!;
      expect(grupoConGarzon).toBeDefined();
      expect(grupoConGarzon.platos).toBe('1.0000');

      // Dos grupos distintos, no uno solo.
      expect(res.porGarzon).toHaveLength(2);
    });

    it('no_elaborado no entra al `ANY($2)` de la consulta de costo', async () => {
      dbQueryMock.mockResolvedValueOnce([
        filaResumen({
          id: 'a7',
          tipo: TipoMotivoBaja.NO_ELABORADO,
          cantidad: '1.0000',
          precio_unitario: '4200.0000',
        }),
      ]);
      // Sin segundo mockResolvedValueOnce: si el service igual pidiera el
      // costo, fallaría al leer una respuesta `undefined`.

      const res = await service.resumen(TENANT, RANGO);

      const grupo = res.porTipo.find(
        (g) => g.tipo === TipoMotivoBaja.NO_ELABORADO,
      )!;
      expect(grupo.costo).toEqual([]);
      expect(grupo.sinValorizar).toBe(0);
      expect(dbQueryMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('resumen — validación del rango (ronda de fix 1)', () => {
    it('rango de 367 días: 400, sin llegar a consultar la base', async () => {
      const desde = '2026-01-01T00:00:00.000Z';
      // 367 días después: uno más que el tope de 366.
      const hasta = new Date(
        Date.parse(desde) + 367 * 24 * 60 * 60 * 1000,
      ).toISOString();

      await expect(service.resumen(TENANT, { desde, hasta })).rejects.toThrow(
        BadRequestException,
      );
      expect(dbQueryMock).not.toHaveBeenCalled();
    });

    it('hasta anterior a desde: 400, sin llegar a consultar la base', async () => {
      await expect(
        service.resumen(TENANT, {
          desde: '2026-09-10T00:00:00.000Z',
          hasta: '2026-09-09T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(dbQueryMock).not.toHaveBeenCalled();
    });

    it('desde === hasta (mismo día): válido, no tira — a diferencia de propinas, acá `hasta` es inclusivo', async () => {
      dbQueryMock.mockResolvedValueOnce([]); // sin filas en el rango

      await expect(service.resumen(TENANT, RANGO)).resolves.toEqual({
        porTipo: [],
        porGarzon: [],
        porAutorizo: [],
      });
    });

    it('un rango de exactamente 366 días es válido (el borde del tope, no lo pasa)', async () => {
      const desde = '2026-01-01T00:00:00.000Z';
      const hasta = new Date(
        Date.parse(desde) + 366 * 24 * 60 * 60 * 1000,
      ).toISOString();
      dbQueryMock.mockResolvedValueOnce([]);

      await expect(service.resumen(TENANT, { desde, hasta })).resolves.toEqual({
        porTipo: [],
        porGarzon: [],
        porAutorizo: [],
      });
    });
  });
});
