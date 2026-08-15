import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Usuario } from '../users/usuario.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [TypeOrmModule.forFeature([Usuario, RefreshToken])],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
