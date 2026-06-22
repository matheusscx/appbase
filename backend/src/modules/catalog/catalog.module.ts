import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModuloApp } from './entities/modulo-app.entity';
import { Permiso } from './entities/permiso.entity';
import { Pais } from './entities/pais.entity';
import { Provincia } from './entities/provincia.entity';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [TypeOrmModule.forFeature([ModuloApp, Permiso, Pais, Provincia])],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
