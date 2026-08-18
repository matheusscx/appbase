import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsuarioTenant } from '../modules/tenants/entities/usuario-tenant.entity';
import { Tenant } from '../modules/tenants/entities/tenant.entity';
import { TenantGuard } from './guards/tenant.guard';
import { SuperadminGuard } from './guards/superadmin.guard';
import { PermisosGuard } from './guards/permisos.guard';
import { TenantAdminGuard } from './guards/tenant-admin.guard';
import { TxContext } from './db/tx-context';
import { Db } from './db/db.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([UsuarioTenant, Tenant])],
  providers: [
    TenantGuard,
    SuperadminGuard,
    PermisosGuard,
    TenantAdminGuard,
    TxContext,
    Db,
  ],
  exports: [
    TenantGuard,
    SuperadminGuard,
    PermisosGuard,
    TenantAdminGuard,
    TxContext,
    Db,
    TypeOrmModule,
  ],
})
export class CommonModule {}
