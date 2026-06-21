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
import { RolPermisoModulo } from './entities/rol-permiso-modulo.entity';
import { TenantModulo } from '../tenants/entities/tenant-modulo.entity';
import { CreateRolDto } from './dto/create-rol.dto';
import { UpdateRolDto } from './dto/update-rol.dto';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Rol)
    private readonly rolRepo: Repository<Rol>,
    @InjectRepository(RolUsuario)
    private readonly rolUsuarioRepo: Repository<RolUsuario>,
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

    // Insert new permissions
    if (moduloAppPermisoIds.length > 0) {
      const entries = moduloAppPermisoIds.map((moduloAppPermisoId) =>
        this.rolPermisoModuloRepo.create({
          rolId,
          moduloTenantId,
          moduloAppPermisoId,
        }),
      );
      await this.rolPermisoModuloRepo.save(entries);
    }
  }
}
