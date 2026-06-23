import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TipoRegla } from './entities/tipo-regla.entity';

@Injectable()
export class TiposReglaService {
  constructor(
    @InjectRepository(TipoRegla)
    private readonly tipoReglaRepo: Repository<TipoRegla>,
  ) {}

  findAll(clase?: string): Promise<TipoRegla[]> {
    return this.tipoReglaRepo.find({
      where: {
        activo: true,
        ...(clase ? { clase } : {}),
      },
      order: { nombre: 'ASC' },
    });
  }
}
