import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalculoPreciosModule } from '../calculo-precios/calculo-precios.module';
import { CajaModule } from '../caja/caja.module';
import { InventarioModule } from '../inventario/inventario.module';
import { ItemsModule } from '../items/items.module';
import { PagosModule } from '../pagos/pagos.module';
import { CatalogModule } from '../catalog/catalog.module';
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
import { TipoDocumentoTributario } from './entities/tipo-documento-tributario.entity';
import { PasarelaModule } from '../pasarela/pasarela.module';
import { VentasReembolsoHandler } from './reembolso-callback.handler';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Venta,
      VentaDetalle,
      VentaDescuento,
      VentaRecargo,
      VentaImpuesto,
      VentaCustomer,
      TipoDocumentoTributario,
    ]),
    CalculoPreciosModule,
    CajaModule,
    InventarioModule,
    ItemsModule,
    PagosModule,
    CatalogModule,
    // Solo para registrar VentasReembolsoHandler en el ReembolsoCallbackRegistry
    // (pasarela nunca importa ventas; el borde se cruza en esta dirección).
    PasarelaModule,
  ],
  controllers: [VentasController, TiposDocumentoController],
  providers: [VentasService, VentasReembolsoHandler],
  exports: [VentasService],
})
export class VentasModule {}
