import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Rol } from './entities/rol.entity';
import { RolUsuario } from './entities/rol-usuario.entity';
import { ModuloRol } from './entities/modulo-rol.entity';
import { RolPermisoModulo } from './entities/rol-permiso-modulo.entity';
import { TenantModulo } from '../tenants/entities/tenant-modulo.entity';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [
    RepositoriosModule.forFeature([
      Rol,
      RolUsuario,
      ModuloRol,
      RolPermisoModulo,
      TenantModulo,
    ]),
  ],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
