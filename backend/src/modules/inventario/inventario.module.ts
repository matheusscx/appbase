import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { MovimientoInventario } from './entities/movimiento-inventario.entity';
import { MovimientoInventarioDetalle } from './entities/movimiento-inventario-detalle.entity';
import { InventarioService } from './inventario.service';
import { InventarioController } from './inventario.controller';
import { MonedasModule } from '../monedas/monedas.module';

@Module({
  imports: [
    RepositoriosModule.forFeature([
      MovimientoInventario,
      MovimientoInventarioDetalle,
    ]),
    // `EscalaMonedaPipe` resuelve `MonedasService` desde los injectables de
    // ESTE módulo: sin este import el @Body del controller falla en runtime.
    MonedasModule,
  ],
  controllers: [InventarioController],
  providers: [InventarioService],
  exports: [InventarioService],
})
export class InventarioModule {}
