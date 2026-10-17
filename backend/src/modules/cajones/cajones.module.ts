import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Cajon } from './entities/cajon.entity';
import { CajonUsuario } from './entities/cajon-usuario.entity';
import { UsuarioTenant } from '../tenants/entities/usuario-tenant.entity';
import { Caja } from '../caja/entities/caja.entity';
import { CajonesService } from './cajones.service';
import { CajonesController } from './cajones.controller';
import { MonedasModule } from '../monedas/monedas.module';

@Module({
  imports: [
    RepositoriosModule.forFeature([Cajon, CajonUsuario, UsuarioTenant, Caja]),
    // `EscalaMonedaPipe` (fondo sugerido) resuelve `MonedasService` desde los
    // injectables de este módulo.
    MonedasModule,
  ],
  controllers: [CajonesController],
  providers: [CajonesService],
  exports: [CajonesService],
})
export class CajonesModule {}
