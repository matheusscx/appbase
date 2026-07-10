import { Module } from '@nestjs/common';
import { CalculoPreciosModule } from '../calculo-precios/calculo-precios.module';
import { MetodosPagoModule } from '../metodos-pago/metodos-pago.module';
import { PasarelaModule } from '../pasarela/pasarela.module';
import { VentasModule } from '../ventas/ventas.module';
import { OnlineController } from './online.controller';
import { OnlineService } from './online.service';
import { OnlineCallbackHandler } from './online-callback.handler';

@Module({
  imports: [
    CalculoPreciosModule,
    MetodosPagoModule,
    PasarelaModule,
    VentasModule,
  ],
  controllers: [OnlineController],
  providers: [OnlineService, OnlineCallbackHandler],
})
export class OnlineModule {}
