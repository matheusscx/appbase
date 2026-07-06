import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Suscripcion } from './entities/suscripcion.entity';
import { SuscripcionesService } from './suscripciones.service';
import { SuscripcionesController } from './suscripciones.controller';
import { ItemsModule } from '../items/items.module';
import { CalculoPreciosModule } from '../calculo-precios/calculo-precios.module';
import { VentasModule } from '../ventas/ventas.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Suscripcion]),
    ItemsModule,
    CalculoPreciosModule,
    VentasModule, // exporta VentasService
  ],
  controllers: [SuscripcionesController],
  providers: [SuscripcionesService],
})
export class SuscripcionesModule {}
