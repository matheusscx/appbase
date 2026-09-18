import { Module } from '@nestjs/common';
import { ResumenNegocioController } from './resumen-negocio.controller';
import { ResumenNegocioService } from './resumen-negocio.service';
import { SalonesModule } from '../salones/salones.module';
import { MermasModule } from '../mermas/mermas.module';

/**
 * Sin entidad propia ni `RepositoriosModule.forFeature`: el service lee con
 * SQL raw sobre `ventas`/`pagos`/`pago_aplicaciones`, ya registradas por sus
 * módulos dueños. `Db` es global (`CommonModule`), así que no hace falta
 * importarlo acá (§4 `docs/patterns/backend.md`).
 *
 * Task 2 (spec 2026-09-18-dashboard-inicio § 4.4) suma `perdidas`, que reusa
 * dos servicios ajenos tal cual, sin reescribir su SQL: `AnulacionesReporteService`
 * (`SalonesModule`) y `MermasService` (`MermasModule`). Ninguno de los dos
 * importa `ResumenNegocioModule` — no hay ciclo.
 */
@Module({
  imports: [SalonesModule, MermasModule],
  controllers: [ResumenNegocioController],
  providers: [ResumenNegocioService],
})
export class ResumenNegocioModule {}
