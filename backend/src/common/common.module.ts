import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsuarioTenant } from '../modules/tenants/entities/usuario-tenant.entity';
import { Tenant } from '../modules/tenants/entities/tenant.entity';
import { TenantGuard } from './guards/tenant.guard';
import { SuperadminGuard } from './guards/superadmin.guard';
import { PermisosGuard } from './guards/permisos.guard';
import { TenantAdminGuard } from './guards/tenant-admin.guard';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([UsuarioTenant, Tenant])],
  providers: [TenantGuard, SuperadminGuard, PermisosGuard, TenantAdminGuard],
  exports: [
    TenantGuard,
    SuperadminGuard,
    PermisosGuard,
    TenantAdminGuard,
    TypeOrmModule,
  ],
})
export class CommonModule {}
