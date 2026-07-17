import { DataSource } from 'typeorm';
import { TipoGarzon } from '../garzones/enums/tipo-garzon.enum';
import { PropinaReportesService } from './propina-reportes.service';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440001';
const TURNO_ID = '550e8400-e29b-41d4-a716-446655440002';
const QUERY = { desde: '2026-07-01', hasta: '2026-08-01' };

describe('PropinaReportesService', () => {
  let query: jest.Mock;
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
      .mockResolvedValueOnce([
        { liquidaciones: '0', monto_liberado: '0' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ cantidad: '0' }]);
  }

  describe('resumen', () => {
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
        query.mock.calls.some(([, params]) => params?.includes(TURNO_ID)),
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
});
