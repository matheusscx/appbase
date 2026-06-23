import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Descuento } from './entities/descuento.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { DescuentosService } from './descuentos.service';
import { DescuentosController } from './descuentos.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Descuento, TipoRegla])],
  controllers: [DescuentosController],
  providers: [DescuentosService],
  exports: [DescuentosService],
})
export class DescuentosModule {}
