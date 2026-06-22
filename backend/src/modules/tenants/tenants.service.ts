import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { Tenant } from './entities/tenant.entity';
import { UsuarioTenant } from './entities/usuario-tenant.entity';
import { TenantModulo } from './entities/tenant-modulo.entity';
import { TenantFormulaPrecio } from './entities/tenant-formula-precio.entity';
import { Caja } from './entities/caja.entity';
import { RazonSocial } from './entities/razon-social.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { UpdateMyTenantDto } from './dto/update-my-tenant.dto';
import { CreateRazonSocialDto } from './dto/create-razon-social.dto';
import { UpdateRazonSocialDto } from './dto/update-razon-social.dto';

export interface TenantMember {
  usuarioId: string;
  nombre: string;
  apellido: string;
  correo: string;
  roles: { rolId: string; nombre: string }[];
}

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(UsuarioTenant)
    private readonly usuarioTenantRepo: Repository<UsuarioTenant>,
    @InjectRepository(TenantModulo)
    private readonly tenantModuloRepo: Repository<TenantModulo>,
    @InjectRepository(TenantFormulaPrecio)
    private readonly tenantFormulaPrecioRepo: Repository<TenantFormulaPrecio>,
    @InjectRepository(Caja)
    private readonly cajaRepo: Repository<Caja>,
    @InjectRepository(RazonSocial)
    private readonly razonSocialRepo: Repository<RazonSocial>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Admin group (superadmin)
  // ─────────────────────────────────────────────────────────────────────────

  async create(dto: CreateTenantDto, creadorId: string): Promise<Tenant> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Create tenant
      const tenant = manager.create(Tenant, {
        provinciaId: dto.provinciaId,
        nombre: dto.nombre,
        correo: dto.correo,
        telefono: dto.telefono ?? null,
        direccion: dto.direccion ?? null,
        calculoDescuentos: 'base',
      });
      const savedTenant = await manager.save(Tenant, tenant);

      // 2. Create rol Administrador (raw — entidad Rol no existe aún)
      const rolId = randomUUID();
      await manager.query(
        `INSERT INTO roles (rol_id, tenant_id, nombre, descripcion, es_fijo, creado_el, actualizado_el)
         VALUES ($1, $2, 'Administrador', 'Acceso completo', true, NOW(), NOW())`,
        [rolId, savedTenant.id],
      );

      // 3. Create usuarios_tenants
      const usuarioTenant = manager.create(UsuarioTenant, {
        usuarioId: creadorId,
        tenantId: savedTenant.id,
      });
      await manager.save(UsuarioTenant, usuarioTenant);

      // 4. Create roles_usuarios (raw — entidad RolUsuario no existe aún)
      await manager.query(
        `INSERT INTO roles_usuarios (usuario_id, tenant_id, rol_id, creado_el, actualizado_el)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [creadorId, savedTenant.id, rolId],
      );

      // 5. Create tenant_formula_precio (default: descuentos → recargos → impuestos)
      const formula: Partial<TenantFormulaPrecio>[] = [
        { tenantId: savedTenant.id, paso: 1, tipo: 'descuentos' },
        { tenantId: savedTenant.id, paso: 2, tipo: 'recargos' },
        { tenantId: savedTenant.id, paso: 3, tipo: 'impuestos' },
      ];
      for (const row of formula) {
        await manager.save(
          TenantFormulaPrecio,
          manager.create(TenantFormulaPrecio, row),
        );
      }

      // 6. Create caja virtual
      const caja = manager.create(Caja, {
        tenantId: savedTenant.id,
        tipo: 'virtual',
        estado: 'abierta',
        saldoInicial: '0',
      });
      await manager.save(Caja, caja);

      return savedTenant;
    });
  }

  async findAll(): Promise<Tenant[]> {
    return this.tenantRepo.find();
  }

  async findOne(id: string): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${id} no encontrado`);
    }
    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto): Promise<Tenant> {
    const tenant = await this.findOne(id);
    Object.assign(tenant, dto);
    return this.tenantRepo.save(tenant);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.tenantRepo.softDelete({ id });
  }

  async addModule(
    tenantId: string,
    moduloAppId: string,
  ): Promise<TenantModulo> {
    const modulo = this.tenantModuloRepo.create({
      tenantId,
      moduloAppId,
      estado: 'activo',
    });
    return this.tenantModuloRepo.save(modulo);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tenant-active group (authenticated users with tenantId in JWT)
  // ─────────────────────────────────────────────────────────────────────────

  async findMine(tenantId: string): Promise<Tenant> {
    return this.findOne(tenantId);
  }

  async findMembers(tenantId: string): Promise<TenantMember[]> {
    const rows: {
      usuario_id: string;
      nombre: string;
      apellido: string;
      correo: string;
      rol_id: string | null;
      rol_nombre: string | null;
    }[] = await this.dataSource.query(
      `SELECT u.usuario_id,
              u.nombre,
              u.apellido,
              u.correo,
              r.rol_id,
              r.nombre AS rol_nombre
       FROM usuarios_tenants ut
       JOIN usuarios u ON u.usuario_id = ut.usuario_id AND u.eliminado_el IS NULL
       LEFT JOIN roles_usuarios ru ON ru.usuario_id = ut.usuario_id
            AND ru.tenant_id = ut.tenant_id AND ru.eliminado_el IS NULL
       LEFT JOIN roles r ON r.rol_id = ru.rol_id AND r.eliminado_el IS NULL
       WHERE ut.tenant_id = $1
         AND ut.eliminado_el IS NULL
       ORDER BY u.nombre, u.apellido`,
      [tenantId],
    );

    const porUsuario = new Map<string, TenantMember>();
    for (const row of rows) {
      let member = porUsuario.get(row.usuario_id);
      if (!member) {
        member = {
          usuarioId: row.usuario_id,
          nombre: row.nombre,
          apellido: row.apellido,
          correo: row.correo,
          roles: [],
        };
        porUsuario.set(row.usuario_id, member);
      }
      if (row.rol_id && row.rol_nombre) {
        member.roles.push({ rolId: row.rol_id, nombre: row.rol_nombre });
      }
    }

    return [...porUsuario.values()];
  }

  async addMember(tenantId: string, usuarioId: string): Promise<UsuarioTenant> {
    // Idempotent: restore if soft-deleted, create if new
    const existing = await this.usuarioTenantRepo.findOne({
      where: { tenantId, usuarioId },
      withDeleted: true,
    });

    if (existing) {
      if (existing.eliminadoEl) {
        existing.eliminadoEl = null;
        return this.usuarioTenantRepo.save(existing);
      }
      return existing;
    }

    const member = this.usuarioTenantRepo.create({ tenantId, usuarioId });
    return this.usuarioTenantRepo.save(member);
  }

  async removeMember(tenantId: string, usuarioId: string): Promise<void> {
    await this.usuarioTenantRepo.softDelete({ tenantId, usuarioId });
  }

  async findModules(tenantId: string): Promise<TenantModulo[]> {
    return this.tenantModuloRepo.find({ where: { tenantId } });
  }

  async updateMine(tenantId: string, dto: UpdateMyTenantDto): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant)
      throw new NotFoundException(`Tenant ${tenantId} no encontrado`);
    Object.assign(tenant, dto);
    try {
      return await this.tenantRepo.save(tenant);
    } catch (err: unknown) {
      const pg = err as { code?: string };
      if (pg.code === '23505') {
        throw new ConflictException('El correo ya está en uso por otro tenant');
      }
      throw err;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Razones sociales
  // ─────────────────────────────────────────────────────────────────────────

  findRazonesSociales(tenantId: string): Promise<RazonSocial[]> {
    return this.razonSocialRepo.find({
      where: { tenantId },
      order: { nombre: 'ASC' },
    });
  }

  createRazonSocial(
    tenantId: string,
    dto: CreateRazonSocialDto,
  ): Promise<RazonSocial> {
    const rs = this.razonSocialRepo.create({ tenantId, ...dto });
    return this.razonSocialRepo.save(rs);
  }

  async updateRazonSocial(
    tenantId: string,
    id: string,
    dto: UpdateRazonSocialDto,
  ): Promise<RazonSocial> {
    const rs = await this.razonSocialRepo.findOne({
      where: { id, tenantId },
    });
    if (!rs) throw new NotFoundException(`Razón social ${id} no encontrada`);
    if (dto.habilitado === false && rs.preferida) {
      throw new BadRequestException(
        'No se puede deshabilitar la razón social preferida',
      );
    }
    Object.assign(rs, dto);
    return this.razonSocialRepo.save(rs);
  }

  async removeRazonSocial(tenantId: string, id: string): Promise<void> {
    const rs = await this.razonSocialRepo.findOne({
      where: { id, tenantId },
    });
    if (!rs) throw new NotFoundException(`Razón social ${id} no encontrada`);
    await this.razonSocialRepo.softDelete({ id, tenantId });
  }

  async setPreferida(tenantId: string, id: string): Promise<RazonSocial> {
    return this.dataSource.transaction(async (manager) => {
      const rs = await manager.findOne(RazonSocial, {
        where: { id, tenantId },
      });
      if (!rs) throw new NotFoundException(`Razón social ${id} no encontrada`);
      if (!rs.habilitado) {
        throw new BadRequestException(
          'No se puede marcar como preferida una razón social deshabilitada',
        );
      }

      await manager.query(
        `UPDATE razones_sociales SET preferida = false WHERE tenant_id = $1 AND eliminado_el IS NULL`,
        [tenantId],
      );
      await manager.query(
        `UPDATE razones_sociales SET preferida = true WHERE razon_social_id = $1 AND eliminado_el IS NULL`,
        [id],
      );

      rs.preferida = true;
      return rs;
    });
  }
}
