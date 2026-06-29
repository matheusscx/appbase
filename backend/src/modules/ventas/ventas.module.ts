import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalculoPreciosModule } from '../calculo-precios/calculo-precios.module';
import { CajaModule } from '../caja/caja.module';
import { InventarioModule } from '../inventario/inventario.module';
import { ItemsModule } from '../items/items.module';
import { VentasService } from './ventas.service';
import {
  VentasController,
  TiposDocumentoController,
} from './ventas.controller';
import { Venta } from './entities/venta.entity';
import { VentaDetalle } from './entities/venta-detalle.entity';
import { VentaDescuento } from './entities/venta-descuento.entity';
import { VentaRecargo } from './entities/venta-recargo.entity';
import { VentaImpuesto } from './entities/venta-impuesto.entity';
import { VentaCustomer } from './entities/venta-customer.entity';
import { Pago } from './entities/pago.entity';
import { TipoDocumentoTributario } from './entities/tipo-documento-tributario.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Venta,
      VentaDetalle,
      VentaDescuento,
      VentaRecargo,
      VentaImpuesto,
      VentaCustomer,
      Pago,
      TipoDocumentoTributario,
    ]),
    CalculoPreciosModule,
    CajaModule,
    InventarioModule,
    ItemsModule,
  ],
  controllers: [VentasController, TiposDocumentoController],
  providers: [VentasService],
  exports: [VentasService],
})
export class VentasModule {}
