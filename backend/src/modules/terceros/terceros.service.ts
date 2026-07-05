import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tercero } from './entities/tercero.entity';
import { CreateTerceroDto } from './dto/create-tercero.dto';
import { UpdateTerceroDto } from './dto/update-tercero.dto';

@Injectable()
export class TercerosService {
  constructor(
    @InjectRepository(Tercero)
    private readonly terceroRepo: Repository<Tercero>,
  ) {}

  findAll(tenantId: string): Promise<Tercero[]> {
    return this.terceroRepo.find({
      where: { tenantId },
      order: { nombre: 'ASC' },
    });
  }

  create(tenantId: string, dto: CreateTerceroDto): Promise<Tercero> {
    const tercero = this.terceroRepo.create({
      tenantId,
      tipo: dto.tipo,
      nombre: dto.nombre,
      rut: dto.rut,
      nombreLegal: dto.nombreLegal,
      rutFiscal: dto.rutFiscal,
      correo: dto.correo,
      telefono: dto.telefono,
      direccion: dto.direccion,
      activo: dto.activo ?? true,
    });
    return this.terceroRepo.save(tercero);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateTerceroDto,
  ): Promise<Tercero> {
    const tercero = await this.terceroRepo.findOne({
      where: { id, tenantId },
    });
    if (!tercero) {
      throw new NotFoundException(`Tercero ${id} no encontrado`);
    }
    Object.assign(tercero, dto);
    return this.terceroRepo.save(tercero);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const tercero = await this.terceroRepo.findOne({
      where: { id, tenantId },
    });
    if (!tercero) {
      throw new NotFoundException(`Tercero ${id} no encontrado`);
    }
    await this.terceroRepo.softDelete({ id, tenantId });
  }
}
