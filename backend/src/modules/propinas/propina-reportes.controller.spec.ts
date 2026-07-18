import type { Request } from 'express';
import { PropinaReportesController } from './propina-reportes.controller';
import { type PropinaReportesService } from './propina-reportes.service';

describe('PropinaReportesController', () => {
  const tenantId = '550e8400-e29b-41d4-a716-446655440001';
  const filtros = { desde: '2026-07-01', hasta: '2026-08-01' };
  const request = { user: { tenantId } } as unknown as Request;
  const reportes = {
    resumen: jest.fn(),
    trabajadores: jest.fn(),
  };
  const controller = new PropinaReportesController(
    reportes as unknown as PropinaReportesService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('obtiene resumen con tenant del JWT', async () => {
    reportes.resumen.mockResolvedValue({ periodo: filtros });

    await controller.resumen(request, filtros);

    expect(reportes.resumen).toHaveBeenCalledWith(tenantId, filtros);
  });

  it('obtiene trabajadores con tenant del JWT', async () => {
    reportes.trabajadores.mockResolvedValue({ data: [] });

    await controller.trabajadores(request, filtros);

    expect(reportes.trabajadores).toHaveBeenCalledWith(tenantId, filtros);
  });
});
