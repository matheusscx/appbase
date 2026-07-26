import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MotivoDiferenciaInventario } from './entities/motivo-diferencia-inventario.entity';
import { MotivosDiferenciaInventarioService } from './motivos-diferencia-inventario.service';
import { MotivosDiferenciaInventarioController } from './motivos-diferencia-inventario.controller';

@Module({
  imports: [TypeOrmModule.forFeature([MotivoDiferenciaInventario])],
  controllers: [MotivosDiferenciaInventarioController],
  providers: [MotivosDiferenciaInventarioService],
  exports: [MotivosDiferenciaInventarioService],
})
export class MotivosDiferenciaInventarioModule {}
