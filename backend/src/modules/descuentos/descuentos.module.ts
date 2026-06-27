import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Descuento } from './entities/descuento.entity';
import { DescuentoTramo } from './entities/descuento-tramo.entity';
import { DescuentoMetodoPago } from './entities/descuento-metodo-pago.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { DescuentosService } from './descuentos.service';
import { DescuentosController } from './descuentos.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Descuento,
      DescuentoTramo,
      DescuentoMetodoPago,
      TipoRegla,
    ]),
  ],
  controllers: [DescuentosController],
  providers: [DescuentosService],
  exports: [DescuentosService],
})
export class DescuentosModule {}
