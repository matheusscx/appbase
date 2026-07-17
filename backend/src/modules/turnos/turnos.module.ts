import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Turno } from './entities/turno.entity';
import { TurnosService } from './turnos.service';
import { TurnosController } from './turnos.controller';

/** Parcial: SesionGarzon + SesionesGarzonService se agregan en Task 2. */
@Module({
  imports: [TypeOrmModule.forFeature([Turno])],
  controllers: [TurnosController],
  providers: [TurnosService],
  exports: [TurnosService],
})
export class TurnosModule {}
