import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VentaPropina } from './entities/venta-propina.entity';
import { PropinaConfiguracion } from './entities/propina-configuracion.entity';
import { PropinaGrupoDistribucion } from './entities/propina-grupo-distribucion.entity';
import { PropinaGrupoPesoManual } from './entities/propina-grupo-peso-manual.entity';
import { VentaPropinaService } from './venta-propina.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      VentaPropina,
      PropinaConfiguracion,
      PropinaGrupoDistribucion,
      PropinaGrupoPesoManual,
    ]),
  ],
  providers: [VentaPropinaService],
  exports: [VentaPropinaService],
})
export class PropinasModule {}
