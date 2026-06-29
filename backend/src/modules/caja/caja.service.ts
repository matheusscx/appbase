import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Caja } from './entities/caja.entity';
import { MovimientoCaja } from './entities/movimiento-caja.entity';
import type { AbrirCajaDto } from './dto/abrir-caja.dto';

@Injectable()
export class CajaService {
  constructor(
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
    @InjectRepository(MovimientoCaja)
    private readonly movimientoCajaRepo: Repository<MovimientoCaja>,
  ) {}

  async findActiva(tenantId: string, usuarioId: string): Promise<Caja | null> {
    return this.cajaRepo.findOne({
      where: {
        tenantId,
        usuarioId,
        tipo: 'fisica',
        estado: 'abierta',
        eliminadoEl: IsNull(),
      },
    });
  }

  async abrir(
    tenantId: string,
    usuarioId: string,
    dto: AbrirCajaDto,
  ): Promise<Caja> {
    const existente = await this.findActiva(tenantId, usuarioId);
    if (existente) {
      throw new ConflictException('Ya tienes una caja abierta');
    }

    const caja = this.cajaRepo.create({
      tenantId,
      usuarioId,
      tipo: 'fisica',
      estado: 'abierta',
      saldoInicial: dto.saldoInicial,
      comentario: dto.comentario,
    });

    return this.cajaRepo.save(caja);
  }
}
