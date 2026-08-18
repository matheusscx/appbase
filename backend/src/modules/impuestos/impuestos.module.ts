import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Impuesto } from './entities/impuesto.entity';
import { ImpuestosService } from './impuestos.service';
import { ImpuestosController } from './impuestos.controller';

@Module({
  imports: [RepositoriosModule.forFeature([Impuesto])],
  controllers: [ImpuestosController],
  providers: [ImpuestosService],
  exports: [ImpuestosService],
})
export class ImpuestosModule {}
