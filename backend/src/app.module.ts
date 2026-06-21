import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { Usuario } from './modules/users/usuario.entity';
import { RefreshToken } from './modules/auth/entities/refresh-token.entity';
import { Pais } from './modules/catalog/entities/pais.entity';
import { Provincia } from './modules/catalog/entities/provincia.entity';
import { Moneda } from './modules/catalog/entities/moneda.entity';
import { ModuloApp } from './modules/catalog/entities/modulo-app.entity';
import { Permiso } from './modules/catalog/entities/permiso.entity';
import { ModuloAppPermiso } from './modules/catalog/entities/modulo-app-permiso.entity';
import { Tenant } from './modules/tenants/entities/tenant.entity';
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
        ],
        synchronize: config.get<string>('NODE_ENV') !== 'production',
      }),
    }),
    SeederModule,
    CatalogModule,
    UsersModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
