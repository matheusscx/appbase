import { Module } from '@nestjs/common';
import { ItemsModule } from '../items/items.module';
import { ImpuestosModule } from '../impuestos/impuestos.module';
import { DescuentosModule } from '../descuentos/descuentos.module';
import { RecargosModule } from '../recargos/recargos.module';
import { TenantsModule } from '../tenants/tenants.module';
import { MonedasModule } from '../monedas/monedas.module';
import { CalculoPreciosService } from './calculo-precios.service';
import { CalculoPreciosController } from './calculo-precios.controller';

@Module({
  imports: [
    ItemsModule,
    ImpuestosModule,
    DescuentosModule,
    RecargosModule,
    TenantsModule,
    MonedasModule,
  ],
  controllers: [CalculoPreciosController],
  providers: [CalculoPreciosService],
  exports: [CalculoPreciosService],
})
export class CalculoPreciosModule {}
