import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonModule } from './common/common.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { RolesModule } from './modules/roles/roles.module';
import { TestModule } from './modules/test/test.module';
import { MeModule } from './modules/me/me.module';
import { Usuario } from './modules/users/usuario.entity';
import { RefreshToken } from './modules/auth/entities/refresh-token.entity';
import { Pais } from './modules/catalog/entities/pais.entity';
import { Provincia } from './modules/catalog/entities/provincia.entity';
import { Moneda } from './modules/catalog/entities/moneda.entity';
import { ModuloApp } from './modules/catalog/entities/modulo-app.entity';
import { Permiso } from './modules/catalog/entities/permiso.entity';
import { ModuloAppPermiso } from './modules/catalog/entities/modulo-app-permiso.entity';
import { Tenant } from './modules/tenants/entities/tenant.entity';
import { UsuarioTenant } from './modules/tenants/entities/usuario-tenant.entity';
import { TenantModulo } from './modules/tenants/entities/tenant-modulo.entity';
import { TenantFormulaPrecio } from './modules/tenants/entities/tenant-formula-precio.entity';
import { Caja } from './modules/tenants/entities/caja.entity';
import { RazonSocial } from './modules/tenants/entities/razon-social.entity';
import { Rol } from './modules/roles/entities/rol.entity';
import { RolUsuario } from './modules/roles/entities/rol-usuario.entity';
import { ModuloRol } from './modules/roles/entities/modulo-rol.entity';
import { RolPermisoModulo } from './modules/roles/entities/rol-permiso-modulo.entity';
import { TenantMoneda } from './modules/monedas/entities/tenant-moneda.entity';
import { PaisMoneda } from './modules/monedas/entities/pais-moneda.entity';
import { MonedasModule } from './modules/monedas/monedas.module';
import { SeederModule } from './modules/seeder/seeder.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        // dev: schema managed by TypeORM synchronize; prod: use migrations
        entities: [
          Usuario,
          RefreshToken,
          Pais,
          Provincia,
          Moneda,
          ModuloApp,
          Permiso,
          ModuloAppPermiso,
          Tenant,
          UsuarioTenant,
          TenantModulo,
          TenantFormulaPrecio,
          Caja,
          RazonSocial,
          Rol,
          RolUsuario,
          ModuloRol,
          RolPermisoModulo,
          TenantMoneda,
          PaisMoneda,
        ],
        synchronize: config.get<string>('NODE_ENV') !== 'production',
      }),
    }),
    SeederModule,
    CommonModule,
    CatalogModule,
    UsersModule,
    AuthModule,
    TenantsModule,
    RbacModule,
    RolesModule,
    TestModule,
    MeModule,
    MonedasModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
