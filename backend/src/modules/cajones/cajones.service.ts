import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { errorDeColisionNombre } from '../../common/utils/nombre-sugerido.util';
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
      // Solo lo que borró una persona: `eliminado_por IS NULL` es un
      // borrado del sistema, no restaurable ni visible — decisión del
      // owner, docs/features/papelera.md.
      .andWhere('(c.eliminado_el IS NULL OR c.eliminado_por IS NOT NULL)')
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

  async restaurar(
    tenantId: string,
    id: string,
    nombreNuevo?: string,
  ): Promise<Cajon> {
    // Una sola regla para los tres casos —no existe, existe y está viva, o
    // la borró el sistema (`eliminadoPor` nulo)—: la papelera solo restaura
    // lo que borró una persona (decisión del owner, docs/features/papelera.md).
    const cajon = await this.cajonRepo.findOne({
      where: { id, tenantId },
      withDeleted: true,
    });
    if (!cajon || !cajon.eliminadoEl || !cajon.eliminadoPor) {
      throw new NotFoundException(`Cajón ${id} no está en la papelera`);
    }
    try {
      // `restore()` solo limpia la `@DeleteDateColumn`; el `eliminado_por`
      // viejo sobreviviría y disfrazaría un borrado del sistema posterior
      // como borrado de persona (ver categorias.service.ts → restaurar()).
      await this.cajonRepo.update(
        { id, tenantId },
        {
          eliminadoEl: null,
          eliminadoPor: null,
          // Revivir y renombrar en la MISMA escritura: dos sentencias dejarían
          // una ventana con la fila viva y el nombre en colisión.
          ...(nombreNuevo ? { nombre: nombreNuevo } : {}),
        },
      );
    } catch (e) {
      // 23505 = unique_violation. `ux_cajones_tenant_nombre` es parcial
      // (WHERE eliminado_el IS NULL): mientras el cajón estaba borrado nadie
      // competía por el nombre, pero al revivirlo vuelve a competir. Se capta
      // el código de Postgres —no una lista de índices a mano— para que valga
      // también donde no lo enumeramos. Mismo patrón que
      // causas-merma.service.ts → restaurar().
      if ((e as { code?: string }).code === '23505') {
        // La sugerencia se calcula ACÁ y no antes del `UPDATE` a propósito:
        // con un índice único el `catch` hace falta igual —entre consultar y
        // escribir otra transacción puede tomar el nombre—, así que
        // pre-consultar agregaría una query en TODOS los restaurar sin poder
        // sacar este bloque. El `UPDATE` corre en autocommit, así que su
        // fallo no deja una transacción abortada y esta query funciona.
        throw new BadRequestException(
          await errorDeColisionNombre(
            this.cajonRepo,
            'c',
            'un cajón activo',
            tenantId,
            nombreNuevo ?? cajon.nombre,
            { ignorarMayusculas: true },
          ),
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
    // Case-insensitive: "Mostrador" y "mostrador" son el mismo cajón
    // (docs/PRODUCTO.md). Tiene que coincidir con `ux_cajones_tenant_nombre`,
    // que es sobre `lower(nombre)`; si esta comparación fuera exacta, el
    // servicio diría "libre" y el `save` fallaría con 23505.
    // El QueryBuilder aplica solo el filtro de la `@DeleteDateColumn`.
    const qb = this.cajonRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('LOWER(c.nombre) = LOWER(:nombre)', { nombre });
    if (excludeId) {
      qb.andWhere('c.cajon_id != :excludeId', { excludeId });
    }
    if (await qb.getExists()) {
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
