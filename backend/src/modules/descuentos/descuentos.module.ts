import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Descuento } from './entities/descuento.entity';
import { DescuentoTramo } from './entities/descuento-tramo.entity';
import { DescuentoMetodoPago } from './entities/descuento-metodo-pago.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { DescuentosService } from './descuentos.service';
import { DescuentosController } from './descuentos.controller';
import { MonedasModule } from '../monedas/monedas.module';

@Module({
  imports: [
    RepositoriosModule.forFeature([
      Descuento,
      DescuentoTramo,
      DescuentoMetodoPago,
      TipoRegla,
    ]),
    // `EscalaMonedaPipe` resuelve `MonedasService` desde los injectables de
    // ESTE módulo: sin este import el @Body del controller falla en runtime.
    MonedasModule,
  ],
  controllers: [DescuentosController],
  providers: [DescuentosService],
  exports: [DescuentosService],
})
export class DescuentosModule {}
