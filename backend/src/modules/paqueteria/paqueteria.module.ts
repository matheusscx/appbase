import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { MonedasModule } from '../monedas/monedas.module';
import { PaqueteConfiguracion } from './entities/paquete-configuracion.entity';
import { Repartidor } from './entities/repartidor.entity';
import { Paquete } from './entities/paquete.entity';
import { HojaRuta } from './entities/hoja-ruta.entity';
import { HojaRutaPaquete } from './entities/hoja-ruta-paquete.entity';

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
  controllers: [],
  providers: [],
})
export class PaqueteriaModule {}
