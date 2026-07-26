import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MotivosDiferenciaInventarioModule } from '../motivos-diferencia-inventario/motivos-diferencia-inventario.module';
import { RecuentoInventario } from './entities/recuento-inventario.entity';
import { RecuentoInventarioLinea } from './entities/recuento-inventario-linea.entity';
import { RecuentosService } from './recuentos.service';
import { RecuentosController } from './recuentos.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([RecuentoInventario, RecuentoInventarioLinea]),
    MotivosDiferenciaInventarioModule,
  ],
  controllers: [RecuentosController],
  providers: [RecuentosService],
  exports: [RecuentosService],
})
export class RecuentosModule {}
