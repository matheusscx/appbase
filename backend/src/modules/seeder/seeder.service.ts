import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Moneda } from '../catalog/entities/moneda.entity';
import { Pais } from '../catalog/entities/pais.entity';
import { Provincia } from '../catalog/entities/provincia.entity';
import { ModuloApp } from '../catalog/entities/modulo-app.entity';
import { Permiso } from '../catalog/entities/permiso.entity';
import { ModuloAppPermiso } from '../catalog/entities/modulo-app-permiso.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
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
    @InjectRepository(Usuario)
    private readonly usuarioRepo: Repository<Usuario>,
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

    // TODO Fase 3: seed tenant_modulos + tenant_formula_precio
    // TODO Fase 3: seed usuarios_tenants + roles_usuarios

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

  private async seedTenants(): Promise<void> {
    const tenantId = '550e8400-e29b-41d4-a716-446655440007';
    const exists = await this.tenantRepo.findOne({ where: { tenantId } });

    if (!exists) {
      await this.tenantRepo.save(
        this.tenantRepo.create({
          tenantId,
          provinciaId: '550e8400-e29b-41d4-a716-446655440001',
          nombre: 'Paris',
          correo: 'contacto@paris.cl',
          telefono: '+56226005000',
          direccion: 'Av. Presidente Kennedy 9001, Las Condes, Santiago',
          calculoDescuentos: 'base',
        }),
      );
    }
  }
}
