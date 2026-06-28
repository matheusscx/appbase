import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MovimientoInventario } from './entities/movimiento-inventario.entity';
import { MovimientoInventarioDetalle } from './entities/movimiento-inventario-detalle.entity';
import { InventarioService } from './inventario.service';
import { InventarioController } from './inventario.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MovimientoInventario,
      MovimientoInventarioDetalle,
    ]),
  ],
  controllers: [InventarioController],
  providers: [InventarioService],
  exports: [InventarioService],
})
export class InventarioModule {}
