import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Impuesto } from './entities/impuesto.entity';
import { ImpuestosService } from './impuestos.service';
import { ImpuestosController } from './impuestos.controller';
import { MonedasModule } from '../monedas/monedas.module';

@Module({
  imports: [
    RepositoriosModule.forFeature([Impuesto]),
    // `EscalaMonedaPipe` resuelve `MonedasService` desde los injectables de
    // ESTE módulo: sin este import el @Body del controller falla en runtime.
    MonedasModule,
  ],
  controllers: [ImpuestosController],
  providers: [ImpuestosService],
  exports: [ImpuestosService],
})
export class ImpuestosModule {}
