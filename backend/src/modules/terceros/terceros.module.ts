import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tercero } from './entities/tercero.entity';
import { TercerosService } from './terceros.service';
import { TercerosController } from './terceros.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Tercero])],
  controllers: [TercerosController],
  providers: [TercerosService],
  exports: [TercerosService],
})
export class TercerosModule {}
