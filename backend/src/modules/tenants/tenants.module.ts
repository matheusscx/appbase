import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './entities/tenant.entity';
import { UsuarioTenant } from './entities/usuario-tenant.entity';
import { TenantModulo } from './entities/tenant-modulo.entity';
import { TenantFormulaPrecio } from './entities/tenant-formula-precio.entity';
import { Caja } from '../caja/entities/caja.entity';
import { RazonSocial } from './entities/razon-social.entity';
import { PropinaConfiguracion } from '../propinas/entities/propina-configuracion.entity';
import { PropinaGrupoDistribucion } from '../propinas/entities/propina-grupo-distribucion.entity';
import { GarzonesModule } from '../garzones/garzones.module';
import { TenantsService } from './tenants.service';
import {
  AdminTenantsController,
  TenantsController,
} from './tenants.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tenant,
      UsuarioTenant,
      TenantModulo,
      TenantFormulaPrecio,
      Caja,
      RazonSocial,
      PropinaConfiguracion,
      PropinaGrupoDistribucion,
    ]),
    GarzonesModule,
  ],
  controllers: [AdminTenantsController, TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
