import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { CausasMermaService } from './causas-merma.service';
import { CausaMerma } from './entities/causa-merma.entity';

const TENANT = 'tenant-uuid';
const CAUSA = 'causa-uuid';

describe('CausasMermaService', () => {
  let service: CausasMermaService;
  let queryMock: jest.Mock;

  beforeEach(async () => {
    queryMock = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CausasMermaService,
        { provide: getRepositoryToken(CausaMerma), useValue: {} },
        { provide: getDataSourceToken(), useValue: { query: queryMock } },
      ],
    }).compile();

    service = module.get<CausasMermaService>(CausasMermaService);
  });

  describe('create', () => {
    it('inserta con es_fijo=false y nombre trim', async () => {
      queryMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ causa_merma_id: CAUSA }]);

      const result = await service.create(TENANT, { nombre: '  Rotura  ' });

      expect(queryMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('es_fijo'),
        [TENANT, 'Rotura', true],
      );
      expect(result).toEqual({ id: CAUSA });
    });

    it('rechaza nombre duplicado (case-insensitive)', async () => {
      queryMock.mockResolvedValueOnce([{ '?column?': 1 }]);

      await expect(
        service.create(TENANT, { nombre: 'vencimiento' }),
      ).rejects.toThrow(BadRequestException);
      expect(queryMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('update', () => {
    it('rechaza modificar causa fija del sistema', async () => {
      queryMock.mockResolvedValueOnce([
        {
          causa_merma_id: CAUSA,
          nombre: 'Vencimiento',
          activo: true,
          es_fijo: true,
        },
      ]);

      await expect(
        service.update(TENANT, CAUSA, { nombre: 'Otro' }),
      ).rejects.toThrow('No se puede modificar una causa fija del sistema');
    });
  });

  describe('remove', () => {
    it('rechaza eliminar causa fija del sistema', async () => {
      queryMock.mockResolvedValueOnce([
        {
          causa_merma_id: CAUSA,
          nombre: 'Vencimiento',
          activo: true,
          es_fijo: true,
        },
      ]);

      await expect(service.remove(TENANT, CAUSA)).rejects.toThrow(
        'No se puede eliminar una causa fija del sistema',
      );
    });

    it('rechaza eliminar causa en uso en movimientos', async () => {
      queryMock
        .mockResolvedValueOnce([
          {
            causa_merma_id: CAUSA,
            nombre: 'Rotura',
            activo: true,
            es_fijo: false,
          },
        ])
        .mockResolvedValueOnce([{ cnt: '2' }]);

      await expect(service.remove(TENANT, CAUSA)).rejects.toThrow(
        'No se puede eliminar: la causa está en uso en movimientos de merma',
      );
    });

    it('hace soft delete si no hay uso', async () => {
      queryMock
        .mockResolvedValueOnce([
          {
            causa_merma_id: CAUSA,
            nombre: 'Rotura',
            activo: true,
            es_fijo: false,
          },
        ])
        .mockResolvedValueOnce([{ cnt: '0' }])
        .mockResolvedValueOnce([]);

      await service.remove(TENANT, CAUSA);

      expect(queryMock).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('eliminado_el = NOW()'),
        [CAUSA, TENANT],
      );
    });
  });
});
