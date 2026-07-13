import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Impresora } from './entities/impresora.entity';
import { ImpresorasService } from './impresoras.service';
import { ImpresorasController } from './impresoras.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Impresora])],
  controllers: [ImpresorasController],
  providers: [ImpresorasService],
  exports: [ImpresorasService],
})
export class ImpresorasModule {}
