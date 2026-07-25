import { Module } from '@nestjs/common';
import { MotivosDiferenciaService } from './motivos-diferencia.service';
import { MotivosDiferenciaController } from './motivos-diferencia.controller';

@Module({
  controllers: [MotivosDiferenciaController],
  providers: [MotivosDiferenciaService],
  exports: [MotivosDiferenciaService],
})
export class MotivosDiferenciaModule {}
