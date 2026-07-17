import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VentaPropina } from './entities/venta-propina.entity';
import { VentaPropinaService } from './venta-propina.service';

@Module({
  imports: [TypeOrmModule.forFeature([VentaPropina])],
  providers: [VentaPropinaService],
  exports: [VentaPropinaService],
})
export class PropinasModule {}
