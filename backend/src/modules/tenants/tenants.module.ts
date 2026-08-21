import { Module } from '@nestjs/common';
import { forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Tenant } from './entities/tenant.entity';
import { UsuarioTenant } from './entities/usuario-tenant.entity';
import { TenantModulo } from './entities/tenant-modulo.entity';
import { TenantFormulaPrecio } from './entities/tenant-formula-precio.entity';
import { Caja } from '../caja/entities/caja.entity';
import { RazonSocial } from './entities/razon-social.entity';
import { PropinaConfiguracion } from '../propinas/entities/propina-configuracion.entity';
import { PropinaGrupoDistribucion } from '../propinas/entities/propina-grupo-distribucion.entity';
import { GarzonesModule } from '../garzones/garzones.module';
import { MonedasModule } from '../monedas/monedas.module';
import { TenantsService } from './tenants.service';
import {
  AdminTenantsController,
  TenantsConfirmacionController,
  TenantsController,
} from './tenants.controller';

@Module({
  imports: [
    RepositoriosModule.forFeature([
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
    // Por `MonedasService.decimalesOficiales`: la matriz de preferencias
    // financieras frena `nivelRedondeo = 'documento'` contra la moneda oficial
    // del tenant. `MonedasModule` no importa `TenantsModule` — sin ciclo.
    MonedasModule,
    // Por `TokensAccesoService`: el alta emite la invitación dentro de su
    // propia transacción. `MailService` no se importa — su módulo es `@Global`.
    forwardRef(() => AuthModule),
  ],
  controllers: [
    AdminTenantsController,
    // Antes que `TenantsController` para que las dos rutas públicas se resuelvan
    // sin depender de que aquel nunca gane un `:param` en el primer segmento.
    TenantsConfirmacionController,
    TenantsController,
  ],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
