import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pago } from './entities/pago.entity';
import { PagoAplicacion } from './entities/pago-aplicacion.entity';
import { PagosController } from './pagos.controller';
import { PagosService } from './pagos.service';
import { CajaModule } from '../caja/caja.module';

@Module({
  imports: [TypeOrmModule.forFeature([Pago, PagoAplicacion]), CajaModule],
  controllers: [PagosController],
  providers: [PagosService],
  exports: [PagosService],
})
export class PagosModule {}
