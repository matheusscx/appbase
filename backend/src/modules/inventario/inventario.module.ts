import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { MovimientoInventario } from './entities/movimiento-inventario.entity';
import { MovimientoInventarioDetalle } from './entities/movimiento-inventario-detalle.entity';
import { InventarioService } from './inventario.service';
import { InventarioController } from './inventario.controller';
import { MonedasModule } from '../monedas/monedas.module';
import { CatalogModule } from '../catalog/catalog.module';
import { UbicacionesModule } from '../ubicaciones/ubicaciones.module';

@Module({
  imports: [
    RepositoriosModule.forFeature([
      MovimientoInventario,
      MovimientoInventarioDetalle,
    ]),
    // `EscalaMonedaPipe` resuelve `MonedasService` desde los injectables de
    // ESTE módulo: sin este import el @Body del controller falla en runtime.
    MonedasModule,
    // `registrarAjusteCosto` convierte el costo tipeado en otra unidad a la
    // unidad base del producto vía `CatalogService.convertirUnidad`.
    CatalogModule,
    // `registrarMovimiento` requiere `ubicacionId`: el chokepoint resuelve el
    // local del tenant vía `UbicacionesService.localDe` en `ajuste_costo`,
    // el único de los 17 llamadores que vive dentro de este mismo service.
    UbicacionesModule,
  ],
  controllers: [InventarioController],
  providers: [InventarioService],
  exports: [InventarioService],
})
export class InventarioModule {}
