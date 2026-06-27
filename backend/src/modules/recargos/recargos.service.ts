import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Recargo } from './entities/recargo.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { CreateRecargoDto } from './dto/create-recargo.dto';
import { UpdateRecargoDto } from './dto/update-recargo.dto';
import { ModoRegla } from '../../common/enums/reglas.enums';

const CLASE = 'recargo';

@Injectable()
export class RecargosService {
  constructor(
    @InjectRepository(Recargo)
    private readonly recargoRepo: Repository<Recargo>,
    @InjectRepository(TipoRegla)
    private readonly tipoReglaRepo: Repository<TipoRegla>,
  ) {}

  findAll(tenantId: string): Promise<Recargo[]> {
    return this.recargoRepo.find({
      where: { tenantId },
      order: { nombre: 'ASC' },
    });
  }

  async create(tenantId: string, dto: CreateRecargoDto): Promise<Recargo> {
    await this.validarTipoRegla(dto.tipoReglaId);
    this.validarValor(dto.modo, dto.valor);

    const recargo = this.recargoRepo.create({ tenantId, ...dto });
    return this.recargoRepo.save(recargo);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateRecargoDto,
  ): Promise<Recargo> {
    const recargo = await this.recargoRepo.findOne({
      where: { id, tenantId },
    });
    if (!recargo) throw new NotFoundException(`Recargo ${id} no encontrado`);

    if (dto.tipoReglaId) await this.validarTipoRegla(dto.tipoReglaId);

    const modo = dto.modo ?? recargo.modo;
    const valor = dto.valor ?? recargo.valor;
    if (dto.modo !== undefined || dto.valor !== undefined) {
      this.validarValor(modo, valor);
    }

    Object.assign(recargo, dto);
    return this.recargoRepo.save(recargo);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const recargo = await this.recargoRepo.findOne({
      where: { id, tenantId },
    });
    if (!recargo) throw new NotFoundException(`Recargo ${id} no encontrado`);
    await this.recargoRepo.softDelete({ id, tenantId });
  }

  private async validarTipoRegla(tipoReglaId: string): Promise<void> {
    const tipo = await this.tipoReglaRepo.findOne({
      where: { id: tipoReglaId },
    });
    if (!tipo)
      throw new BadRequestException('El tipo de regla seleccionado no existe');
    if (tipo.clase !== CLASE)
      throw new BadRequestException(
        'El tipo seleccionado no corresponde a un recargo',
      );
  }

  private validarValor(modo: ModoRegla, valor: string | null): void {
    if (valor === null) return; // null es válido cuando el tipo usa tramos
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
