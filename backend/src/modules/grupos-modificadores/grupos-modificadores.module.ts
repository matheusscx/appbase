import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { GrupoModificador } from './entities/grupo-modificador.entity';
import { GrupoModificadorOpcion } from './entities/grupo-modificador-opcion.entity';
import { GruposModificadoresService } from './grupos-modificadores.service';
import { GruposModificadoresController } from './grupos-modificadores.controller';
import { CatalogModule } from '../catalog/catalog.module';
import { MonedasModule } from '../monedas/monedas.module';

@Module({
  imports: [
    RepositoriosModule.forFeature([GrupoModificador, GrupoModificadorOpcion]),
    CatalogModule,
    // `EscalaMonedaPipe` resuelve `MonedasService` desde los injectables de
    // ESTE módulo: sin este import el @Body del controller falla en runtime.
    MonedasModule,
  ],
  controllers: [GruposModificadoresController],
  providers: [GruposModificadoresService],
  exports: [GruposModificadoresService],
})
export class GruposModificadoresModule {}
