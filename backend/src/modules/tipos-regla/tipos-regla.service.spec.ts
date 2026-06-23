import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TiposReglaService } from './tipos-regla.service';
import { TipoRegla } from './entities/tipo-regla.entity';

describe('TiposReglaService', () => {
  let service: TiposReglaService;
  let repo: { find: jest.Mock };

  beforeEach(async () => {
    repo = { find: jest.fn((opts) => Promise.resolve([opts])) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TiposReglaService,
        { provide: getRepositoryToken(TipoRegla), useValue: repo },
      ],
    }).compile();

    service = module.get<TiposReglaService>(TiposReglaService);
  });

  it('filtra por clase y por activo=true', async () => {
    await service.findAll('descuento');
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { activo: true, clase: 'descuento' },
      }),
    );
  });

  it('sin clase, filtra solo por activo=true', async () => {
    await service.findAll();
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { activo: true },
      }),
    );
  });
});
