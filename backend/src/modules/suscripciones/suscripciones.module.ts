import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Suscripcion } from './entities/suscripcion.entity';
import { SuscripcionesService } from './suscripciones.service';
import { SuscripcionesController } from './suscripciones.controller';
import { ItemsModule } from '../items/items.module';
import { CalculoPreciosModule } from '../calculo-precios/calculo-precios.module';
import { VentasModule } from '../ventas/ventas.module';
import { MetodosPagoModule } from '../metodos-pago/metodos-pago.module';
import { PasarelaModule } from '../pasarela/pasarela.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Suscripcion]),
    ItemsModule,
    CalculoPreciosModule,
    VentasModule, // exporta VentasService
    MetodosPagoModule, // exporta MetodosPagoService (método de pago contable)
    PasarelaModule, // exporta InscripcionesService + CobrosService + TenantPasarelaService
  ],
  controllers: [SuscripcionesController],
  providers: [SuscripcionesService],
  exports: [SuscripcionesService], // OnlineModule lo usa para la cascada al eliminar tarjeta
})
export class SuscripcionesModule {}
