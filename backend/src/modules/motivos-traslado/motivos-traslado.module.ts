import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { MotivoTraslado } from './entities/motivo-traslado.entity';
import { MotivosTrasladoService } from './motivos-traslado.service';
import { MotivosTrasladoController } from './motivos-traslado.controller';

@Module({
  imports: [RepositoriosModule.forFeature([MotivoTraslado])],
  controllers: [MotivosTrasladoController],
  providers: [MotivosTrasladoService],
  exports: [MotivosTrasladoService],
})
export class MotivosTrasladoModule {}
