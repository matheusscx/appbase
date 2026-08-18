import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { GrupoModificador } from './entities/grupo-modificador.entity';
import { GrupoModificadorOpcion } from './entities/grupo-modificador-opcion.entity';
import { GruposModificadoresService } from './grupos-modificadores.service';
import { GruposModificadoresController } from './grupos-modificadores.controller';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [
    RepositoriosModule.forFeature([GrupoModificador, GrupoModificadorOpcion]),
    CatalogModule,
  ],
  controllers: [GruposModificadoresController],
  providers: [GruposModificadoresService],
  exports: [GruposModificadoresService],
})
export class GruposModificadoresModule {}
