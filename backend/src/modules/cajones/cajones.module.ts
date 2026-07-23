import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cajon } from './entities/cajon.entity';
import { CajonUsuario } from './entities/cajon-usuario.entity';
import { UsuarioTenant } from '../tenants/entities/usuario-tenant.entity';
import { CajonesService } from './cajones.service';
import { CajonesController } from './cajones.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Cajon, CajonUsuario, UsuarioTenant])],
  controllers: [CajonesController],
  providers: [CajonesService],
  exports: [CajonesService],
})
export class CajonesModule {}
