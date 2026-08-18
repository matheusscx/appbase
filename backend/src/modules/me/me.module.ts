import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Usuario } from '../users/usuario.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [RepositoriosModule.forFeature([Usuario, RefreshToken])],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
