import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Not, Repository } from 'typeorm';
import { Cajon } from './entities/cajon.entity';
import { CajonUsuario } from './entities/cajon-usuario.entity';
import { UsuarioTenant } from '../tenants/entities/usuario-tenant.entity';
import { CreateCajonDto } from './dto/create-cajon.dto';
import { UpdateCajonDto } from './dto/update-cajon.dto';

@Injectable()
export class CajonesService {
  constructor(
    @InjectRepository(Cajon)
    private readonly cajonRepo: Repository<Cajon>,
    @InjectRepository(CajonUsuario)
    private readonly cajonUsuarioRepo: Repository<CajonUsuario>,
    @InjectRepository(UsuarioTenant)
    private readonly usuarioTenantRepo: Repository<UsuarioTenant>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
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

  async getUsuarios(tenantId: string, cajonId: string): Promise<string[]> {
    await this.getCajonOrFail(tenantId, cajonId);
    const rows = await this.cajonUsuarioRepo.find({
      where: { cajonId, tenantId },
      order: { creadoEl: 'ASC' },
    });
    return rows.map((r) => r.usuarioId);
  }

  async setUsuarios(
    tenantId: string,
    cajonId: string,
    usuarioIds: string[],
  ): Promise<string[]> {
    await this.getCajonOrFail(tenantId, cajonId);
    const ids = [...new Set(usuarioIds)];

    if (ids.length > 0) {
      const miembros = await this.usuarioTenantRepo.count({
        where: { tenantId, usuarioId: In(ids) },
      });
      if (miembros !== ids.length) {
        throw new BadRequestException(
          'Algún usuario no pertenece a este tenant',
        );
      }
    }

    const vivos = await this.cajonUsuarioRepo.find({
      where: { cajonId, tenantId },
    });
    const vivosIds = new Set(vivos.map((r) => r.usuarioId));
    const querido = new Set(ids);
    const quitar = vivos.filter((r) => !querido.has(r.usuarioId));
    const agregar = ids.filter((id) => !vivosIds.has(id));

    await this.dataSource.transaction(async (manager) => {
      if (quitar.length > 0) {
        await manager.softDelete(CajonUsuario, {
          id: In(quitar.map((r) => r.id)),
        });
      }
      if (agregar.length > 0) {
        await manager.save(
          agregar.map((usuarioId) =>
            manager.create(CajonUsuario, { tenantId, cajonId, usuarioId }),
          ),
        );
      }
    });

    return ids;
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

  private async getCajonOrFail(
    tenantId: string,
    cajonId: string,
  ): Promise<Cajon> {
    const cajon = await this.cajonRepo.findOne({
      where: { id: cajonId, tenantId },
    });
    if (!cajon) throw new NotFoundException(`Cajón ${cajonId} no encontrado`);
    return cajon;
  }
}
