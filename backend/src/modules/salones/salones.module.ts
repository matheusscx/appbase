import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SalonesService } from './salones.service';
import {
  SalonesController,
  MesasController,
  CuentasController,
} from './salones.controller';
import { Salon } from './entities/salon.entity';
import { Mesa } from './entities/mesa.entity';
import { Cuenta } from './entities/cuenta.entity';
import { CuentaLinea } from './entities/cuenta-linea.entity';
import { VentasModule } from '../ventas/ventas.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Salon, Mesa, Cuenta, CuentaLinea]),
    VentasModule,
  ],
  controllers: [SalonesController, MesasController, CuentasController],
  providers: [SalonesService],
  exports: [SalonesService],
})
export class SalonesModule {}
