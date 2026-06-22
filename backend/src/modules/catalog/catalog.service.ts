import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModuloApp } from './entities/modulo-app.entity';
import { Permiso } from './entities/permiso.entity';
import { Pais } from './entities/pais.entity';
import { Provincia } from './entities/provincia.entity';

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(ModuloApp)
    private readonly moduloAppRepo: Repository<ModuloApp>,
    @InjectRepository(Permiso)
    private readonly permisoRepo: Repository<Permiso>,
    @InjectRepository(Pais)
    private readonly paisRepo: Repository<Pais>,
    @InjectRepository(Provincia)
    private readonly provinciaRepo: Repository<Provincia>,
  ) {}

  findAllModulos(): Promise<ModuloApp[]> {
    return this.moduloAppRepo.find();
  }

  findAllPermisos(): Promise<Permiso[]> {
    return this.permisoRepo.find();
  }

  findAllPaises(): Promise<Pais[]> {
    return this.paisRepo.find({
      order: { nombre: 'ASC' },
    });
  }

  findAllProvincias(paisId?: string): Promise<Provincia[]> {
    return this.provinciaRepo.find({
      where: paisId ? { paisId } : {},
      order: { nombre: 'ASC' },
    });
  }
}
