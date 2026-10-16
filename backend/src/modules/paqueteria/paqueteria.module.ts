import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { MonedasModule } from '../monedas/monedas.module';
import { PaqueteConfiguracion } from './entities/paquete-configuracion.entity';
import { Repartidor } from './entities/repartidor.entity';
import { Paquete } from './entities/paquete.entity';
import { HojaRuta } from './entities/hoja-ruta.entity';
import { HojaRutaPaquete } from './entities/hoja-ruta-paquete.entity';
import { PaqueteConfiguracionController } from './paquete-configuracion.controller';
import { PaqueteConfiguracionService } from './paquete-configuracion.service';
import { RepartidoresController } from './repartidores.controller';
import { RepartidoresService } from './repartidores.service';

@Module({
  imports: [
    RepositoriosModule.forFeature([
      PaqueteConfiguracion,
      Repartidor,
      Paquete,
      HojaRuta,
      HojaRutaPaquete,
    ]),
    // `@Body(EscalaMonedaPipe)` resuelve por `moduleRef.injectables`: sin esto el arranque se cae (backend.md § 3.1).
    MonedasModule,
  ],
  controllers: [PaqueteConfiguracionController, RepartidoresController],
  providers: [PaqueteConfiguracionService, RepartidoresService],
  exports: [PaqueteConfiguracionService, RepartidoresService],
})
export class PaqueteriaModule {}
