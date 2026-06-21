import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModuloApp } from './entities/modulo-app.entity';
import { Permiso } from './entities/permiso.entity';

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(ModuloApp)
    private readonly moduloAppRepo: Repository<ModuloApp>,
    @InjectRepository(Permiso)
    private readonly permisoRepo: Repository<Permiso>,
  ) {}

  findAllModulos(): Promise<ModuloApp[]> {
    return this.moduloAppRepo.find();
  }

  findAllPermisos(): Promise<Permiso[]> {
    return this.permisoRepo.find();
  }
}
