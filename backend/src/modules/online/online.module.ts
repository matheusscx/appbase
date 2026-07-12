import { Module } from '@nestjs/common';
import { CalculoPreciosModule } from '../calculo-precios/calculo-precios.module';
import { MetodosPagoModule } from '../metodos-pago/metodos-pago.module';
import { PasarelaModule } from '../pasarela/pasarela.module';
import { VentasModule } from '../ventas/ventas.module';
import { SuscripcionesModule } from '../suscripciones/suscripciones.module';
import { OnlineController } from './online.controller';
import { OnlineService } from './online.service';
import { OnlineCallbackHandler } from './online-callback.handler';
import { MediosPagoOnlineController } from './medios-pago-online.controller';
import { MediosPagoOnlineService } from './medios-pago-online.service';

@Module({
  imports: [
    CalculoPreciosModule,
    MetodosPagoModule,
    PasarelaModule,
    VentasModule,
    SuscripcionesModule, // cascada de cancelación al eliminar una tarjeta
  ],
  controllers: [OnlineController, MediosPagoOnlineController],
  providers: [OnlineService, OnlineCallbackHandler, MediosPagoOnlineService],
})
export class OnlineModule {}
