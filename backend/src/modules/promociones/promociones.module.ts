import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Promocion } from './entities/promocion.entity';
import { PromocionScope } from './entities/promocion-scope.entity';
import { PromocionScopeItem } from './entities/promocion-scope-item.entity';
import { PromocionesService } from './promociones.service';
import { PromocionesController } from './promociones.controller';
import { MonedasModule } from '../monedas/monedas.module';

@Module({
  imports: [
    RepositoriosModule.forFeature([
      Promocion,
      PromocionScope,
      PromocionScopeItem,
    ]),
    // `EscalaMonedaPipe` resuelve `MonedasService` desde los injectables de
    // ESTE módulo: sin este import el @Body del controller falla en runtime.
    MonedasModule,
  ],
  controllers: [PromocionesController],
  providers: [PromocionesService],
  exports: [PromocionesService],
})
export class PromocionesModule {}
