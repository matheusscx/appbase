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
        { provide: getRepositoryToken(UnidadMedida), useValue: unidadMedidaRepo },
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
});
