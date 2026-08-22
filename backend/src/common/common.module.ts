import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RepositoriosModule } from './db/repositorios.module';
import { UsuarioTenant } from '../modules/tenants/entities/usuario-tenant.entity';
import { Tenant } from '../modules/tenants/entities/tenant.entity';
import { TenantGuard } from './guards/tenant.guard';
import { SuperadminGuard } from './guards/superadmin.guard';
import { PermisosGuard } from './guards/permisos.guard';
import { TenantAdminGuard } from './guards/tenant-admin.guard';
import { TxContext } from './db/tx-context';
import { Db } from './db/db.service';
import { RequestContext } from './context/request-context';
import { SembrarContextoInterceptor } from './interceptors/sembrar-contexto.interceptor';

@Global()
@Module({
  imports: [RepositoriosModule.forFeature([UsuarioTenant, Tenant])],
  providers: [
    TenantGuard,
    SuperadminGuard,
    PermisosGuard,
    TenantAdminGuard,
    TxContext,
    Db,
    RequestContext,
    // Global a propósito: sembrar el contexto por controller dejaría el hueco
    // justo donde alguien agregue un controller nuevo.
    { provide: APP_INTERCEPTOR, useClass: SembrarContextoInterceptor },
  ],
  exports: [
    TenantGuard,
    SuperadminGuard,
    PermisosGuard,
    TenantAdminGuard,
    TxContext,
    Db,
    RequestContext,
    RepositoriosModule,
  ],
})
export class CommonModule {}
