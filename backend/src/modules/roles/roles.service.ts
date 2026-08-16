import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { Rol } from './entities/rol.entity';
import { RolUsuario } from './entities/rol-usuario.entity';
import { ModuloRol } from './entities/modulo-rol.entity';
import { RolPermisoModulo } from './entities/rol-permiso-modulo.entity';
import { TenantModulo } from '../tenants/entities/tenant-modulo.entity';
import { CreateRolDto } from './dto/create-rol.dto';
import { UpdateRolDto } from './dto/update-rol.dto';
import { RbacService } from '../rbac/rbac.service';

export interface ModuloDisponible {
  moduloTenantId: string;
  moduloAppId: string;
  nombre: string;
  icono: string | null;
  permisos: { moduloAppPermisoId: string; permisoNombre: string }[];
}

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Rol)
    private readonly rolRepo: Repository<Rol>,
    @InjectRepository(RolUsuario)
    private readonly rolUsuarioRepo: Repository<RolUsuario>,
    @InjectRepository(ModuloRol)
    private readonly moduloRolRepo: Repository<ModuloRol>,
    @InjectRepository(RolPermisoModulo)
    private readonly rolPermisoModuloRepo: Repository<RolPermisoModulo>,
    @InjectRepository(TenantModulo)
    private readonly tenantModuloRepo: Repository<TenantModulo>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly rbacService: RbacService,
  ) {}

  async findAll(tenantId: string): Promise<Rol[]> {
    return this.rolRepo.find({ where: { tenantId } });
  }

  async create(tenantId: string, dto: CreateRolDto): Promise<Rol> {
    const rol = this.rolRepo.create({
      tenantId,
      nombre: dto.nombre,
      descripcion: dto.descripcion ?? null,
      esFijo: false,
    });
    return this.rolRepo.save(rol);
  }

  async update(id: string, tenantId: string, dto: UpdateRolDto): Promise<Rol> {
    const rol = await this.rolRepo.findOne({ where: { id, tenantId } });
    if (!rol) throw new NotFoundException(`Rol ${id} no encontrado`);
    if (rol.esFijo)
      throw new BadRequestException('No se puede modificar un rol fijo');
    Object.assign(rol, dto);
    return this.rolRepo.save(rol);
  }

  async remove(id: string, tenantId: string): Promise<void> {
    const rol = await this.rolRepo.findOne({ where: { id, tenantId } });
    if (!rol) throw new NotFoundException(`Rol ${id} no encontrado`);
    if (rol.esFijo)
      throw new BadRequestException('No se puede eliminar un rol fijo');
    await this.rolRepo.softDelete({ id });
  }

  async assignUser(
    rolId: string,
    tenantId: string,
    usuarioId: string,
  ): Promise<RolUsuario> {
    // El rol tiene que ser de este tenant. Sus hermanos de este mismo archivo
    // (`update`, `remove`, `findPermissions`, `setPermissions`) ya lo validan;
    // acá faltaba, y era el único método que escribía en `roles_usuarios` una
    // fila que podía apuntar a un rol ajeno. El motor de permisos ahora ata el
    // tenant en el JOIN (ver `RbacService`), así que la fila cruzada no
    // concedería nada — pero escribirla sigue siendo un dato mentiroso.
    const rol = await this.rolRepo.findOne({ where: { id: rolId, tenantId } });
    if (!rol) throw new NotFoundException(`Rol ${rolId} no encontrado`);

    // Verify the target user belongs to this tenant
    const esMiembro = await this.dataSource.query<unknown[]>(
      `SELECT 1 FROM usuarios_tenants
       WHERE usuario_id = $1 AND tenant_id = $2 AND eliminado_el IS NULL`,
      [usuarioId, tenantId],
    );
    if (esMiembro.length === 0) {
      throw new BadRequestException('El usuario no pertenece a este tenant');
    }

    const existing = await this.rolUsuarioRepo.findOne({
      where: { rolId, tenantId, usuarioId },
      withDeleted: true,
    });

    if (existing) {
      if (existing.eliminadoEl) {
        existing.eliminadoEl = null;
        return this.rolUsuarioRepo.save(existing);
      }
      return existing;
    }

    const assignment = this.rolUsuarioRepo.create({
      rolId,
      tenantId,
      usuarioId,
    });
    return this.rolUsuarioRepo.save(assignment);
  }

  /**
   * Desasigna a una persona de un rol, **salvo que eso deje al tenant sin
   * ningún administrador**.
   *
   * `TenantAdminGuard` solo verifica que quien llama sea admin en ese
   * instante, nunca que la acción deje al tenant con alguno: el último admin
   * podía sacarse el rol a sí mismo, y `/admin/tenants` no tiene ninguna ruta
   * para asignar un rol ni sumar un miembro, así que salir de ahí requiere
   * SQL directo. (Su hermano `remove` —borrar el rol— sí bloqueaba `esFijo`;
   * desasignar a la persona, no.)
   *
   * **Se borra y después se cuenta, en vez de calcular si el borrado
   * sobraría.** Quitarle UN rol fijo a alguien que tiene dos no lo saca del
   * conjunto, y esa aritmética es justo donde se cuelan los casos raros.
   * Preguntarle a la base cómo quedó el tenant no tiene ese problema, y el
   * `throw` deshace el borrado con la transacción.
   */
  async removeUser(
    rolId: string,
    tenantId: string,
    usuarioId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.rbacService.administradoresDe(manager, tenantId, true);
      await manager.softDelete(RolUsuario, { rolId, tenantId, usuarioId });
      const quedan = await this.rbacService.administradoresDe(
        manager,
        tenantId,
        false,
      );
      if (quedan.length === 0) {
        throw new BadRequestException(
          'No se puede quitar ese rol: dejaría a la empresa sin ningún ' +
            'administrador, y no hay forma de volver a asignar uno desde la ' +
            'aplicación. Dale el rol de administrador a otra persona primero.',
        );
      }
    });
  }

  async findPermissions(
    rolId: string,
    tenantId: string,
  ): Promise<RolPermisoModulo[]> {
    // Verify the rol belongs to this tenant
    const rol = await this.rolRepo.findOne({ where: { id: rolId, tenantId } });
    if (!rol) throw new NotFoundException(`Rol ${rolId} no encontrado`);
    return this.rolPermisoModuloRepo.find({ where: { rolId } });
  }

  async setPermissions(
    rolId: string,
    moduloTenantId: string,
    tenantId: string,
    moduloAppPermisoIds: string[],
  ): Promise<void> {
    // Verify the rol belongs to this tenant
    const rol = await this.rolRepo.findOne({ where: { id: rolId, tenantId } });
    if (!rol) throw new NotFoundException(`Rol ${rolId} no encontrado`);

    // Verify that moduloTenantId belongs to this tenant
    const tenantModulo = await this.tenantModuloRepo.findOne({
      where: { moduloTenantId, tenantId },
    });
    if (!tenantModulo)
      throw new BadRequestException('El módulo no pertenece a este tenant');

    // Borrar los permisos existentes y escribir los nuevos en una sola
    // transacción: si el `save` de más abajo falla, el `delete` no debe
    // quedar commiteado — si no, el rol se queda sin ningún permiso en este
    // módulo hasta el próximo PUT exitoso.
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(RolPermisoModulo, { rolId, moduloTenantId });

      if (moduloAppPermisoIds.length > 0) {
        // El chequeo de permisos (RbacService) hace JOIN por modulos_roles, así
        // que el rol debe estar vinculado al módulo del tenant para que los
        // permisos surtan efecto. Asegurar la fila (crear o restaurar si está
        // soft-deleted).
        await this.ensureModuloRol(manager, rolId, moduloTenantId);

        const entries = moduloAppPermisoIds.map((moduloAppPermisoId) =>
          manager.create(RolPermisoModulo, {
            rolId,
            moduloTenantId,
            moduloAppPermisoId,
          }),
        );
        await manager.save(entries);
      } else {
        // Sin permisos en este módulo → quitar el vínculo rol↔módulo.
        await manager.softDelete(ModuloRol, { rolId, moduloTenantId });
      }
    });
  }

  private async ensureModuloRol(
    manager: EntityManager,
    rolId: string,
    moduloTenantId: string,
  ): Promise<void> {
    const existing = await manager.findOne(ModuloRol, {
      where: { rolId, moduloTenantId },
      withDeleted: true,
    });

    if (existing) {
      if (existing.eliminadoEl) {
        existing.eliminadoEl = null;
        await manager.save(ModuloRol, existing);
      }
      return;
    }

    await manager.save(
      ModuloRol,
      manager.create(ModuloRol, { rolId, moduloTenantId }),
    );
  }

  async findModulosDisponibles(tenantId: string): Promise<ModuloDisponible[]> {
    const rows: {
      modulo_tenant_id: string;
      modulo_app_id: string;
      nombre: string;
      icono: string | null;
      modulo_app_permiso_id: string;
      permiso_nombre: string;
    }[] = await this.dataSource.query(
      `SELECT tm.modulo_tenant_id,
              ma.modulo_app_id,
              ma.nombre,
              ma.icono,
              map.modulo_app_permiso_id,
              p.nombre AS permiso_nombre
       FROM tenant_modulos tm
       JOIN modulos_app ma ON ma.modulo_app_id = tm.modulo_app_id AND ma.eliminado_el IS NULL
       JOIN modulo_app_permisos map ON map.modulo_app_id = ma.modulo_app_id AND map.eliminado_el IS NULL
       JOIN permisos p ON p.permiso_id = map.permiso_id AND p.eliminado_el IS NULL
       WHERE tm.tenant_id = $1
         AND tm.estado = 'activo'
         AND tm.eliminado_el IS NULL
       ORDER BY ma.nombre, p.nombre`,
      [tenantId],
    );

    const porModulo = new Map<string, ModuloDisponible>();
    for (const row of rows) {
      let modulo = porModulo.get(row.modulo_tenant_id);
      if (!modulo) {
        modulo = {
          moduloTenantId: row.modulo_tenant_id,
          moduloAppId: row.modulo_app_id,
          nombre: row.nombre,
          icono: row.icono,
          permisos: [],
        };
        porModulo.set(row.modulo_tenant_id, modulo);
      }
      modulo.permisos.push({
        moduloAppPermisoId: row.modulo_app_permiso_id,
        permisoNombre: row.permiso_nombre,
      });
    }

    return [...porModulo.values()];
  }
}
