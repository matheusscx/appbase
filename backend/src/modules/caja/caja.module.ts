import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Caja } from './entities/caja.entity';
import { MovimientoCaja } from './entities/movimiento-caja.entity';
import { CajaArqueoMedio } from './entities/caja-arqueo-medio.entity';
import { CajaController } from './caja.controller';
import { CajaService } from './caja.service';
import { MotivosDiferenciaModule } from '../motivos-diferencia/motivos-diferencia.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Caja, MovimientoCaja, CajaArqueoMedio]),
    MotivosDiferenciaModule,
  ],
  controllers: [CajaController],
  providers: [CajaService],
  exports: [CajaService],
})
export class CajaModule {}
