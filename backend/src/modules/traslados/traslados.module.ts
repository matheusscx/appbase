import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Traslado } from './entities/traslado.entity';
import { TrasladosService } from './traslados.service';
import { TrasladosController } from './traslados.controller';
import { InventarioModule } from '../inventario/inventario.module';
import { ItemsModule } from '../items/items.module';
import { MotivosTrasladoModule } from '../motivos-traslado/motivos-traslado.module';
import { MonedasModule } from '../monedas/monedas.module';

@Module({
  imports: [
    RepositoriosModule.forFeature([Traslado]),
    // Las dos filas de kardex pasan por el chokepoint, como todo movimiento.
    InventarioModule,
    // `comprometidoPorItem`: sacar del local topea contra lo que las cuentas
    // abiertas ya pidieron (`docs/features/bodegas-y-traslados.md`, «El tope
    // del traslado es asimétrico (decisión 6)»).
    ItemsModule,
    // El motivo se valida contra el catálogo tipado del tenant.
    MotivosTrasladoModule,
    // `EscalaMonedaPipe` resuelve `MonedasService` desde los injectables de
    // ESTE módulo: sin este import el @Body del controller falla en runtime.
    MonedasModule,
  ],
  controllers: [TrasladosController],
  providers: [TrasladosService],
  exports: [TrasladosService],
})
export class TrasladosModule {}
