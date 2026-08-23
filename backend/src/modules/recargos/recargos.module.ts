import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Recargo } from './entities/recargo.entity';
import { RecargoTramo } from './entities/recargo-tramo.entity';
import { RecargoMetodoPago } from './entities/recargo-metodo-pago.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { RecargosService } from './recargos.service';
import { RecargosController } from './recargos.controller';
import { MonedasModule } from '../monedas/monedas.module';

@Module({
  imports: [
    RepositoriosModule.forFeature([
      Recargo,
      RecargoTramo,
      RecargoMetodoPago,
      TipoRegla,
    ]),
    // `EscalaMonedaPipe` resuelve `MonedasService` desde los injectables de
    // ESTE módulo: sin este import el @Body del controller falla en runtime.
    MonedasModule,
  ],
  controllers: [RecargosController],
  providers: [RecargosService],
  exports: [RecargosService],
})
export class RecargosModule {}
