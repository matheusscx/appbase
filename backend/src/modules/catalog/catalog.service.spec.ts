import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CatalogService } from './catalog.service';
import { ModuloApp } from './entities/modulo-app.entity';
import { Permiso } from './entities/permiso.entity';
import { Pais } from './entities/pais.entity';
import { Provincia } from './entities/provincia.entity';
import { UnidadMedida } from './entities/unidad-medida.entity';

const mockPais: Pais = {
  paisId: 'pais-uuid',
  nombre: 'Chile',
  codigoIso: 'CL',
  zonaHorariaPrincipal: 'America/Santiago',
  monedaOficialId: null,
  creadoEl: new Date(),
  actualizadoEl: new Date(),
  eliminadoEl: null as unknown as Date,
};

const mockProvincia: Provincia = {
  provinciaId: 'prov-uuid',
  paisId: 'pais-uuid',
  nombre: 'Región Metropolitana',
  zonaHoraria: 'America/Santiago',
  creadoEl: new Date(),
  actualizadoEl: new Date(),
  eliminadoEl: null as unknown as Date,
};

const mockUnidadMedida: UnidadMedida = {
  unidadMedidaId: 'unidad-uuid',
  codigo: 'kg',
  nombre: 'Kilogramo',
  magnitud: 'masa',
  factorBase: '1000.000000',
  creadoEl: new Date(),
  actualizadoEl: new Date(),
  eliminadoEl: null as unknown as Date,
};

const unidadG: UnidadMedida = {
  ...mockUnidadMedida,
  unidadMedidaId: 'g-uuid',
  codigo: 'g',
  nombre: 'Gramo',
  magnitud: 'masa',
  factorBase: '1.000000',
};
const unidadKg: UnidadMedida = {
  ...mockUnidadMedida,
  unidadMedidaId: 'kg-uuid',
  codigo: 'kg',
  nombre: 'Kilogramo',
  magnitud: 'masa',
  factorBase: '1000.000000',
};
const unidadL: UnidadMedida = {
  ...mockUnidadMedida,
  unidadMedidaId: 'l-uuid',
  codigo: 'l',
  nombre: 'Litro',
  magnitud: 'volumen',
  factorBase: '1000.000000',
};

describe('CatalogService', () => {
  let service: CatalogService;
  let paisRepo: { find: jest.Mock };
  let provinciaRepo: { find: jest.Mock };
  let unidadMedidaRepo: { find: jest.Mock };

  beforeEach(async () => {
    paisRepo = { find: jest.fn() };
    provinciaRepo = { find: jest.fn() };
    unidadMedidaRepo = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        {
          provide: getRepositoryToken(ModuloApp),
          useValue: { find: jest.fn() },
        },
        { provide: getRepositoryToken(Permiso), useValue: { find: jest.fn() } },
        { provide: getRepositoryToken(Pais), useValue: paisRepo },
        { provide: getRepositoryToken(Provincia), useValue: provinciaRepo },
        {
          provide: getRepositoryToken(UnidadMedida),
          useValue: unidadMedidaRepo,
        },
      ],
    }).compile();

    service = module.get<CatalogService>(CatalogService);
  });

  describe('findAllPaises', () => {
    it('retorna todos los paises', async () => {
      paisRepo.find.mockResolvedValue([mockPais]);
      const result = await service.findAllPaises();
      expect(result).toEqual([mockPais]);
      expect(paisRepo.find).toHaveBeenCalledWith({
        order: { nombre: 'ASC' },
      });
    });
  });

  describe('findAllProvincias', () => {
    it('retorna todas las provincias sin filtro', async () => {
      provinciaRepo.find.mockResolvedValue([mockProvincia]);
      const result = await service.findAllProvincias();
      expect(result).toEqual([mockProvincia]);
      expect(provinciaRepo.find).toHaveBeenCalledWith({
        where: {},
        order: { nombre: 'ASC' },
      });
    });

    it('filtra por paisId cuando se provee', async () => {
      provinciaRepo.find.mockResolvedValue([mockProvincia]);
      const result = await service.findAllProvincias('pais-uuid');
      expect(result).toEqual([mockProvincia]);
      expect(provinciaRepo.find).toHaveBeenCalledWith({
        where: { paisId: 'pais-uuid' },
        order: { nombre: 'ASC' },
      });
    });
  });

  describe('findAllUnidadesMedida', () => {
    it('retorna las unidades ordenadas por magnitud y factor', async () => {
      unidadMedidaRepo.find.mockResolvedValue([mockUnidadMedida]);
      const result = await service.findAllUnidadesMedida();
      expect(result).toEqual([mockUnidadMedida]);
      expect(unidadMedidaRepo.find).toHaveBeenCalledWith({
        order: { magnitud: 'ASC', factorBase: 'ASC' },
      });
    });
  });

  describe('convertirUnidad', () => {
    it('convierte de una unidad mayor a una menor (kg → g)', async () => {
      unidadMedidaRepo.find.mockResolvedValue([unidadG, unidadKg]);
      expect(await service.convertirUnidad('2', 'kg', 'g')).toBe('2000');
    });

    it('convierte de una unidad menor a una mayor (g → kg)', async () => {
      unidadMedidaRepo.find.mockResolvedValue([unidadG, unidadKg]);
      expect(await service.convertirUnidad('500', 'g', 'kg')).toBe('0.5');
    });

    it('devuelve la cantidad intacta si la unidad es la misma, sin consultar el catálogo', async () => {
      expect(await service.convertirUnidad('7.5', 'kg', 'kg')).toBe('7.5');
      expect(unidadMedidaRepo.find).not.toHaveBeenCalled();
    });

    it('redondea a 4 decimales (la escala de stock)', async () => {
      unidadMedidaRepo.find.mockResolvedValue([unidadG, unidadKg]);
      expect(await service.convertirUnidad('1', 'g', 'kg')).toBe('0.001');
    });

    it('rechaza una unidad desconocida', async () => {
      unidadMedidaRepo.find.mockResolvedValue([unidadKg]);
      await expect(
        service.convertirUnidad('1', 'inventada', 'kg'),
      ).rejects.toThrow('Unidad de medida no reconocida: inventada');
    });

    it('rechaza convertir entre magnitudes distintas', async () => {
      unidadMedidaRepo.find.mockResolvedValue([unidadKg, unidadL]);
      await expect(service.convertirUnidad('1', 'l', 'kg')).rejects.toThrow(
        'No se puede convertir de volumen a masa',
      );
    });

    it('rechaza una cantidad que se perdería al redondear a la precisión de stock', async () => {
      unidadMedidaRepo.find.mockResolvedValue([unidadG, unidadKg]);
      await expect(
        service.convertirUnidad('0.00004', 'g', 'kg'),
      ).rejects.toThrow('menor a la precisión de stock');
    });

    it('rechaza factor_base <= 0', async () => {
      const unidadRota = { ...unidadKg, factorBase: '0' };
      unidadMedidaRepo.find.mockResolvedValue([unidadG, unidadRota]);
      await expect(service.convertirUnidad('1', 'g', 'kg')).rejects.toThrow(
        'El factor de conversión de la unidad debe ser mayor a 0',
      );
    });
  });
});
