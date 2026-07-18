import { type DataSource } from 'typeorm';
import { TipoGarzon } from '../garzones/enums/tipo-garzon.enum';
import { PropinaReportesService } from './propina-reportes.service';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440001';
const TURNO_ID = '550e8400-e29b-41d4-a716-446655440002';
const QUERY = { desde: '2026-07-01', hasta: '2026-08-01' };

describe('PropinaReportesService', () => {
  let query: jest.MockedFunction<
    (sql: string, params?: unknown[]) => Promise<unknown>
  >;
  let service: PropinaReportesService;

  beforeEach(() => {
    query = jest.fn();
    service = new PropinaReportesService({ query } as unknown as DataSource);
  });

  function prepararResumenVacio() {
    query
      .mockResolvedValueOnce([{ zona_horaria: 'America/Santiago' }])
      .mockResolvedValueOnce([
        {
          cierres: '0',
          con_propina: '0',
          sin_propina: '0',
          sugerencia_aceptada: '0',
          monto_cobrado: '0',
          monto_sugerido: '0',
          promedio_con_propina: '0',
          tasa_con_propina: '0',
          tasa_sugerencia_aceptada: '0',
          pendiente_libre_cantidad: '0',
          pendiente_libre_monto: '0',
          en_borrador_cantidad: '0',
          en_borrador_monto: '0',
          liquidada_cantidad: '0',
          liquidada_monto: '0',
        },
      ])
      .mockResolvedValueOnce([{ liquidaciones: '0', monto_liberado: '0' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ cantidad: '0' }]);
  }

  describe('resumen', () => {
    it('rechaza tenant sin zona horaria resoluble', async () => {
      query.mockResolvedValueOnce([]);

      await expect(service.resumen(TENANT_ID, QUERY)).rejects.toThrow(
        'No se encontró la zona horaria del tenant',
      );
    });

    it('mapea ceros y pasa tenant a todas las consultas', async () => {
      prepararResumenVacio();

      const result = await service.resumen(TENANT_ID, QUERY);

      expect(result.cobranza.montoCobrado).toBe('0');
      expect(result.estadoActual.pendienteLibreCantidad).toBe(0);
      expect(result.periodo).toEqual(QUERY);
      expect(
        query.mock.calls.every(([, params]) => params?.[0] === TENANT_ID),
      ).toBe(true);
    });

    it('parametriza turnos y tipo sin interpolarlos en SQL', async () => {
      prepararResumenVacio();

      await service.resumen(TENANT_ID, {
        ...QUERY,
        turnoIds: [TURNO_ID],
        tipoGarzon: TipoGarzon.GARZON,
      });

      expect(
        query.mock.calls.some(([, params]) =>
          params?.some(
            (param: unknown) =>
              Array.isArray(param) && param.includes(TURNO_ID),
          ),
        ),
      ).toBe(true);
      expect(
        query.mock.calls.some(([, params]) =>
          params?.includes(TipoGarzon.GARZON),
        ),
      ).toBe(true);
      expect(query.mock.calls.every(([sql]) => !sql.includes(TURNO_ID))).toBe(
        true,
      );
    });

    it('mapea tendencia, desgloses, anulaciones y advertencias', async () => {
      query
        .mockResolvedValueOnce([{ zona_horaria: 'America/Santiago' }])
        .mockResolvedValueOnce([
          {
            cierres: '2',
            con_propina: '1',
            sin_propina: '1',
            sugerencia_aceptada: '1',
            monto_cobrado: '5000.0000',
            monto_sugerido: '5000.0000',
            promedio_con_propina: '5000.0000',
            tasa_con_propina: '0.5',
            tasa_sugerencia_aceptada: '1',
            pendiente_libre_cantidad: '1',
            pendiente_libre_monto: '5000.0000',
            en_borrador_cantidad: '0',
            en_borrador_monto: '0',
            liquidada_cantidad: '0',
            liquidada_monto: '0',
          },
        ])
        .mockResolvedValueOnce([
          { liquidaciones: '1', monto_liberado: '4000.0000' },
        ])
        .mockResolvedValueOnce([
          {
            fecha: '2026-07-01',
            cierres: '2',
            con_propina: '1',
            monto_cobrado: '5000.0000',
          },
        ])
        .mockResolvedValueOnce([
          {
            turno_id: null,
            turno_nombre: null,
            cierres: '2',
            con_propina: '1',
            monto_cobrado: '5000.0000',
          },
        ])
        .mockResolvedValueOnce([
          {
            tipo_garzon: null,
            cierres: '2',
            con_propina: '1',
            monto_cobrado: '5000.0000',
          },
        ])
        .mockResolvedValueOnce([{ cantidad: '2' }]);

      const result = await service.resumen(TENANT_ID, QUERY);

      expect(result.anulaciones).toEqual({
        liquidaciones: 1,
        montoLiberadoHistorico: '4000.0000',
      });
      expect(result.tendencia[0].fecha).toBe('2026-07-01');
      expect(result.porTurno[0].turnoNombre).toBe('Sin turno');
      expect(result.porTipo[0].tipoGarzon).toBeNull();
      expect(result.advertencias.liquidacionesParcialmenteSolapadas).toBe(2);
    });
  });

  describe('trabajadores', () => {
    it('une originadores y participantes y calcula totales decimales', async () => {
      query
        .mockResolvedValueOnce([{ zona_horaria: 'America/Santiago' }])
        .mockResolvedValueOnce([
          {
            garzon_id: 'camila',
            tipo_garzon: TipoGarzon.GARZON,
            cierres: '30',
            con_propina: '25',
            monto: '220000.0000',
          },
        ])
        .mockResolvedValueOnce([
          {
            garzon_id: 'camila',
            tipo_garzon: TipoGarzon.GARZON,
            monto: '180000.0000',
            horas: '80.0000',
            ventas_base: '2200000.0000',
            cuentas: '34.0000',
            liquidaciones: '3',
            ultima_liquidacion_el: '2026-07-31T18:30:00.000Z',
          },
          {
            garzon_id: 'pedro',
            tipo_garzon: TipoGarzon.COCINA,
            monto: '120000.0000',
            horas: '60.0000',
            ventas_base: '0',
            cuentas: '0',
            liquidaciones: '3',
            ultima_liquidacion_el: '2026-07-31T18:30:00.000Z',
          },
        ])
        .mockResolvedValueOnce([{ cantidad: '0' }])
        .mockResolvedValueOnce([{ cantidad: '0' }])
        .mockResolvedValueOnce([
          {
            garzon_id: 'camila',
            nombre: 'Camila',
            tipo_garzon: TipoGarzon.GARZON,
          },
          {
            garzon_id: 'pedro',
            nombre: 'Pedro',
            tipo_garzon: TipoGarzon.COCINA,
          },
        ]);

      const result = await service.trabajadores(TENANT_ID, QUERY);

      expect(result.data.map((item) => item.nombre)).toEqual([
        'Camila',
        'Pedro',
      ]);
      expect(result.totales).toEqual({
        trabajadores: 2,
        montoOriginado: '220000',
        montoAsignado: '300000',
        horas: '140',
        ventasBase: '2200000',
        cuentas: '34',
      });
      expect(result.data[1].origen.monto).toBe('0');
    });

    it('ordena por monto asignado desc y luego nombre asc', async () => {
      query
        .mockResolvedValueOnce([{ zona_horaria: 'America/Santiago' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            garzon_id: 'pedro',
            tipo_garzon: TipoGarzon.GARZON,
            monto: '10',
            horas: '0',
            ventas_base: '0',
            cuentas: '0',
            liquidaciones: '1',
            ultima_liquidacion_el: null,
          },
          {
            garzon_id: 'ana',
            tipo_garzon: TipoGarzon.GARZON,
            monto: '20',
            horas: '0',
            ventas_base: '0',
            cuentas: '0',
            liquidaciones: '1',
            ultima_liquidacion_el: null,
          },
          {
            garzon_id: 'camila',
            tipo_garzon: TipoGarzon.GARZON,
            monto: '20',
            horas: '0',
            ventas_base: '0',
            cuentas: '0',
            liquidaciones: '1',
            ultima_liquidacion_el: null,
          },
        ])
        .mockResolvedValueOnce([{ cantidad: '0' }])
        .mockResolvedValueOnce([{ cantidad: '0' }])
        .mockResolvedValueOnce([
          { garzon_id: 'ana', nombre: 'Ana', tipo_garzon: 'garzon' },
          { garzon_id: 'camila', nombre: 'Camila', tipo_garzon: 'garzon' },
          { garzon_id: 'pedro', nombre: 'Pedro', tipo_garzon: 'garzon' },
        ]);

      const result = await service.trabajadores(TENANT_ID, QUERY);

      expect(result.data.map((item) => item.nombre)).toEqual([
        'Ana',
        'Camila',
        'Pedro',
      ]);
    });

    it('reporta liquidaciones de todos los turnos excluidas', async () => {
      query
        .mockResolvedValueOnce([{ zona_horaria: 'America/Santiago' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ cantidad: '1' }])
        .mockResolvedValueOnce([{ cantidad: '2' }])
        .mockResolvedValueOnce([]);

      const result = await service.trabajadores(TENANT_ID, {
        ...QUERY,
        turnoIds: [TURNO_ID],
      });

      expect(result.advertencias).toEqual({
        liquidacionesParcialmenteSolapadas: 1,
        liquidacionesTodosLosTurnosExcluidas: 2,
      });
    });

    it('parametriza tipo y turnos en la asignación confirmada', async () => {
      query
        .mockResolvedValueOnce([{ zona_horaria: 'America/Santiago' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ cantidad: '0' }])
        .mockResolvedValueOnce([{ cantidad: '0' }]);

      await service.trabajadores(TENANT_ID, {
        ...QUERY,
        turnoIds: [TURNO_ID],
        tipoGarzon: TipoGarzon.COCINA,
      });

      const assignmentCall = query.mock.calls.find(([sql]) =>
        sql.includes('liquidacion_propinas_participante p'),
      );
      expect(assignmentCall?.[0]).toContain('p.tipo_garzon');
      expect(assignmentCall?.[0]).toContain('l.turno_ids <@');
      expect(assignmentCall?.[1]).toContain(TipoGarzon.COCINA);
    });
  });
});
