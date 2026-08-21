import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Pago } from './entities/pago.entity';
import { PagoAplicacion } from './entities/pago-aplicacion.entity';
import { PagosController } from './pagos.controller';
import { PagosService } from './pagos.service';
import { CajaModule } from '../caja/caja.module';
import { MonedasModule } from '../monedas/monedas.module';

@Module({
  imports: [
    RepositoriosModule.forFeature([Pago, PagoAplicacion]),
    CajaModule,
    // `EscalaMonedaPipe` resuelve `MonedasService` desde los injectables de
    // ESTE módulo: sin este import el @Body del controller falla en runtime.
    MonedasModule,
  ],
  controllers: [PagosController],
  providers: [PagosService],
  exports: [PagosService],
})
export class PagosModule {}
