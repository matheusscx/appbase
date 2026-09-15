import { Module } from '@nestjs/common';
import { MermasController } from './mermas.controller';
import { MermasService } from './mermas.service';
import { MotivosBajaModule } from '../motivos-baja/motivos-baja.module';
import { InventarioModule } from '../inventario/inventario.module';
import { CatalogModule } from '../catalog/catalog.module';
import { MonedasModule } from '../monedas/monedas.module';
import { UbicacionesModule } from '../ubicaciones/ubicaciones.module';

@Module({
  imports: [
    MotivosBajaModule,
    InventarioModule,
    CatalogModule,
    // `EscalaMonedaPipe` resuelve `MonedasService` desde los injectables de
    // ESTE módulo: sin este import el @Body del controller falla en runtime.
    MonedasModule,
    // `registrar` resuelve el local del tenant (`UbicacionesService.localDe`)
    // para pasarle `ubicacionId` al chokepoint de `registrarMovimiento`.
    UbicacionesModule,
  ],
  controllers: [MermasController],
  providers: [MermasService],
  exports: [MermasService],
})
export class MermasModule {}
