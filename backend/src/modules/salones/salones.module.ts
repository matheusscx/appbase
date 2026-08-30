import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { SalonesService } from './salones.service';
import { CuentaAsignacionesService } from './cuenta-asignaciones.service';
import {
  SalonesController,
  MesasController,
  CuentasController,
} from './salones.controller';
import { Salon } from './entities/salon.entity';
import { Mesa } from './entities/mesa.entity';
import { Cuenta } from './entities/cuenta.entity';
import { CuentaAsignacion } from './entities/cuenta-asignacion.entity';
import { VentasModule } from '../ventas/ventas.module';
import { GarzonesModule } from '../garzones/garzones.module';
import { ItemsModule } from '../items/items.module';
import { CatalogModule } from '../catalog/catalog.module';
import { TurnosModule } from '../turnos/turnos.module';
import { MonedasModule } from '../monedas/monedas.module';
import { CalculoPreciosModule } from '../calculo-precios/calculo-precios.module';

@Module({
  imports: [
    RepositoriosModule.forFeature([Salon, Mesa, Cuenta, CuentaAsignacion]),
    VentasModule,
    GarzonesModule,
    ItemsModule,
    CatalogModule,
    TurnosModule,
    // `EscalaMonedaPipe` resuelve `MonedasService` desde los injectables de
    // ESTE módulo: sin este import el @Body del controller falla en runtime.
    MonedasModule,
    // El detalle priceado de la personalización se devuelve convertido a
    // moneda oficial: `convertirAMonedaOficial` + `cargarConfig` salen de acá.
    CalculoPreciosModule,
  ],
  controllers: [SalonesController, MesasController, CuentasController],
  providers: [SalonesService, CuentaAsignacionesService],
  exports: [SalonesService, CuentaAsignacionesService],
})
export class SalonesModule {}
