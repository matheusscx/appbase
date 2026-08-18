import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Recargo } from './entities/recargo.entity';
import { RecargoTramo } from './entities/recargo-tramo.entity';
import { RecargoMetodoPago } from './entities/recargo-metodo-pago.entity';
import { TipoRegla } from '../tipos-regla/entities/tipo-regla.entity';
import { RecargosService } from './recargos.service';
import { RecargosController } from './recargos.controller';

@Module({
  imports: [
    RepositoriosModule.forFeature([
      Recargo,
      RecargoTramo,
      RecargoMetodoPago,
      TipoRegla,
    ]),
  ],
  controllers: [RecargosController],
  providers: [RecargosService],
  exports: [RecargosService],
})
export class RecargosModule {}
