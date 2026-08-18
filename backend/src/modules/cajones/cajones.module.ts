import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Cajon } from './entities/cajon.entity';
import { CajonUsuario } from './entities/cajon-usuario.entity';
import { UsuarioTenant } from '../tenants/entities/usuario-tenant.entity';
import { Caja } from '../caja/entities/caja.entity';
import { CajonesService } from './cajones.service';
import { CajonesController } from './cajones.controller';

@Module({
  imports: [
    RepositoriosModule.forFeature([Cajon, CajonUsuario, UsuarioTenant, Caja]),
  ],
  controllers: [CajonesController],
  providers: [CajonesService],
  exports: [CajonesService],
})
export class CajonesModule {}
