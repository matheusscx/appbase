import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { GrupoModificador } from './entities/grupo-modificador.entity';
import { GrupoModificadorOpcion } from './entities/grupo-modificador-opcion.entity';
import { GruposModificadoresService } from './grupos-modificadores.service';
import { GruposModificadoresController } from './grupos-modificadores.controller';
import { CatalogModule } from '../catalog/catalog.module';
import { MonedasModule } from '../monedas/monedas.module';
import { ItemsModule } from '../items/items.module';

@Module({
  imports: [
    RepositoriosModule.forFeature([GrupoModificador, GrupoModificadorOpcion]),
    CatalogModule,
    // `EscalaMonedaPipe` resuelve `MonedasService` desde los injectables de
    // ESTE módulo: sin este import el @Body del controller falla en runtime.
    MonedasModule,
    // `cuentasAbiertasConOpcionDeGrupo`: la pregunta "¿hay una mesa que ya
    // eligió esta opción?" vive en `ItemsService` porque es sobre
    // `cuenta_lineas.personalizacion`, el mismo campo y la misma regla que las
    // otras dos puertas. Sin ciclo: `ItemsModule` no conoce a los grupos.
    ItemsModule,
  ],
  controllers: [GruposModificadoresController],
  providers: [GruposModificadoresService],
  exports: [GruposModificadoresService],
})
export class GruposModificadoresModule {}
