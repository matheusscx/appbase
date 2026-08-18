import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { Tercero } from './entities/tercero.entity';
import { TercerosService } from './terceros.service';
import { TercerosController } from './terceros.controller';

@Module({
  imports: [RepositoriosModule.forFeature([Tercero])],
  controllers: [TercerosController],
  providers: [TercerosService],
  exports: [TercerosService],
})
export class TercerosModule {}
