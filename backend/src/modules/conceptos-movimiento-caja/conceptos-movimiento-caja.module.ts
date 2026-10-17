import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { ConceptoMovimientoCaja } from './entities/concepto-movimiento-caja.entity';
import { ConceptosMovimientoCajaService } from './conceptos-movimiento-caja.service';
import { ConceptosMovimientoCajaController } from './conceptos-movimiento-caja.controller';

@Module({
  imports: [RepositoriosModule.forFeature([ConceptoMovimientoCaja])],
  controllers: [ConceptosMovimientoCajaController],
  providers: [ConceptosMovimientoCajaService],
})
export class ConceptosMovimientoCajaModule {}
