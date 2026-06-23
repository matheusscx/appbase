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
import { RazonSocial } from '../tenants/entities/razon-social.entity';
import { PaisMoneda } from '../monedas/entities/pais-moneda.entity';
import { TenantMoneda } from '../monedas/entities/tenant-moneda.entity';
import { MetodoPago } from '../metodos-pago/entities/metodo-pago.entity';
import { MetodoPagoPais } from '../metodos-pago/entities/metodo-pago-pais.entity';
import { TenantMetodoPago } from '../metodos-pago/entities/tenant-metodo-pago.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { Categoria } from '../categorias/entities/categoria.entity';
import { Impuesto } from '../impuestos/entities/impuesto.entity';
import { Descuento } from '../descuentos/entities/descuento.entity';
import { Recargo } from '../recargos/entities/recargo.entity';
import { ModoRegla, CondicionTipo } from '../../common/enums/reglas.enums';

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
    @InjectRepository(RazonSocial)
    private readonly razonSocialRepo: Repository<RazonSocial>,
    @InjectRepository(PaisMoneda)
    private readonly paisMonedaRepo: Repository<PaisMoneda>,
    @InjectRepository(TenantMoneda)
    private readonly tenantMonedaRepo: Repository<TenantMoneda>,
    @InjectRepository(MetodoPago)
    private readonly metodoPagoRepo: Repository<MetodoPago>,
    @InjectRepository(MetodoPagoPais)
    private readonly metodoPagoPaisRepo: Repository<MetodoPagoPais>,
    @InjectRepository(TenantMetodoPago)
    private readonly tenantMetodoPagoRepo: Repository<TenantMetodoPago>,
    @InjectRepository(TipoRegla)
    private readonly tipoReglaRepo: Repository<TipoRegla>,
    @InjectRepository(Categoria)
    private readonly categoriaRepo: Repository<Categoria>,
    @InjectRepository(Impuesto)
    private readonly impuestoRepo: Repository<Impuesto>,
    @InjectRepository(Descuento)
    private readonly descuentoRepo: Repository<Descuento>,
    @InjectRepository(Recargo)
    private readonly recargoRepo: Repository<Recargo>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      return;
    }

    this.logger.log('Running dev seed...');

    await this.seedMonedas();
    await this.seedMetodosPago();
    await this.seedTiposRegla();
    await this.seedPais();
    await this.seedPaisMonedas();
    await this.seedMetodoPagoPais();
    await this.seedProvincias();
    await this.seedModulosApp();
    await this.seedPermisos();
    await this.seedModuloAppPermisos();
    await this.seedTenants();
    await this.seedTenantMonedas();
    await this.seedTenantMetodosPago();
    await this.seedCategorias();
    await this.seedImpuestos();
    await this.seedDescuentos();
    await this.seedRecargos();
    await this.seedItems();
    await this.seedRazonesSociales();
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

  private async seedPaisMonedas(): Promise<void> {
    const CHILE = '550e8400-e29b-41d4-a716-446655440000';
    const monedaIds = [
      '550e8400-e29b-41d4-a716-446655440003', // CLP
      '550e8400-e29b-41d4-a716-446655440004', // UF
      '550e8400-e29b-41d4-a716-446655440005', // USD
    ];

    for (const monedaId of monedaIds) {
      const exists = await this.paisMonedaRepo.findOne({
        where: { paisId: CHILE, monedaId },
      });
      if (!exists) {
        await this.paisMonedaRepo.save(
          this.paisMonedaRepo.create({ paisId: CHILE, monedaId }),
        );
      }
    }
  }

  private async seedTenantMonedas(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const FALABELLA = '550e8400-e29b-41d4-a716-446655440040';
    const CLP = '550e8400-e29b-41d4-a716-446655440003';
    const USD = '550e8400-e29b-41d4-a716-446655440005';

    const entries: Partial<TenantMoneda>[] = [];
    for (const tenantId of [PARIS, FALABELLA]) {
      entries.push(
        {
          tenantId,
          monedaId: CLP,
          esDefault: true,
          habilitada: true,
          valorDelDia: '1',
        },
        {
          tenantId,
          monedaId: USD,
          esDefault: false,
          habilitada: true,
          valorDelDia: '950',
        },
      );
    }

    for (const data of entries) {
      const exists = await this.tenantMonedaRepo.findOne({
        where: { tenantId: data.tenantId, monedaId: data.monedaId },
      });
      if (!exists) {
        await this.tenantMonedaRepo.save(this.tenantMonedaRepo.create(data));
      }
    }
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
        `INSERT INTO roles_permisos_modulos (rol_id, modulo_tenant_id, modulo_app_permiso_id)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [rolId, MODULO_TENANT_TEST, moduloAppPermisoId],
      );
    }
  }

  private async seedMetodosPago(): Promise<void> {
    const metodos: Partial<MetodoPago>[] = [
      {
        metodoPagoId: '550e8400-e29b-41d4-a716-446655440105',
        nombre: 'Efectivo',
        abreviatura: 'EFE',
        activo: true,
      },
      {
        metodoPagoId: '550e8400-e29b-41d4-a716-446655440106',
        nombre: 'Tarjeta de débito',
        abreviatura: 'TDB',
        activo: true,
      },
      {
        metodoPagoId: '550e8400-e29b-41d4-a716-446655440107',
        nombre: 'Tarjeta de crédito',
        abreviatura: 'TDC',
        activo: true,
      },
      {
        metodoPagoId: '550e8400-e29b-41d4-a716-446655440108',
        nombre: 'Transferencia bancaria',
        abreviatura: 'TRF',
        activo: true,
      },
    ];

    for (const data of metodos) {
      const exists = await this.metodoPagoRepo.findOne({
        where: { metodoPagoId: data.metodoPagoId },
      });
      if (!exists) {
        await this.metodoPagoRepo.save(this.metodoPagoRepo.create(data));
      }
    }
  }

  private async seedTiposRegla(): Promise<void> {
    const tipos: Partial<TipoRegla>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440100',
        clase: 'descuento',
        codigo: 'pronto_pago',
        nombre: 'Pronto pago',
        descripcion: 'Descuento por pago anticipado o al contado',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440101',
        clase: 'descuento',
        codigo: 'por_mayor',
        nombre: 'Al por mayor',
        descripcion: 'Descuento por compra de grandes volúmenes',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440102',
        clase: 'descuento',
        codigo: 'rango_fechas',
        nombre: 'Rango de fechas',
        descripcion: 'Descuento vigente entre fechas específicas',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440103',
        clase: 'recargo',
        codigo: 'interes_simple',
        nombre: 'Interés simple',
        descripcion: 'Recargo por cuotas con interés simple',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440104',
        clase: 'recargo',
        codigo: 'interes_compuesto',
        nombre: 'Interés compuesto',
        descripcion: 'Recargo por cuotas con interés compuesto',
        activo: true,
      },
    ];

    for (const data of tipos) {
      const exists = await this.tipoReglaRepo.findOne({
        where: { id: data.id },
      });
      if (!exists) {
        await this.tipoReglaRepo.save(this.tipoReglaRepo.create(data));
      }
    }
  }

  private async seedMetodoPagoPais(): Promise<void> {
    const CHILE = '550e8400-e29b-41d4-a716-446655440000';
    const metodoPagoIds = [
      '550e8400-e29b-41d4-a716-446655440105', // Efectivo
      '550e8400-e29b-41d4-a716-446655440106', // Tarjeta débito
      '550e8400-e29b-41d4-a716-446655440107', // Tarjeta crédito
      '550e8400-e29b-41d4-a716-446655440108', // Transferencia
    ];

    for (const metodoPagoId of metodoPagoIds) {
      const exists = await this.metodoPagoPaisRepo.findOne({
        where: { paisId: CHILE, metodoPagoId },
      });
      if (!exists) {
        await this.metodoPagoPaisRepo.save(
          this.metodoPagoPaisRepo.create({ paisId: CHILE, metodoPagoId }),
        );
      }
    }
  }

  private async seedTenantMetodosPago(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const FALABELLA = '550e8400-e29b-41d4-a716-446655440040';
    const metodoPagoIds = [
      '550e8400-e29b-41d4-a716-446655440105',
      '550e8400-e29b-41d4-a716-446655440106',
      '550e8400-e29b-41d4-a716-446655440107',
      '550e8400-e29b-41d4-a716-446655440108',
    ];

    for (const tenantId of [PARIS, FALABELLA]) {
      for (const metodoPagoId of metodoPagoIds) {
        const exists = await this.tenantMetodoPagoRepo.findOne({
          where: { tenantId, metodoPagoId },
        });
        if (!exists) {
          await this.tenantMetodoPagoRepo.save(
            this.tenantMetodoPagoRepo.create({
              tenantId,
              metodoPagoId,
              habilitada: true,
              permiteVuelto:
                metodoPagoId === '550e8400-e29b-41d4-a716-446655440105', // solo efectivo
            }),
          );
        }
      }
    }
  }

  private async seedCategorias(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const categorias: Partial<Categoria>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440110',
        tenantId: PARIS,
        nombre: 'Electrónica',
        aplicaA: 'productos',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440111',
        tenantId: PARIS,
        nombre: 'Ropa y accesorios',
        aplicaA: 'ambos',
        activo: true,
      },
    ];

    for (const data of categorias) {
      const exists = await this.categoriaRepo.findOne({
        where: { id: data.id },
      });
      if (!exists) {
        await this.categoriaRepo.save(this.categoriaRepo.create(data));
      }
    }
  }

  private async seedImpuestos(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const FALABELLA = '550e8400-e29b-41d4-a716-446655440040';
    const impuestos: Partial<Impuesto>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440112',
        tenantId: PARIS,
        nombre: 'IVA 19%',
        porcentaje: '0.19',
        activo: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440113',
        tenantId: FALABELLA,
        nombre: 'IVA 19%',
        porcentaje: '0.19',
        activo: true,
      },
    ];

    for (const data of impuestos) {
      const exists = await this.impuestoRepo.findOne({
        where: { id: data.id },
      });
      if (!exists) {
        await this.impuestoRepo.save(this.impuestoRepo.create(data));
      }
    }
  }

  private async seedDescuentos(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const TIPO_PRONTO_PAGO = '550e8400-e29b-41d4-a716-446655440100';
    const descuentos: Partial<Descuento>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440114',
        tenantId: PARIS,
        tipoReglaId: TIPO_PRONTO_PAGO,
        nombre: 'Descuento pronto pago 10%',
        modo: ModoRegla.PORCENTAJE,
        valor: '0.10',
        condicionTipo: CondicionTipo.NINGUNA,
        activo: true,
      },
    ];

    for (const data of descuentos) {
      const exists = await this.descuentoRepo.findOne({
        where: { id: data.id },
      });
      if (!exists) {
        await this.descuentoRepo.save(this.descuentoRepo.create(data));
      }
    }
  }

  private async seedRecargos(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const TIPO_INTERES_SIMPLE = '550e8400-e29b-41d4-a716-446655440103';
    const recargos: Partial<Recargo>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440115',
        tenantId: PARIS,
        tipoReglaId: TIPO_INTERES_SIMPLE,
        nombre: 'Interés cuotas 5%',
        modo: ModoRegla.PORCENTAJE,
        valor: '0.05',
        condicionTipo: CondicionTipo.NINGUNA,
        activo: true,
      },
    ];

    for (const data of recargos) {
      const exists = await this.recargoRepo.findOne({
        where: { id: data.id },
      });
      if (!exists) {
        await this.recargoRepo.save(this.recargoRepo.create(data));
      }
    }
  }

  private async seedItems(): Promise<void> {
    const PARIS = '550e8400-e29b-41d4-a716-446655440007';
    const CLP = '550e8400-e29b-41d4-a716-446655440003';
    const ELECTRONICA = '550e8400-e29b-41d4-a716-446655440110';
    const IVA_19 = '550e8400-e29b-41d4-a716-446655440113';
    const ITEM_SMARTPHONE = '550e8400-e29b-41d4-a716-446655440116';
    const ITEM_SOPORTE = '550e8400-e29b-41d4-a716-446655440117';

    const existsSmartphone: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM items WHERE item_id = $1`,
      [ITEM_SMARTPHONE],
    );
    if (!existsSmartphone.length) {
      await this.dataSource.query(
        `INSERT INTO items (item_id, tenant_id, moneda_id, categoria_id, nombre, descripcion,
                            precio_base, precio_incluye_impuesto, activo, tipo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          ITEM_SMARTPHONE,
          PARIS,
          CLP,
          ELECTRONICA,
          'Smartphone Samsung Galaxy S24',
          'Teléfono inteligente de alta gama con pantalla AMOLED 6.2"',
          '899000',
          false,
          true,
          'producto',
        ],
      );
      // item_producto arranca en 0; el saldo se materializa con el movimiento inicial
      await this.dataSource.query(
        `INSERT INTO item_producto (item_id, stock, unidad_medida) VALUES ($1,$2,$3)`,
        [ITEM_SMARTPHONE, '0', 'unidad'],
      );
      await this.dataSource.query(
        `INSERT INTO item_impuestos (item_id, impuesto_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [ITEM_SMARTPHONE, IVA_19],
      );

      // Movimiento inventario_inicial (idempotente por el guard existsSmartphone)
      await this.dataSource.query(
        `UPDATE item_producto SET stock = $1 WHERE item_id = $2`,
        ['25', ITEM_SMARTPHONE],
      );
      await this.dataSource.query(
        `INSERT INTO movimientos_inventario
           (movimiento_id, tenant_id, item_id, tipo, motivo, cantidad,
            stock_anterior, stock_resultante, comentario)
         VALUES ($1,$2,$3,'entrada','inventario_inicial','25','0','25','Stock inicial (seed)')`,
        [
          '550e8400-e29b-41d4-a716-446655440120', // ID fijo libre (rango items 110-117)
          PARIS,
          ITEM_SMARTPHONE,
        ],
      );
    }

    const existsSoporte: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM items WHERE item_id = $1`,
      [ITEM_SOPORTE],
    );
    if (!existsSoporte.length) {
      await this.dataSource.query(
        `INSERT INTO items (item_id, tenant_id, moneda_id, nombre, descripcion,
                            precio_base, precio_incluye_impuesto, activo, tipo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          ITEM_SOPORTE,
          PARIS,
          CLP,
          'Soporte técnico premium',
          'Soporte técnico en sitio para equipos tecnológicos',
          '45000',
          false,
          true,
          'servicio',
        ],
      );
      await this.dataSource.query(
        `INSERT INTO item_servicio (item_id, duracion_estimada, requiere_cita) VALUES ($1,$2,$3)`,
        [ITEM_SOPORTE, 60, true],
      );
    }
  }

  private async seedRazonesSociales(): Promise<void> {
    const razones: Partial<RazonSocial>[] = [
      {
        id: '550e8400-e29b-41d4-a716-446655440056',
        tenantId: '550e8400-e29b-41d4-a716-446655440007',
        nombre: 'Paris S.A.',
        rut: '76.123.456-7',
        direccion: 'Av. Presidente Kennedy 9001, Las Condes',
        telefono: '+56226005000',
        habilitado: true,
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440057',
        tenantId: '550e8400-e29b-41d4-a716-446655440040',
        nombre: 'Falabella Retail S.A.',
        rut: '96.654.390-9',
        direccion: 'Av. Presidente Kennedy 6400, Las Condes',
        telefono: '+56226007000',
        habilitado: true,
      },
    ];

    for (const data of razones) {
      const exists = await this.razonSocialRepo.findOne({
        where: { id: data.id },
      });
      if (!exists) {
        await this.razonSocialRepo.save(this.razonSocialRepo.create(data));
      }
    }
  }
}
