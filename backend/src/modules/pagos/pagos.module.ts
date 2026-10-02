import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Pago } from './entities/pago.entity';
import { PagoAplicacion } from './entities/pago-aplicacion.entity';
import { PagosController } from './pagos.controller';
import { PagosService } from './pagos.service';
import { CajaModule } from '../caja/caja.module';
import { MonedasModule } from '../monedas/monedas.module';
import { IdempotenciaModule } from '../idempotencia/idempotencia.module';
import { VentaDocumentosModule } from '../venta-documentos/venta-documentos.module';

@Module({
  imports: [
    RepositoriosModule.forFeature([Pago, PagoAplicacion]),
    CajaModule,
    // `EscalaMonedaPipe` resuelve `MonedasService` desde los injectables de
    // ESTE módulo: sin este import el @Body del controller falla en runtime.
    MonedasModule,
    IdempotenciaModule,
    // Solo para anotar el voucher duplicado de un abono con la máquina (E1b).
    // El módulo es una hoja: no importa a pagos ni a ventas, sin ciclo.
    VentaDocumentosModule,
  ],
  controllers: [PagosController],
  providers: [PagosService],
  exports: [PagosService],
})
export class PagosModule {}
