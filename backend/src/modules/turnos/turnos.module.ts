import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Turno } from './entities/turno.entity';
import { SesionGarzon } from './entities/sesion-garzon.entity';
import { TurnosService } from './turnos.service';
import { TurnosController } from './turnos.controller';
import { SesionesGarzonService } from './sesiones-garzon.service';
import { SesionesGarzonController } from './sesiones-garzon.controller';
import { GarzonesModule } from '../garzones/garzones.module';

@Module({
  imports: [TypeOrmModule.forFeature([Turno, SesionGarzon]), GarzonesModule],
  controllers: [TurnosController, SesionesGarzonController],
  providers: [TurnosService, SesionesGarzonService],
  exports: [TurnosService, SesionesGarzonService],
})
export class TurnosModule {}
