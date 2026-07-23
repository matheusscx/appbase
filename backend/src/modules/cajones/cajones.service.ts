import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Cajon } from './entities/cajon.entity';
import { CreateCajonDto } from './dto/create-cajon.dto';
import { UpdateCajonDto } from './dto/update-cajon.dto';

@Injectable()
export class CajonesService {
  constructor(
    @InjectRepository(Cajon)
    private readonly cajonRepo: Repository<Cajon>,
  ) {}

  findAll(tenantId: string): Promise<Cajon[]> {
    return this.cajonRepo.find({
      where: { tenantId },
      order: { nombre: 'ASC' },
    });
  }

  async create(tenantId: string, dto: CreateCajonDto): Promise<Cajon> {
    await this.validarNombreUnico(tenantId, dto.nombre);
    const cajon = this.cajonRepo.create({ tenantId, nombre: dto.nombre });
    return this.cajonRepo.save(cajon);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateCajonDto,
  ): Promise<Cajon> {
    const cajon = await this.cajonRepo.findOne({ where: { id, tenantId } });
    if (!cajon) throw new NotFoundException(`Cajón ${id} no encontrado`);
    if (dto.nombre != null && dto.nombre !== cajon.nombre) {
      await this.validarNombreUnico(tenantId, dto.nombre, id);
      cajon.nombre = dto.nombre;
    }
    if (dto.activo != null) cajon.activo = dto.activo;
    return this.cajonRepo.save(cajon);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const cajon = await this.cajonRepo.findOne({ where: { id, tenantId } });
    if (!cajon) throw new NotFoundException(`Cajón ${id} no encontrado`);
    await this.cajonRepo.softDelete({ id, tenantId });
  }

  private async validarNombreUnico(
    tenantId: string,
    nombre: string,
    excludeId?: string,
  ): Promise<void> {
    const count = await this.cajonRepo.count({
      where: excludeId
        ? { tenantId, nombre, id: Not(excludeId) }
        : { tenantId, nombre },
    });
    if (count > 0) {
      throw new ConflictException(
        `Ya existe un cajón con el nombre "${nombre}"`,
      );
    }
  }
}
