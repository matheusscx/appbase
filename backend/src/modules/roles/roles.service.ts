import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Rol } from './entities/rol.entity';
import { RolUsuario } from './entities/rol-usuario.entity';
import { ModuloRol } from './entities/modulo-rol.entity';
import { RolPermisoModulo } from './entities/rol-permiso-modulo.entity';
import { TenantModulo } from '../tenants/entities/tenant-modulo.entity';
import { CreateRolDto } from './dto/create-rol.dto';
import { UpdateRolDto } from './dto/update-rol.dto';

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

  async removeUser(
    rolId: string,
    tenantId: string,
    usuarioId: string,
  ): Promise<void> {
    await this.rolUsuarioRepo.softDelete({ rolId, tenantId, usuarioId });
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

    // Delete all existing permissions for (rolId, moduloTenantId)
    await this.rolPermisoModuloRepo.delete({ rolId, moduloTenantId });

    if (moduloAppPermisoIds.length > 0) {
      // El chequeo de permisos (RbacService) hace JOIN por modulos_roles, así que
      // el rol debe estar vinculado al módulo del tenant para que los permisos
      // surtan efecto. Asegurar la fila (crear o restaurar si está soft-deleted).
      await this.ensureModuloRol(rolId, moduloTenantId);

      const entries = moduloAppPermisoIds.map((moduloAppPermisoId) =>
        this.rolPermisoModuloRepo.create({
          rolId,
          moduloTenantId,
          moduloAppPermisoId,
        }),
      );
      await this.rolPermisoModuloRepo.save(entries);
    } else {
      // Sin permisos en este módulo → quitar el vínculo rol↔módulo.
      await this.moduloRolRepo.softDelete({ rolId, moduloTenantId });
    }
  }

  private async ensureModuloRol(
    rolId: string,
    moduloTenantId: string,
  ): Promise<void> {
    const existing = await this.moduloRolRepo.findOne({
      where: { rolId, moduloTenantId },
      withDeleted: true,
    });

    if (existing) {
      if (existing.eliminadoEl) {
        existing.eliminadoEl = null;
        await this.moduloRolRepo.save(existing);
      }
      return;
    }

    await this.moduloRolRepo.save(
      this.moduloRolRepo.create({ rolId, moduloTenantId }),
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
