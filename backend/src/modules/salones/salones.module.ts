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
import { GarzonesModule } from '../garzones/garzones.module';
import { ItemsModule } from '../items/items.module';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Salon, Mesa, Cuenta, CuentaLinea]),
    VentasModule,
    GarzonesModule,
    ItemsModule,
    CatalogModule,
  ],
  controllers: [SalonesController, MesasController, CuentasController],
  providers: [SalonesService],
  exports: [SalonesService],
})
export class SalonesModule {}
