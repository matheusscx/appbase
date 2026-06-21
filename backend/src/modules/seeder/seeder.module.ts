import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeederService } from './seeder.service';
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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Moneda,
      Pais,
      Provincia,
      ModuloApp,
      Permiso,
      ModuloAppPermiso,
      Tenant,
      TenantModulo,
      TenantFormulaPrecio,
      Usuario,
    ]),
  ],
  providers: [SeederService],
})
export class SeederModule {}
