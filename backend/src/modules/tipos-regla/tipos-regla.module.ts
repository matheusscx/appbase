import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TipoRegla } from './entities/tipo-regla.entity';
import { TiposReglaService } from './tipos-regla.service';
import { TiposReglaController } from './tipos-regla.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TipoRegla])],
  controllers: [TiposReglaController],
  providers: [TiposReglaService],
  exports: [TiposReglaService],
})
export class TiposReglaModule {}
