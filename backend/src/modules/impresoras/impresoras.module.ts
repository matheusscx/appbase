import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Impresora } from './entities/impresora.entity';
import { ImpresorasService } from './impresoras.service';
import { QzFirmaService } from './qz-firma.service';
import { ImpresorasController } from './impresoras.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Impresora])],
  controllers: [ImpresorasController],
  providers: [ImpresorasService, QzFirmaService],
  exports: [ImpresorasService],
})
export class ImpresorasModule {}
