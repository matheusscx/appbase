import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Usuario } from './usuario.entity';
import { UsersService } from './users.service';

@Module({
  imports: [RepositoriosModule.forFeature([Usuario])],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
