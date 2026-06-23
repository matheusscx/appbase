import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Descuento } from './entities/descuento.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { CreateDescuentoDto } from './dto/create-descuento.dto';
import { UpdateDescuentoDto } from './dto/update-descuento.dto';
import { ModoRegla } from '../../common/enums/reglas.enums';

const CLASE = 'descuento';

@Injectable()
export class DescuentosService {
  constructor(
    @InjectRepository(Descuento)
    private readonly descuentoRepo: Repository<Descuento>,
    @InjectRepository(TipoRegla)
    private readonly tipoReglaRepo: Repository<TipoRegla>,
  ) {}

  findAll(tenantId: string): Promise<Descuento[]> {
    return this.descuentoRepo.find({
      where: { tenantId },
      order: { nombre: 'ASC' },
    });
  }

  async create(tenantId: string, dto: CreateDescuentoDto): Promise<Descuento> {
    await this.validarTipoRegla(dto.tipoReglaId);
    this.validarValor(dto.modo, dto.valor);

    const descuento = this.descuentoRepo.create({ tenantId, ...dto });
    return this.descuentoRepo.save(descuento);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateDescuentoDto,
  ): Promise<Descuento> {
    const descuento = await this.descuentoRepo.findOne({
      where: { id, tenantId },
    });
    if (!descuento)
      throw new NotFoundException(`Descuento ${id} no encontrado`);

    if (dto.tipoReglaId) await this.validarTipoRegla(dto.tipoReglaId);

    const modo = dto.modo ?? descuento.modo;
    const valor = dto.valor ?? descuento.valor;
    if (dto.modo !== undefined || dto.valor !== undefined) {
      this.validarValor(modo, valor);
    }

    Object.assign(descuento, dto);
    return this.descuentoRepo.save(descuento);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const descuento = await this.descuentoRepo.findOne({
      where: { id, tenantId },
    });
    if (!descuento)
      throw new NotFoundException(`Descuento ${id} no encontrado`);
    await this.descuentoRepo.softDelete({ id, tenantId });
  }

  private async validarTipoRegla(tipoReglaId: string): Promise<void> {
    const tipo = await this.tipoReglaRepo.findOne({
      where: { id: tipoReglaId },
    });
    if (!tipo)
      throw new BadRequestException('El tipo de regla seleccionado no existe');
    if (tipo.clase !== CLASE)
      throw new BadRequestException(
        'El tipo seleccionado no corresponde a un descuento',
      );
  }

  private validarValor(modo: ModoRegla, valor: string): void {
    const numero = Number(valor);
    if (!Number.isFinite(numero) || numero <= 0) {
      throw new BadRequestException('El valor debe ser un número mayor a 0');
    }
    if (modo === ModoRegla.PORCENTAJE && numero >= 1) {
      throw new BadRequestException(
        'El porcentaje debe expresarse en decimal (0.10 = 10%) y ser menor a 1',
      );
    }
  }
}
