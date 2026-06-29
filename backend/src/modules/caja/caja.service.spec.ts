import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { CajaService } from './caja.service';
import { Caja } from './entities/caja.entity';
import { MovimientoCaja } from './entities/movimiento-caja.entity';
import type { AbrirCajaDto } from './dto/abrir-caja.dto';

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const USUARIO_ID = 'bbbbbbbb-0000-0000-0000-000000000002';

const mockCajaAbierta: Partial<Caja> = {
  id: 'cccccccc-0000-0000-0000-000000000003',
  tenantId: TENANT_ID,
  usuarioId: USUARIO_ID,
  tipo: 'fisica',
  estado: 'abierta',
  saldoInicial: '1000',
  eliminadoEl: null,
};

describe('CajaService', () => {
  let service: CajaService;
  let cajaRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    cajaRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CajaService,
        { provide: getRepositoryToken(Caja), useValue: cajaRepo },
        { provide: getRepositoryToken(MovimientoCaja), useValue: {} },
      ],
    }).compile();

    service = module.get<CajaService>(CajaService);
  });

  describe('findActiva', () => {
    it('should return the open physical caja for the given tenant and user', async () => {
      cajaRepo.findOne.mockResolvedValue(mockCajaAbierta);

      const result = await service.findActiva(TENANT_ID, USUARIO_ID);

      expect(cajaRepo.findOne).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          usuarioId: USUARIO_ID,
          tipo: 'fisica',
          estado: 'abierta',
          eliminadoEl: IsNull(),
        },
      });
      expect(result).toEqual(mockCajaAbierta);
    });

    it('should return null when there is no open physical caja', async () => {
      cajaRepo.findOne.mockResolvedValue(null);

      const result = await service.findActiva(TENANT_ID, USUARIO_ID);

      expect(result).toBeNull();
    });
  });

  describe('abrir', () => {
    const dto: AbrirCajaDto = {
      saldoInicial: '500',
      comentario: 'Apertura matutina',
    };

    it('should create and return a new open physical caja', async () => {
      cajaRepo.findOne.mockResolvedValue(null); // no hay caja activa
      const created: Partial<Caja> = {
        tenantId: TENANT_ID,
        usuarioId: USUARIO_ID,
        tipo: 'fisica',
        estado: 'abierta',
        saldoInicial: dto.saldoInicial,
        comentario: dto.comentario ?? null,
      };
      const saved = { id: 'new-uuid', ...created };
      cajaRepo.create.mockReturnValue(created);
      cajaRepo.save.mockResolvedValue(saved);

      const result = await service.abrir(TENANT_ID, USUARIO_ID, dto);

      expect(cajaRepo.create).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        usuarioId: USUARIO_ID,
        tipo: 'fisica',
        estado: 'abierta',
        saldoInicial: dto.saldoInicial,
        comentario: dto.comentario,
      });
      expect(cajaRepo.save).toHaveBeenCalledWith(created);
      expect(result).toEqual(saved);
    });

    it('should throw ConflictException when user already has an open physical caja', async () => {
      cajaRepo.findOne.mockResolvedValue(mockCajaAbierta);

      await expect(service.abrir(TENANT_ID, USUARIO_ID, dto)).rejects.toThrow(
        new ConflictException('Ya tienes una caja abierta'),
      );

      expect(cajaRepo.create).not.toHaveBeenCalled();
      expect(cajaRepo.save).not.toHaveBeenCalled();
    });
  });
});
