import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { Impuesto } from './entities/impuesto.entity';
import { CreateImpuestoDto } from './dto/create-impuesto.dto';
import { UpdateImpuestoDto } from './dto/update-impuesto.dto';

@Injectable()
export class ImpuestosService {
  constructor(
    @InjectRepository(Impuesto)
    private readonly impuestoRepo: Repository<Impuesto>,
  ) {}

  private validarPorcentaje(porcentaje: string): void {
    let value: Decimal;
    try {
      value = new Decimal(porcentaje);
    } catch {
      throw new BadRequestException('El porcentaje debe ser mayor a 0');
    }
    if (value.isNaN() || value.lessThanOrEqualTo(0)) {
      throw new BadRequestException('El porcentaje debe ser mayor a 0');
    }
  }

  findAll(tenantId: string): Promise<Impuesto[]> {
    return this.impuestoRepo.find({
      where: { tenantId },
      order: { nombre: 'ASC' },
    });
  }

  async create(tenantId: string, dto: CreateImpuestoDto): Promise<Impuesto> {
    this.validarPorcentaje(dto.porcentaje);
    const impuesto = this.impuestoRepo.create({
      tenantId,
      nombre: dto.nombre,
      porcentaje: dto.porcentaje,
      activo: dto.activo ?? true,
    });
    return this.impuestoRepo.save(impuesto);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateImpuestoDto,
  ): Promise<Impuesto> {
    const impuesto = await this.impuestoRepo.findOne({
      where: { id, tenantId },
    });
    if (!impuesto) {
      throw new NotFoundException(`Impuesto ${id} no encontrado`);
    }
    if (dto.porcentaje !== undefined) {
      this.validarPorcentaje(dto.porcentaje);
    }
    Object.assign(impuesto, dto);
    return this.impuestoRepo.save(impuesto);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const impuesto = await this.impuestoRepo.findOne({
      where: { id, tenantId },
    });
    if (!impuesto) {
      throw new NotFoundException(`Impuesto ${id} no encontrado`);
    }
    await this.impuestoRepo.softDelete({ id, tenantId });
  }
}
