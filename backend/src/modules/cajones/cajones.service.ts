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
import { Caja } from '../caja/entities/caja.entity';
import { CreateCajonDto } from './dto/create-cajon.dto';
import { UpdateCajonDto } from './dto/update-cajon.dto';

// `eliminadoPorNombre` es opcional: el listado sin `incluirEliminados` sigue
// devolviendo `Cajon[]` tal cual (sin el JOIN, N+1 si lo forzáramos acá).
export type CajonConAuditoria = Cajon & {
  eliminadoPorNombre?: string | null;
};

@Injectable()
export class CajonesService {
  constructor(
    @InjectRepository(Cajon)
    private readonly cajonRepo: Repository<Cajon>,
    @InjectRepository(CajonUsuario)
    private readonly cajonUsuarioRepo: Repository<CajonUsuario>,
    @InjectRepository(UsuarioTenant)
    private readonly usuarioTenantRepo: Repository<UsuarioTenant>,
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findAll(
    tenantId: string,
    incluirEliminados = false,
  ): Promise<CajonConAuditoria[]> {
    if (!incluirEliminados) {
      return this.cajonRepo.find({
        where: { tenantId },
        order: { nombre: 'ASC' },
      });
    }
    // Mismo patrón que categorias.service.ts → findAll: `getMany()` descarta
    // los `addSelect` que no mapean a una columna de la entity, así que hay
    // que usar `getRawAndEntities()` y fusionar a mano. El JOIN a `usuarios`
    // no filtra `eliminado_el` (docs/patterns/backend.md, excepción
    // documentada: el autor de un borrado es un hecho histórico).
    const { entities, raw } = await this.cajonRepo
      .createQueryBuilder('c')
      .leftJoin('usuarios', 'u', 'u.usuario_id = c.eliminado_por')
      .addSelect('u.nombre_usuario', 'c_eliminado_por_nombre')
      .where('c.tenant_id = :tenantId', { tenantId })
      .withDeleted()
      .orderBy('c.nombre', 'ASC')
      .getRawAndEntities<{ c_eliminado_por_nombre: string | null }>();

    return entities.map((cajon, i) => ({
      ...cajon,
      eliminadoPorNombre: raw[i].c_eliminado_por_nombre,
    }));
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
    if (dto.activo != null) {
      if (dto.activo === false) {
        await this.asegurarSinSesionAbierta(tenantId, id, 'desactivar');
      }
      cajon.activo = dto.activo;
    }
    return this.cajonRepo.save(cajon);
  }

  async remove(tenantId: string, usuarioId: string, id: string): Promise<void> {
    const cajon = await this.cajonRepo.findOne({ where: { id, tenantId } });
    if (!cajon) throw new NotFoundException(`Cajón ${id} no encontrado`);
    await this.asegurarSinSesionAbierta(tenantId, id, 'eliminar');
    // Una sola escritura en vez de `softDelete`: dos sentencias sueltas
    // pueden quedar a medias y dejar una fila borrada sin autor.
    await this.cajonRepo.update(
      { id, tenantId },
      { eliminadoPor: usuarioId, eliminadoEl: new Date() },
    );
  }

  async restaurar(tenantId: string, id: string): Promise<Cajon> {
    // Una sola regla para los dos casos —no existe, o existe y está viva—:
    // `eliminadoEl` no nulo es lo que define "está en la papelera".
    const cajon = await this.cajonRepo.findOne({
      where: { id, tenantId },
      withDeleted: true,
    });
    if (!cajon || !cajon.eliminadoEl) {
      throw new NotFoundException(`Cajón ${id} no está en la papelera`);
    }
    try {
      await this.cajonRepo.restore({ id, tenantId });
    } catch (e) {
      // 23505 = unique_violation. `ux_cajones_tenant_nombre` es parcial
      // (WHERE eliminado_el IS NULL): mientras el cajón estaba borrado nadie
      // competía por el nombre, pero al revivirlo vuelve a competir. Se capta
      // el código de Postgres —no una lista de índices a mano— para que valga
      // también donde no lo enumeramos. Mismo patrón que
      // causas-merma.service.ts → restaurar().
      if ((e as { code?: string }).code === '23505') {
        throw new BadRequestException(
          'Ya existe un cajón activo con ese nombre. Renombrá el actual o el restaurado antes de continuar.',
        );
      }
      throw e;
    }
    return this.cajonRepo.findOneOrFail({ where: { id, tenantId } });
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

  private async asegurarSinSesionAbierta(
    tenantId: string,
    cajonId: string,
    accion: 'desactivar' | 'eliminar',
  ): Promise<void> {
    const abiertas = await this.cajaRepo.count({
      where: { tenantId, cajonId, estado: 'abierta' },
    });
    if (abiertas > 0) {
      throw new ConflictException(
        `El cajón tiene una caja abierta; ciérrala antes de ${accion}.`,
      );
    }
  }
}
