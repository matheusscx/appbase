import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Garzon } from './entities/garzon.entity';
import { GarzonesService } from './garzones.service';
import { GarzonesController } from './garzones.controller';
import { SesionGarzon } from '../turnos/entities/sesion-garzon.entity';
import { RolesModule } from '../roles/roles.module';

@Module({
  // `RolesModule` por `otorgarPermisoOperar`: conceder `Salones:Operar` es
  // escribir en `roles`, y esa lógica vive en `RolesService`. La dirección va
  // en este sentido y no al revés —roles no sabe nada de garzones—, así que no
  // hay ciclo.
  imports: [RepositoriosModule.forFeature([Garzon, SesionGarzon]), RolesModule],
  controllers: [GarzonesController],
  providers: [GarzonesService],
  exports: [GarzonesService],
})
export class GarzonesModule {}
