import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { CronRunnerService } from '../cron-runner.service';
import { ExpirarOrdenesJob, JOB_EXPIRAR_ORDENES } from './expirar-ordenes.job';

describe('ExpirarOrdenesJob', () => {
  let job: ExpirarOrdenesJob;
  const queryMock = jest.fn();
  const runnerMock = {
    ejecutar: jest.fn((_job: string, fn: () => Promise<string>) => fn()),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    queryMock.mockResolvedValue([[], 0]); // pg: UPDATE devuelve [rows, rowCount]
    const module = await Test.createTestingModule({
      providers: [
        ExpirarOrdenesJob,
        { provide: CronRunnerService, useValue: runnerMock },
        { provide: getDataSourceToken(), useValue: { query: queryMock } },
      ],
    }).compile();
    job = module.get(ExpirarOrdenesJob);
  });

  it('el tick delega al runner con el nombre estable del job', async () => {
    await job.tick();
    expect(runnerMock.ejecutar).toHaveBeenCalledWith(
      JOB_EXPIRAR_ORDENES,
      expect.any(Function),
    );
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('reporta la cantidad de órdenes expiradas', async () => {
    queryMock.mockResolvedValue([[], 3]);
    await expect(job.expirarOrdenesVencidas()).resolves.toBe(
      '3 órdenes expiradas',
    );
  });

  it('la consulta aplica las reglas de elegibilidad', async () => {
    await job.expirarOrdenesVencidas();
    const sql = (queryMock.mock.calls[0][0] as string).replace(/\s+/g, ' ');
    expect(sql).toContain("estado IN ('creada', 'en_proceso')");
    expect(sql).toContain('fecha_expiracion < now()');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain("tipo = 'AUTHORIZATION'");
    expect(sql).toContain("SET estado = 'expirada'");
    expect(sql).toContain('eliminado_el IS NULL');
  });

  it('onApplicationBootstrap dispara un tick inicial', async () => {
    await job.onApplicationBootstrap();
    expect(runnerMock.ejecutar).toHaveBeenCalledWith(
      JOB_EXPIRAR_ORDENES,
      expect.any(Function),
    );
  });
});
