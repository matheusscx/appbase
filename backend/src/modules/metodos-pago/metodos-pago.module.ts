import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetodoPago } from './entities/metodo-pago.entity';
import { MetodoPagoPais } from './entities/metodo-pago-pais.entity';
import { TenantMetodoPago } from './entities/tenant-metodo-pago.entity';
import { MetodosPagoService } from './metodos-pago.service';
import { MetodosPagoController } from './metodos-pago.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([MetodoPago, MetodoPagoPais, TenantMetodoPago]),
  ],
  controllers: [MetodosPagoController],
  providers: [MetodosPagoService],
  exports: [MetodosPagoService],
})
export class MetodosPagoModule {}
