import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VentaPropina } from './entities/venta-propina.entity';
import { PropinaConfiguracion } from './entities/propina-configuracion.entity';
import { PropinaGrupoDistribucion } from './entities/propina-grupo-distribucion.entity';
import { PropinaGrupoPesoManual } from './entities/propina-grupo-peso-manual.entity';
import { LiquidacionPropinas } from './entities/liquidacion-propinas.entity';
import { LiquidacionPropinasGrupo } from './entities/liquidacion-propinas-grupo.entity';
import { LiquidacionPropinasParticipante } from './entities/liquidacion-propinas-participante.entity';
import { LiquidacionPropinasFuente } from './entities/liquidacion-propinas-fuente.entity';
import { LiquidacionPropinasEvento } from './entities/liquidacion-propinas-evento.entity';
import { VentaPropinaService } from './venta-propina.service';
import { PropinaDistribucionService } from './propina-distribucion.service';
import { LiquidacionPropinasService } from './liquidacion-propinas.service';
import { PropinaDistribucionController } from './propina-distribucion.controller';
import { LiquidacionPropinasController } from './liquidacion-propinas.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      VentaPropina,
      PropinaConfiguracion,
      PropinaGrupoDistribucion,
      PropinaGrupoPesoManual,
      LiquidacionPropinas,
      LiquidacionPropinasGrupo,
      LiquidacionPropinasParticipante,
      LiquidacionPropinasFuente,
      LiquidacionPropinasEvento,
    ]),
  ],
  controllers: [PropinaDistribucionController, LiquidacionPropinasController],
  providers: [
    VentaPropinaService,
    PropinaDistribucionService,
    LiquidacionPropinasService,
  ],
  exports: [
    VentaPropinaService,
    PropinaDistribucionService,
    LiquidacionPropinasService,
  ],
})
export class PropinasModule {}
