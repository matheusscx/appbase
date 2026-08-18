import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { TipoRegla } from './entities/tipo-regla.entity';
import { TiposReglaService } from './tipos-regla.service';
import { TiposReglaController } from './tipos-regla.controller';

@Module({
  imports: [RepositoriosModule.forFeature([TipoRegla])],
  controllers: [TiposReglaController],
  providers: [TiposReglaService],
  exports: [TiposReglaService],
})
export class TiposReglaModule {}
