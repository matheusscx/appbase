import { forwardRef, Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
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
    RepositoriosModule.forFeature([
      Caja,
      MovimientoCaja,
      CajaArqueoMedio,
      CajaTestigo,
    ]),
    MotivosDiferenciaModule,
    // `forwardRef`: `TurnosModule` importa `CajaModule` de vuelta (Task 4,
    // `SesionesGarzonService` necesita `CajaTestigoService` para caducar
    // solicitudes al cerrar una sesión). Sin esto los dos módulos quedan
    // esperándose entre sí al arrancar Nest.
    forwardRef(() => TurnosModule),
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
