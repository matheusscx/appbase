import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cajon } from './entities/cajon.entity';
import { CajonesService } from './cajones.service';
import { CajonesController } from './cajones.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Cajon])],
  controllers: [CajonesController],
  providers: [CajonesService],
  exports: [CajonesService],
})
export class CajonesModule {}
