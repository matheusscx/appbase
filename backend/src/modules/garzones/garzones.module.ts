import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Garzon } from './entities/garzon.entity';
import { GarzonesService } from './garzones.service';
import { GarzonesController } from './garzones.controller';
import { SesionGarzon } from '../turnos/entities/sesion-garzon.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Garzon, SesionGarzon])],
  controllers: [GarzonesController],
  providers: [GarzonesService],
  exports: [GarzonesService],
})
export class GarzonesModule {}
