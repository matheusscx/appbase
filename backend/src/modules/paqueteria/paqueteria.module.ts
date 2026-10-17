import { Module } from '@nestjs/common';
import { RepositoriosModule } from '../../common/db/repositorios.module';
import { MonedasModule } from '../monedas/monedas.module';
import { PaqueteConfiguracion } from './entities/paquete-configuracion.entity';
import { TarifaPago } from './entities/tarifa-pago.entity';
import { TarifaEnvio } from './entities/tarifa-envio.entity';
import { Repartidor } from './entities/repartidor.entity';
import { Rendicion } from './entities/rendicion.entity';
import { EntregaRepartidor } from './entities/entrega-repartidor.entity';
import { Paquete } from './entities/paquete.entity';
import { HojaRuta } from './entities/hoja-ruta.entity';
import { HojaRutaPaquete } from './entities/hoja-ruta-paquete.entity';
import { HojasRutaController } from './hojas-ruta.controller';
import { HojasRutaService } from './hojas-ruta.service';
import { PaqueteConfiguracionController } from './paquete-configuracion.controller';
import { PaqueteConfiguracionService } from './paquete-configuracion.service';
import { PaquetesController } from './paquetes.controller';
import { PaquetesService } from './paquetes.service';
import { TarifasPagoController } from './tarifas-pago.controller';
import { TarifasPagoService } from './tarifas-pago.service';
import { TarifasEnvioController } from './tarifas-envio.controller';
import { TarifasEnvioService } from './tarifas-envio.service';
import { EntregasRepartidorController } from './entregas-repartidor.controller';
import { EntregasRepartidorService } from './entregas-repartidor.service';
import { RendicionesController } from './rendiciones.controller';
import { RendicionesService } from './rendiciones.service';
import { RepartidoresController } from './repartidores.controller';
import { RepartidoresService } from './repartidores.service';

@Module({
  imports: [
    RepositoriosModule.forFeature([
      PaqueteConfiguracion,
      TarifaPago,
      TarifaEnvio,
      Repartidor,
      Paquete,
      HojaRuta,
      HojaRutaPaquete,
      Rendicion,
      EntregaRepartidor,
    ]),
    // `@Body(EscalaMonedaPipe)` resuelve por `moduleRef.injectables`: sin esto el arranque se cae (backend.md § 3.1).
    MonedasModule,
  ],
  // `paquetes/configuracion` antes que `paquetes/:id`: el orden de registro decide qué ruta gana.
  controllers: [
    PaqueteConfiguracionController,
    TarifasPagoController,
    TarifasEnvioController,
    PaquetesController,
    RepartidoresController,
    HojasRutaController,
    EntregasRepartidorController,
    RendicionesController,
  ],
  providers: [
    PaqueteConfiguracionService,
    TarifasPagoService,
    TarifasEnvioService,
    PaquetesService,
    RepartidoresService,
    HojasRutaService,
    EntregasRepartidorService,
    RendicionesService,
  ],
  exports: [
    PaqueteConfiguracionService,
    TarifasPagoService,
    TarifasEnvioService,
    PaquetesService,
    RepartidoresService,
    HojasRutaService,
    EntregasRepartidorService,
    RendicionesService,
  ],
})
export class PaqueteriaModule {}
