import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { CausaMerma } from './entities/causa-merma.entity';
import { CausasMermaService } from './causas-merma.service';
import { CausasMermaController } from './causas-merma.controller';
import { MermasController } from './mermas.controller';
import { MermasService } from './mermas.service';
import { InventarioModule } from '../inventario/inventario.module';
import { CatalogModule } from '../catalog/catalog.module';
import { MonedasModule } from '../monedas/monedas.module';

@Module({
  imports: [
    RepositoriosModule.forFeature([CausaMerma]),
    InventarioModule,
    CatalogModule,
    // `EscalaMonedaPipe` resuelve `MonedasService` desde los injectables de
    // ESTE módulo: sin este import el @Body del controller falla en runtime.
    MonedasModule,
  ],
  controllers: [CausasMermaController, MermasController],
  providers: [CausasMermaService, MermasService],
  exports: [CausasMermaService, MermasService],
})
export class MermasModule {}
