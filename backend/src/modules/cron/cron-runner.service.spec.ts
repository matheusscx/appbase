import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CronEjecucion } from './entities/cron-ejecucion.entity';
import { CronRunnerService } from './cron-runner.service';

describe('CronRunnerService', () => {
  let service: CronRunnerService;
  const saveMock = jest.fn();
  const repoMock = {
    create: jest.fn((x: Partial<CronEjecucion>) => x as CronEjecucion),
    save: saveMock,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    saveMock.mockImplementation(async (e: CronEjecucion) => e);
    const module = await Test.createTestingModule({
      providers: [
        CronRunnerService,
        { provide: getRepositoryToken(CronEjecucion), useValue: repoMock },
      ],
    }).compile();
    service = module.get(CronRunnerService);
  });

  it('registra la ejecución exitosa con detalle', async () => {
    await service.ejecutar('demo', async () => '3 órdenes expiradas');

    expect(repoMock.create).toHaveBeenCalledWith(
      expect.objectContaining({ job: 'demo', estado: 'en_curso' }),
    );
    const final = saveMock.mock.calls.at(-1)![0] as CronEjecucion;
    expect(final.estado).toBe('ok');
    expect(final.detalle).toBe('3 órdenes expiradas');
    expect(final.finalizadoEl).toBeInstanceOf(Date);
  });

  it('registra el error sin propagar la excepción', async () => {
    await expect(
      service.ejecutar('demo', async () => {
        throw new Error('boom');
      }),
    ).resolves.toBeUndefined();

    const final = saveMock.mock.calls.at(-1)![0] as CronEjecucion;
    expect(final.estado).toBe('error');
    expect(final.error).toBe('boom');
    expect(final.finalizadoEl).toBeInstanceOf(Date);
  });

  it('omite el tick si el mismo job sigue en curso', async () => {
    let release!: () => void;
    const bloqueado = new Promise<string>((res) => {
      release = () => res('primera terminó');
    });

    const primera = service.ejecutar('demo', () => bloqueado);
    await service.ejecutar('demo', async () => 'segunda'); // debe omitirse

    expect(saveMock).toHaveBeenCalledTimes(1); // solo el insert de la primera

    release();
    await primera;
    expect(saveMock).toHaveBeenCalledTimes(2); // insert + cierre de la primera
  });

  it('libera el lock al terminar y permite una nueva ejecución', async () => {
    await service.ejecutar('demo', async () => 'a');
    await service.ejecutar('demo', async () => 'b');
    expect(saveMock).toHaveBeenCalledTimes(4); // 2 ejecuciones × (insert + cierre)
  });

  it('no propaga si falla la persistencia del registro', async () => {
    saveMock.mockRejectedValueOnce(new Error('db caída'));
    await expect(service.ejecutar('demo', async () => 'a')).resolves.toBeUndefined();
    // el lock quedó liberado: una nueva ejecución vuelve a intentar
    await service.ejecutar('demo', async () => 'b');
    expect(repoMock.create).toHaveBeenCalledTimes(2);
  });
});
