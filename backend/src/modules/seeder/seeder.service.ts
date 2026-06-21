import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Moneda } from '../catalog/entities/moneda.entity';
import { Pais } from '../catalog/entities/pais.entity';
import { Provincia } from '../catalog/entities/provincia.entity';
import { ModuloApp } from '../catalog/entities/modulo-app.entity';
import { Permiso } from '../catalog/entities/permiso.entity';
import { ModuloAppPermiso } from '../catalog/entities/modulo-app-permiso.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantModulo } from '../tenants/entities/tenant-modulo.entity';
import { TenantFormulaPrecio } from '../tenants/entities/tenant-formula-precio.entity';
import { Usuario } from '../users/usuario.entity';

@Injectable()
export class SeederService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeederService.name);

  constructor(
    @InjectRepository(Moneda)
    private readonly monedaRepo: Repository<Moneda>,
    @InjectRepository(Pais)
    private readonly paisRepo: Repository<Pais>,
    @InjectRepository(Provincia)
    private readonly provinciaRepo: Repository<Provincia>,
    @InjectRepository(ModuloApp)
    private readonly moduloAppRepo: Repository<ModuloApp>,
    @InjectRepository(Permiso)
    private readonly permisoRepo: Repository<Permiso>,
    @InjectRepository(ModuloAppPermiso)
    private readonly moduloAppPermisoRepo: Repository<ModuloAppPermiso>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(TenantModulo)
    private readonly tenantModuloRepo: Repository<TenantModulo>,
    @InjectRepository(TenantFormulaPrecio)
    private readonly tenantFormulaPrecioRepo: Repository<TenantFormulaPrecio>,
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    this.logger.log('Running dev seed...');

    await this.seedMonedas();
    await this.seedPais();
    await this.seedProvincias();
    await this.seedModulosApp();
    await this.seedPermisos();
    await this.seedModuloAppPermisos();
    await this.seedTenants();
    await this.seedUsuarioAdmin();
    await this.seedUsuariosAdicionales();
    await this.seedTenantModulo();
    await this.seedTenantFormulaPrecio();
    await this.seedUsuariosTenants();
    await this.seedRolesUsuarios();
    await this.seedVendedorPermisosTest();

    this.logger.log('Seed complete.');
  }

  private async seedMonedas(): Promise<void> {
    const monedas: Partial<Moneda>[] = [
      {
        monedaId: '550e8400-e29b-41d4-a716-446655440003',
        nombre: 'Peso Chileno',
        codigoIso: 'CLP',
        codigoNumero: '152',
        simbolo: '$',
        decimales: 0,
      },
      {
        monedaId: '550e8400-e29b-41d4-a716-446655440004',
        nombre: 'Unidad de Fomento',
        codigoIso: 'UF',
        codigoNumero: '990',
        simbolo: '$',
        decimales: 4,
      },
      {
        monedaId: '550e8400-e29b-41d4-a716-446655440005',
        nombre: 'Dólar Estadounidense',
        codigoIso: 'USD',
        codigoNumero: '840',
        simbolo: '$',
        decimales: 2,
      },
    ];

    for (const data of monedas) {
      const exists = await this.monedaRepo.findOne({
        where: { monedaId: data.monedaId },
      });
      if (!exists) {
        await this.monedaRepo.save(this.monedaRepo.create(data));
      }
    }
  }

  private async seedPais(): Promise<void> {
    const paisId = '550e8400-e29b-41d4-a716-446655440000';
    let pais = await this.paisRepo.findOne({ where: { paisId } });

    if (!pais) {
      pais = this.paisRepo.create({
        paisId,
        nombre: 'Chile',
        codigoIso: 'CL',
        zonaHorariaPrincipal: 'America/Santiago',
        monedaOficialId: null,
      });
      await this.paisRepo.save(pais);
    }

    // Siempre asegurar que monedaOficialId quede seteado
    await this.paisRepo.update(
      { paisId },
      { monedaOficialId: '550e8400-e29b-41d4-a716-446655440003' },
    );
  }

  private async seedProvincias(): Promise<void> {
    const provincias: Partial<Provincia>[] = [
      {
        provinciaId: '550e8400-e29b-41d4-a716-446655440001',
        paisId: '550e8400-e29b-41d4-a716-446655440000',
        nombre: 'Región Metropolitana',
        zonaHoraria: 'America/Santiago',
      },
      {
        provinciaId: '550e8400-e29b-41d4-a716-446655440002',
        paisId: '550e8400-e29b-41d4-a716-446655440000',
        nombre: 'Isla de Pascua',
        zonaHoraria: 'Pacific/Easter',
      },
    ];

    for (const data of provincias) {
      const exists = await this.provinciaRepo.findOne({
        where: { provinciaId: data.provinciaId },
      });
      if (!exists) {
        await this.provinciaRepo.save(this.provinciaRepo.create(data));
      }
    }
  }

  private async seedModulosApp(): Promise<void> {
    const modulos: Partial<ModuloApp>[] = [
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440010',
        nombre: 'Facturación',
        url: '/facturacion',
        icono: 'mdi-file-document-multiple-outline',
        tieneConfiguracion: false,
      },
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440011',
        nombre: 'Caja',
        url: '/caja',
        icono: 'mdi-cash-register',
        tieneConfiguracion: false,
      },
      {
        moduloAppId: '550e8400-e29b-41d4-a716-446655440050',
        nombre: 'Test',
        url: '/test',
        icono: 'mdi-test-tube',
        tieneConfiguracion: false,
      },
    ];

    for (const data of modulos) {
      const exists = await this.moduloAppRepo.findOne({
        where: { moduloAppId: data.moduloAppId },
      });
      if (!exists) {
        await this.moduloAppRepo.save(this.moduloAppRepo.create(data));
      }
    }
  }

  private async seedPermisos(): Promise<void> {
    const permisos: Partial<Permiso>[] = [
      { permisoId: '550e8400-e29b-41d4-a716-446655440012', nombre: 'Leer' },
      { permisoId: '550e8400-e29b-41d4-a716-446655440013', nombre: 'Crear' },
      {
        permisoId: '550e8400-e29b-41d4-a716-446655440014',
        nombre: 'Actualizar',
      },
      {
        permisoId: '550e8400-e29b-41d4-a716-446655440015',
        nombre: 'Eliminar',
      },
    ];

    for (const data of permisos) {
      const exists = await this.permisoRepo.findOne({
        where: { permisoId: data.permisoId },
      });
      if (!exists) {
        await this.permisoRepo.save(this.permisoRepo.create(data));
      }
    }
  }

  private async seedModuloAppPermisos(): Promise<void> {
    const FACTURACION = '550e8400-e29b-41d4-a716-446655440010';
    const CAJA = '550e8400-e29b-41d4-a716-446655440011';
    const TEST = '550e8400-e29b-41d4-a716-446655440050';
    const LEER = '550e8400-e29b-41d4-a716-446655440012';
    const CREAR = '550e8400-e29b-41d4-a716-446655440013';
    const ACTUALIZAR = '550e8400-e29b-41d4-a716-446655440014';
    const ELIMINAR = '550e8400-e29b-41d4-a716-446655440015';

    const entries: Partial<ModuloAppPermiso>[] = [
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440030',
        moduloAppId: FACTURACION,
        permisoId: LEER,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440031',
        moduloAppId: FACTURACION,
        permisoId: CREAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440032',
        moduloAppId: FACTURACION,
        permisoId: ACTUALIZAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440033',
        moduloAppId: FACTURACION,
        permisoId: ELIMINAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440034',
        moduloAppId: CAJA,
        permisoId: LEER,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440035',
        moduloAppId: CAJA,
        permisoId: CREAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440036',
        moduloAppId: CAJA,
        permisoId: ACTUALIZAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440037',
        moduloAppId: CAJA,
        permisoId: ELIMINAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440051',
        moduloAppId: TEST,
        permisoId: LEER,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440052',
        moduloAppId: TEST,
        permisoId: CREAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440053',
        moduloAppId: TEST,
        permisoId: ACTUALIZAR,
      },
      {
        moduloAppPermisoId: '550e8400-e29b-41d4-a716-446655440054',
        moduloAppId: TEST,
        permisoId: ELIMINAR,
      },
    ];

    for (const data of entries) {
      const exists = await this.moduloAppPermisoRepo.findOne({
        where: { moduloAppPermisoId: data.moduloAppPermisoId },
      });
      if (!exists) {
        await this.moduloAppPermisoRepo.save(
          this.moduloAppPermisoRepo.create(data),
        );
      }
    }
  }

  private async seedUsuarioAdmin(): Promise<void> {
    const correo = 'admin@sistema.com';
    const exists = await this.usuarioRepo.findOne({ where: { correo } });
    if (!exists) {
      await this.usuarioRepo.save(
        this.usuarioRepo.create({
          id: '550e8400-e29b-41d4-a716-446655440019',
          nombreUsuario: 'admin',
          contrasena:
            '$2b$10$3G96idl/t9r9MspBYfSG0emDgoeSpmBRiW0yHlrUwkImlhXmuI1qW',
          nombre: 'Admin',
          apellido: 'Sistema',
          telefono: '123456789',
          correo,
          esSuperadmin: true,
        }),
      );
    }
  }

  private async seedUsuariosAdicionales(): Promise<void> {
    // Dev seed password: 'admin' (mismo que admin@sistema.com)
    const HASH = '$2b$10$3G96idl/t9r9MspBYfSG0emDgoeSpmBRiW0yHlrUwkImlhXmuI1qW';

    const usuarios = [
      {
        id: '550e8400-e29b-41d4-a716-446655440044',
        nombreUsuario: 'admin.paris',
        contrasena: HASH,
        nombre: 'Admin',
        apellido: 'Paris',
        telefono: '987654321',
        correo: 'admin.paris@paris.cl',
        esSuperadmin: false,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440045',
        nombreUsuario: 'vendedor.paris',
        contrasena: HASH,
        nombre: 'Vendedor',
        apellido: 'Paris',
        telefono: '987654322',
        correo: 'vendedor@paris.cl',
        esSuperadmin: false,
      },
    ];

    for (const data of usuarios) {
      const exists = await this.usuarioRepo.findOne({
        where: { correo: data.correo },
      });
      if (!exists) {
        await this.usuarioRepo.save(this.usuarioRepo.create(data));
      }
    }
  }

  private async seedTenants(): Promise<void> {
    const tenants: Array<{
      id: string;
      provinciaId: string;
      nombre: string;
      correo: string;
      telefono: string;
      direccion: string;
    }> = [
      {
        id: '550e8400-e29b-41d4-a716-446655440007',
        provinciaId: '550e8400-e29b-41d4-a716-446655440001',
        nombre: 'Paris',
        correo: 'contacto@paris.cl',
        telefono: '+56226005000',
        direccion: 'Av. Presidente Kennedy 9001, Las Condes, Santiago',
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440040',
        provinciaId: '550e8400-e29b-41d4-a716-446655440001',
        nombre: 'Falabella',
        correo: 'contacto@falabella.cl',
        telefono: '+56226007000',
        direccion: 'Av. Presidente Kennedy 6400, Las Condes, Santiago',
      },
    ];

    for (const data of tenants) {
      const exists = await this.tenantRepo.findOne({ where: { id: data.id } });
      if (!exists) {
        await this.tenantRepo.save(
          this.tenantRepo.create({ ...data, calculoDescuentos: 'base' }),
        );
      }
    }
  }

  private async seedTenantModulo(): Promise<void> {
    const entries: Partial<TenantModulo>[] = [
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440023',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440011', // Paris → Caja
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440055',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440050', // Paris → Test
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440042',
        tenantId: '550e8400-e29b-41d4-a716-446655440040',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440010', // Falabella → Facturación
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
      {
        moduloTenantId: '550e8400-e29b-41d4-a716-446655440043',
        tenantId: '550e8400-e29b-41d4-a716-446655440040',
        moduloAppId: '550e8400-e29b-41d4-a716-446655440011', // Falabella → Caja
        estado: 'activo',
        expiraEn: new Date('2026-12-31T23:59:59Z'),
      },
    ];

    for (const data of entries) {
      const exists = await this.tenantModuloRepo.findOne({
        where: { moduloTenantId: data.moduloTenantId },
      });
      if (!exists) {
        await this.tenantModuloRepo.save(this.tenantModuloRepo.create(data));
      }
    }
  }

  private async seedTenantFormulaPrecio(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const FALABELLA = '550e8400-e29b-41d4-a716-446655440040';

    const formula = [
      { tenantId: PARIS, paso: 1, tipo: 'descuentos' },
      { tenantId: PARIS, paso: 2, tipo: 'recargos' },
      { tenantId: PARIS, paso: 3, tipo: 'impuestos' },
      { tenantId: FALABELLA, paso: 1, tipo: 'descuentos' },
      { tenantId: FALABELLA, paso: 2, tipo: 'recargos' },
      { tenantId: FALABELLA, paso: 3, tipo: 'impuestos' },
    ];

    for (const row of formula) {
      const exists = await this.tenantFormulaPrecioRepo.findOne({
        where: { tenantId: row.tenantId, paso: row.paso },
      });
      if (!exists) {
        await this.tenantFormulaPrecioRepo.save(
          this.tenantFormulaPrecioRepo.create(row),
        );
      }
    }
  }

  private async seedUsuariosTenants(): Promise<void> {
    const ADMIN = '550e8400-e29b-41d4-a716-446655440019';
    const ADMIN_PARIS = '550e8400-e29b-41d4-a716-446655440044';
    const VENDEDOR_PARIS = '550e8400-e29b-41d4-a716-446655440045';
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const FALABELLA = '550e8400-e29b-41d4-a716-446655440040';
    const pairs = [
      [ADMIN, PARIS], // superadmin → Paris
      [ADMIN, FALABELLA], // superadmin → Falabella
      [ADMIN_PARIS, PARIS], // admin tenant → Paris
      [VENDEDOR_PARIS, PARIS], // vendedor → Paris
    ];

    for (const [usuarioId, tenantId] of pairs) {
      await this.dataSource.query(
        `INSERT INTO usuarios_tenants (usuario_id, tenant_id, creado_el, actualizado_el)
         VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [usuarioId, tenantId],
      );
    }
  }

  private async seedRolesUsuarios(): Promise<void> {
    const SUPERADMIN = '550e8400-e29b-41d4-a716-446655440019';
    const ADMIN_PARIS = '550e8400-e29b-41d4-a716-446655440044';
    const VENDEDOR_PARIS = '550e8400-e29b-41d4-a716-446655440045';
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const FALABELLA = '550e8400-e29b-41d4-a716-446655440040';

    // Crear rol Administrador en cada tenant y asignar superadmin + admin.paris en Paris
    const adminRoles = [
      { tenantId: PARIS, rolId: '550e8400-e29b-41d4-a716-446655440018' },
      { tenantId: FALABELLA, rolId: '550e8400-e29b-41d4-a716-446655440041' },
    ];

    for (const { tenantId, rolId } of adminRoles) {
      const existingRol: { rol_id: string }[] = await this.dataSource.query(
        `SELECT rol_id FROM roles WHERE tenant_id = $1 AND nombre = 'Administrador' AND eliminado_el IS NULL`,
        [tenantId],
      );

      if (existingRol.length === 0) {
        await this.dataSource.query(
          `INSERT INTO roles (rol_id, tenant_id, nombre, descripcion, es_fijo, creado_el, actualizado_el)
           VALUES ($1, $2, 'Administrador', 'Acceso completo', true, NOW(), NOW())`,
          [rolId, tenantId],
        );
      }

      const resolvedRolId = existingRol[0]?.rol_id ?? rolId;

      await this.dataSource.query(
        `INSERT INTO roles_usuarios (usuario_id, tenant_id, rol_id, creado_el, actualizado_el)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [SUPERADMIN, tenantId, resolvedRolId],
      );

      // admin.paris también tiene rol Administrador en Paris
      if (tenantId === PARIS) {
        await this.dataSource.query(
          `INSERT INTO roles_usuarios (usuario_id, tenant_id, rol_id, creado_el, actualizado_el)
           VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [ADMIN_PARIS, PARIS, resolvedRolId],
        );
      }
    }

    // Crear rol Vendedor en Paris (no fijo) y asignar a vendedor@paris.cl
    const vendedorRolId = '550e8400-e29b-41d4-a716-446655440046';
    const existingVendedor: { rol_id: string }[] = await this.dataSource.query(
      `SELECT rol_id FROM roles WHERE tenant_id = $1 AND nombre = 'Vendedor' AND eliminado_el IS NULL`,
      [PARIS],
    );

    if (existingVendedor.length === 0) {
      await this.dataSource.query(
        `INSERT INTO roles (rol_id, tenant_id, nombre, descripcion, es_fijo, creado_el, actualizado_el)
         VALUES ($1, $2, 'Vendedor', 'Acceso a ventas y caja', false, NOW(), NOW())`,
        [vendedorRolId, PARIS],
      );
    }

    const resolvedVendedorRolId = existingVendedor[0]?.rol_id ?? vendedorRolId;
    await this.dataSource.query(
      `INSERT INTO roles_usuarios (usuario_id, tenant_id, rol_id, creado_el, actualizado_el)
       VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [VENDEDOR_PARIS, PARIS, resolvedVendedorRolId],
    );
  }

  private async seedVendedorPermisosTest(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const MODULO_TENANT_TEST = '550e8400-e29b-41d4-a716-446655440055';
    const PERMISO_TEST_LEER = '550e8400-e29b-41d4-a716-446655440051';
    const PERMISO_TEST_CREAR = '550e8400-e29b-41d4-a716-446655440052';

    // 1. Resolver el rol_id del rol Vendedor en Paris
    const vendedorRolRows: { rol_id: string }[] = await this.dataSource.query(
      `SELECT rol_id FROM roles WHERE tenant_id = $1 AND nombre = 'Vendedor' AND eliminado_el IS NULL`,
      [PARIS],
    );

    if (vendedorRolRows.length === 0) {
      this.logger.warn(
        'seedVendedorPermisosTest: rol Vendedor not found in Paris, skipping.',
      );
      return;
    }

    const rolId = vendedorRolRows[0].rol_id;

    // 2. Asociar Vendedor al tenant_modulo Test
    await this.dataSource.query(
      `INSERT INTO modulos_roles (rol_id, modulo_tenant_id, creado_el, actualizado_el)
       VALUES ($1, $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [rolId, MODULO_TENANT_TEST],
    );

    // 3. Asignar solo Leer y Crear al Vendedor en el módulo Test
    for (const moduloAppPermisoId of [PERMISO_TEST_LEER, PERMISO_TEST_CREAR]) {
      await this.dataSource.query(
        `INSERT INTO roles_permisos_modulos (rol_id, modulo_tenant_id, modulo_app_permiso_id, creado_el, actualizado_el)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [rolId, MODULO_TENANT_TEST, moduloAppPermisoId],
      );
    }
  }
}
