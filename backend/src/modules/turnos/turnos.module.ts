import { forwardRef, Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Turno } from './entities/turno.entity';
import { SesionGarzon } from './entities/sesion-garzon.entity';
import { TurnosService } from './turnos.service';
import { TurnosController } from './turnos.controller';
import { SesionesGarzonService } from './sesiones-garzon.service';
import { SesionesGarzonController } from './sesiones-garzon.controller';
import { GarzonesModule } from '../garzones/garzones.module';
import { CajaModule } from '../caja/caja.module';

@Module({
  imports: [
    RepositoriosModule.forFeature([Turno, SesionGarzon]),
    GarzonesModule,
    // `SesionesGarzonService` caduca las solicitudes de testigo al cerrar una
    // sesión (`CajaTestigoService.caducarPorSesion`). `CajaModule` ya importa
    // `TurnosModule`: `forwardRef` en los dos módulos rompe el ciclo de
    // arranque.
    forwardRef(() => CajaModule),
  ],
  controllers: [TurnosController, SesionesGarzonController],
  providers: [TurnosService, SesionesGarzonService],
  exports: [TurnosService, SesionesGarzonService],
})
export class TurnosModule {}
