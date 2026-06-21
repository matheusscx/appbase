import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsuarioTenant } from '../modules/tenants/entities/usuario-tenant.entity';
import { TenantGuard } from './guards/tenant.guard';
import { SuperadminGuard } from './guards/superadmin.guard';
import { PermisosGuard } from './guards/permisos.guard';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([UsuarioTenant])],
  providers: [TenantGuard, SuperadminGuard, PermisosGuard],
  exports: [TenantGuard, SuperadminGuard, PermisosGuard],
})
export class CommonModule {}
