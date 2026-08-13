import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Caja } from './entities/caja.entity';
import { MovimientoCaja } from './entities/movimiento-caja.entity';
import { CajaArqueoMedio } from './entities/caja-arqueo-medio.entity';
import { CajaTestigo } from './entities/caja-testigo.entity';
import { CajaController } from './caja.controller';
import { CajaService } from './caja.service';
import { CajaTestigoService } from './caja-testigo.service';
import { MotivosDiferenciaModule } from '../motivos-diferencia/motivos-diferencia.module';
import { TurnosModule } from '../turnos/turnos.module';
import { GarzonesModule } from '../garzones/garzones.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Caja,
      MovimientoCaja,
      CajaArqueoMedio,
      CajaTestigo,
    ]),
    MotivosDiferenciaModule,
    TurnosModule,
    // El garzón da fe con su propio PIN: `CajaTestigoService` reusa
    // `GarzonesService.verificarPin` (mismo bcrypt.compare que el resto del
    // sistema de PIN) en vez de duplicarlo. `TurnosModule` no re-exporta
    // `GarzonesService` (solo `TurnosService`/`SesionesGarzonService`), así
    // que hace falta importar el módulo directo.
    GarzonesModule,
  ],
  controllers: [CajaController],
  providers: [CajaService, CajaTestigoService],
  exports: [CajaService, CajaTestigoService],
})
export class CajaModule {}
