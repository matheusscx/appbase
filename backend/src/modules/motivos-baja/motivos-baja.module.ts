import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { MotivoBaja } from './entities/motivo-baja.entity';
import { MotivosBajaService } from './motivos-baja.service';
import { MotivosBajaController } from './motivos-baja.controller';

@Module({
  imports: [RepositoriosModule.forFeature([MotivoBaja])],
  controllers: [MotivosBajaController],
  providers: [MotivosBajaService],
  exports: [MotivosBajaService],
})
export class MotivosBajaModule {}
