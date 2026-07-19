import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { Impuesto } from './entities/impuesto.entity';
import { CreateImpuestoDto } from './dto/create-impuesto.dto';
import { UpdateImpuestoDto } from './dto/update-impuesto.dto';

export type ImpuestoConOrigen = Impuesto & {
  origen: 'sistema' | 'personalizado';
};

@Injectable()
export class ImpuestosService {
  constructor(
    @InjectRepository(Impuesto)
    private readonly impuestoRepo: Repository<Impuesto>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
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

  /** País del tenant: tenants.provincia_id → provincia.pais_id. */
  private async paisIdDeTenant(tenantId: string): Promise<string | null> {
    const rows: { pais_id: string }[] = await this.dataSource.query(
      `SELECT p.pais_id
         FROM tenants t
         JOIN provincia p ON p.provincia_id = t.provincia_id AND p.eliminado_el IS NULL
        WHERE t.tenant_id = $1 AND t.eliminado_el IS NULL`,
      [tenantId],
    );
    return rows[0]?.pais_id ?? null;
  }

  async findAll(tenantId: string): Promise<ImpuestoConOrigen[]> {
    const paisId = await this.paisIdDeTenant(tenantId);
    const impuestos = await this.impuestoRepo.find({
      where: paisId ? [{ tenantId }, { paisId }] : { tenantId },
      order: { nombre: 'ASC' },
    });
    return impuestos.map((i) =>
      Object.assign(i, {
        origen: i.tenantId ? 'personalizado' : 'sistema',
      }),
    );
  }

  async create(tenantId: string, dto: CreateImpuestoDto): Promise<Impuesto> {
    this.validarPorcentaje(dto.porcentaje);
    const impuesto = this.impuestoRepo.create({
      tenantId,
      nombre: dto.nombre,
      porcentaje: dto.porcentaje,
      activo: dto.activo ?? true,
      tipo: dto.tipo ?? 'otro',
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
